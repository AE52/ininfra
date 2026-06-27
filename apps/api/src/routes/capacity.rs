//! Cluster capacity & namespace quota dashboard — read-only.
//!
//!   GET /api/capacity              cluster-wide allocatable / requested / used
//!   GET /api/quotas?ns=<optional>  per-namespace ResourceQuota + LimitRange
//!
//! `GET /api/capacity` rolls up, per node, the schedulable `allocatable` CPU/mem
//! against the sum of pod container requests for pods scheduled on that node
//! (across ALL namespaces — capacity is cluster-wide), and the node's live usage
//! from metrics-server. This reuses the exact request-summing logic the node
//! detail endpoint (`nodes.rs`) already applies per node, and the shared
//! `parse_cpu_millicores` / `parse_memory_bytes` quantity parsers.
//!
//! Graceful degradation: metrics-server is best-effort. When `metrics.k8s.io`
//! is unreachable the per-node `usedCpuM`/`usedMemMi` are `null` and
//! `metricsAvailable=false`, leaving a requests-vs-allocatable picture rather
//! than erroring.
//!
//! `GET /api/quotas` reads `status.used` and `spec.hard` off each ResourceQuota
//! and the defaults/bounds off each LimitRange, via the typed
//! `Api<ResourceQuota>` / `Api<LimitRange>`. A namespace with neither simply
//! contributes empty vectors.

use std::collections::BTreeMap;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::core::v1::{
    LimitRange, Node as K8sNode, Pod as K8sPod, ResourceQuota,
};
use kube::api::{DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use kube::Api;
use serde::Deserialize;

use crate::dto::{
    CapacityCluster, CapacityNode, CapacityResponse, LimitRangeInfo, LimitRangeItem,
    NamespaceQuota, QuotaInfo, QuotaResource,
};
use crate::error::ApiResult;
use crate::k8s::{managed_namespaces, require_namespace};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/capacity", get(get_capacity))
        .route("/api/quotas", get(list_quotas))
}

const MI: i64 = 1024 * 1024;

#[derive(Debug, Deserialize)]
struct NsQuery {
    ns: Option<String>,
}

/// Parse a k8s CPU quantity into whole millicores. Handles "123m" and plain
/// integer/decimal cores ("2", "0.5"). (Same logic as `nodes.rs`/`rightsizing.rs`.)
fn parse_cpu_millicores(q: &str) -> i64 {
    if let Some(m) = q.strip_suffix('m') {
        m.parse::<i64>().unwrap_or(0)
    } else {
        (q.parse::<f64>().unwrap_or(0.0) * 1000.0).round() as i64
    }
}

/// Parse a k8s memory quantity into bytes. Handles Ki/Mi/Gi/Ti (binary) and
/// K/M/G/T (decimal). (Same logic as `nodes.rs`/`rightsizing.rs`.)
fn parse_memory_bytes(q: &str) -> i64 {
    let suffixes: &[(&str, i64)] = &[
        ("Ki", 1024),
        ("Mi", 1024 * 1024),
        ("Gi", 1024 * 1024 * 1024),
        ("Ti", 1024 * 1024 * 1024 * 1024),
        ("K", 1_000),
        ("M", 1_000_000),
        ("G", 1_000_000_000),
        ("T", 1_000_000_000_000),
    ];
    for (suffix, factor) in suffixes {
        if let Some(n) = q.strip_suffix(suffix) {
            return n.parse::<i64>().unwrap_or(0) * factor;
        }
    }
    q.parse::<i64>().unwrap_or(0)
}

/// Live per-node usage `(cpu_millicores, mem_bytes)` from metrics-server, keyed
/// by node name. Mirrors `nodes.rs::node_usage` but pre-parses the quantities so
/// the rollup can sum them directly. Best-effort: empty map when `metrics.k8s.io`
/// is unavailable, which the caller treats as "no usage".
async fn node_usage_parsed(kube: &kube::Client) -> BTreeMap<String, (i64, i64)> {
    let gvk = GroupVersionKind::gvk("metrics.k8s.io", "v1beta1", "NodeMetrics");
    let ar = ApiResource::from_gvk(&gvk);
    let api: Api<DynamicObject> = Api::all_with(kube.clone(), &ar);
    let mut out = BTreeMap::new();
    if let Ok(list) = api.list(&ListParams::default()).await {
        for m in list.items {
            let name = match m.metadata.name.clone() {
                Some(n) => n,
                None => continue,
            };
            let usage = &m.data["usage"];
            let cpu_m = usage["cpu"].as_str().map(parse_cpu_millicores).unwrap_or(0);
            let mem_b = usage["memory"]
                .as_str()
                .map(parse_memory_bytes)
                .unwrap_or(0);
            out.insert(name, (cpu_m, mem_b));
        }
    }
    out
}

/// `GET /api/capacity` — per-node allocatable vs requested vs live usage with
/// schedulable headroom, rolled up to a cluster total.
///
/// Nodes are cluster-scoped (the console already lists them cluster-wide), so we
/// list all nodes and all pods. For each node we sum the CPU/memory **requests**
/// of every container of every pod scheduled on it (`spec.nodeName`), across all
/// namespaces — the same per-node request summation `nodes.rs` performs for its
/// node-detail view. Allocatable comes from `status.allocatable`; usage from the
/// node metrics map (best-effort).
async fn get_capacity(State(st): State<AppState>) -> ApiResult<Json<CapacityResponse>> {
    let nodes_api: Api<K8sNode> = Api::all(st.kube.clone());
    let pods_api: Api<K8sPod> = Api::all(st.kube.clone());

    let node_list = nodes_api.list(&ListParams::default()).await?;
    let pod_list = pods_api.list(&ListParams::default()).await?;
    let usage = node_usage_parsed(&st.kube).await;

    // Sum container requests per node in one pass over all pods.
    let mut requested: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for p in &pod_list.items {
        let node = match p.spec.as_ref().and_then(|s| s.node_name.clone()) {
            Some(n) => n,
            None => continue, // unscheduled pod consumes no node capacity
        };
        let containers = p
            .spec
            .as_ref()
            .map(|s| s.containers.as_slice())
            .unwrap_or(&[]);
        let entry = requested.entry(node).or_insert((0, 0));
        for c in containers {
            if let Some(reqs) = c.resources.as_ref().and_then(|r| r.requests.as_ref()) {
                if let Some(q) = reqs.get("cpu") {
                    entry.0 += parse_cpu_millicores(&q.0);
                }
                if let Some(q) = reqs.get("memory") {
                    entry.1 += parse_memory_bytes(&q.0);
                }
            }
        }
    }

    let mut out_nodes: Vec<CapacityNode> = Vec::with_capacity(node_list.items.len());
    let (mut c_alloc_cpu, mut c_alloc_mem) = (0i64, 0i64);
    let (mut c_req_cpu, mut c_req_mem) = (0i64, 0i64);
    let (mut c_used_cpu, mut c_used_mem) = (0i64, 0i64);
    let mut any_metrics = false;

    for n in &node_list.items {
        let name = n.metadata.name.clone().unwrap_or_default();

        // Allocatable from node status (schedulable headroom basis).
        let allocatable = n.status.as_ref().and_then(|s| s.allocatable.as_ref());
        let alloc_cpu_m = allocatable
            .and_then(|a| a.get("cpu"))
            .map(|q| parse_cpu_millicores(&q.0))
            .unwrap_or(0);
        let alloc_mem_b = allocatable
            .and_then(|a| a.get("memory"))
            .map(|q| parse_memory_bytes(&q.0))
            .unwrap_or(0);

        let (req_cpu_m, req_mem_b) = requested.get(&name).copied().unwrap_or((0, 0));

        let (used_cpu_m, used_mem_b, metrics_available) = match usage.get(&name) {
            Some((cpu, mem)) => (Some(*cpu), Some(*mem), true),
            None => (None, None, false),
        };

        c_alloc_cpu += alloc_cpu_m;
        c_alloc_mem += alloc_mem_b;
        c_req_cpu += req_cpu_m;
        c_req_mem += req_mem_b;
        if let (Some(uc), Some(um)) = (used_cpu_m, used_mem_b) {
            c_used_cpu += uc;
            c_used_mem += um;
            any_metrics = true;
        }

        out_nodes.push(CapacityNode {
            name,
            allocatable_cpu_m: alloc_cpu_m,
            allocatable_mem_mi: alloc_mem_b / MI,
            requested_cpu_m: req_cpu_m,
            requested_mem_mi: req_mem_b / MI,
            used_cpu_m,
            used_mem_mi: used_mem_b.map(|b| b / MI),
            metrics_available,
        });
    }

    out_nodes.sort_by(|a, b| a.name.cmp(&b.name));

    let cluster = CapacityCluster {
        allocatable_cpu_m: c_alloc_cpu,
        allocatable_mem_mi: c_alloc_mem / MI,
        requested_cpu_m: c_req_cpu,
        requested_mem_mi: c_req_mem / MI,
        used_cpu_m: any_metrics.then_some(c_used_cpu),
        used_mem_mi: any_metrics.then_some(c_used_mem / MI),
        headroom_cpu_m: c_alloc_cpu - c_req_cpu,
        headroom_mem_mi: (c_alloc_mem - c_req_mem) / MI,
        metrics_available: any_metrics,
    };

    Ok(Json(CapacityResponse {
        nodes: out_nodes,
        cluster,
    }))
}

/// Flatten a namespace's ResourceQuotas into `QuotaInfo` rows. Reads
/// `status.used` and `spec.hard` off each quota; a resource present in `hard`
/// but absent from `used` reports "0" used.
async fn quotas_for(kube: &kube::Client, ns: &str) -> ApiResult<Vec<QuotaInfo>> {
    let api: Api<ResourceQuota> = Api::namespaced(kube.clone(), ns);
    let mut out = Vec::new();
    for q in api.list(&ListParams::default()).await?.items {
        let name = q.metadata.name.clone().unwrap_or_default();
        let hard = q.spec.as_ref().and_then(|s| s.hard.as_ref());
        let used = q.status.as_ref().and_then(|s| s.used.as_ref());

        let mut rows: Vec<QuotaResource> = Vec::new();
        if let Some(hard) = hard {
            for (resource, hard_q) in hard {
                let used_str = used
                    .and_then(|u| u.get(resource))
                    .map(|q| q.0.clone())
                    .unwrap_or_else(|| "0".to_string());
                rows.push(QuotaResource {
                    resource: resource.clone(),
                    used: used_str,
                    hard: hard_q.0.clone(),
                });
            }
        }
        rows.sort_by(|a, b| a.resource.cmp(&b.resource));
        out.push(QuotaInfo {
            namespace: ns.to_string(),
            name,
            hard: rows,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Flatten a namespace's LimitRanges into `LimitRangeInfo` rows: one
/// `LimitRangeItem` per (type, resource) carrying the default / defaultRequest /
/// max / min bounds declared for it.
async fn limit_ranges_for(kube: &kube::Client, ns: &str) -> ApiResult<Vec<LimitRangeInfo>> {
    let api: Api<LimitRange> = Api::namespaced(kube.clone(), ns);
    let mut out = Vec::new();
    for lr in api.list(&ListParams::default()).await?.items {
        let name = lr.metadata.name.clone().unwrap_or_default();
        let limits = lr.spec.as_ref().map(|s| s.limits.as_slice()).unwrap_or(&[]);

        let mut items: Vec<LimitRangeItem> = Vec::new();
        for item in limits {
            let type_ = item.type_.clone();
            // Union of every resource named across the item's bound maps, so a
            // resource that only sets `max` (and no default) still shows up.
            let mut resources: std::collections::BTreeSet<String> = Default::default();
            let collect = |m: &Option<BTreeMap<String, k8s_openapi::apimachinery::pkg::api::resource::Quantity>>,
                           set: &mut std::collections::BTreeSet<String>| {
                if let Some(m) = m {
                    for k in m.keys() {
                        set.insert(k.clone());
                    }
                }
            };
            collect(&item.default, &mut resources);
            collect(&item.default_request, &mut resources);
            collect(&item.max, &mut resources);
            collect(&item.min, &mut resources);

            let get = |m: &Option<BTreeMap<String, k8s_openapi::apimachinery::pkg::api::resource::Quantity>>,
                       resource: &str|
             -> Option<String> { m.as_ref().and_then(|m| m.get(resource)).map(|q| q.0.clone()) };

            for resource in resources {
                items.push(LimitRangeItem {
                    type_: type_.clone(),
                    resource: resource.clone(),
                    default: get(&item.default, &resource),
                    default_request: get(&item.default_request, &resource),
                    max: get(&item.max, &resource),
                    min: get(&item.min, &resource),
                });
            }
        }
        items.sort_by(|a, b| (a.type_.as_str(), a.resource.as_str()).cmp(&(b.type_.as_str(), b.resource.as_str())));
        out.push(LimitRangeInfo { name, limits: items });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// `GET /api/quotas?ns=<optional>` — per-namespace ResourceQuota usage (used/hard)
/// and LimitRange defaults. With `ns` given it is guarded by `require_namespace`;
/// without it, every managed namespace is scanned.
async fn list_quotas(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
) -> ApiResult<Json<Vec<NamespaceQuota>>> {
    let namespaces: Vec<String> = match &q.ns {
        Some(ns) => {
            require_namespace(ns)?;
            vec![ns.clone()]
        }
        None => managed_namespaces(),
    };

    let mut out: Vec<NamespaceQuota> = Vec::with_capacity(namespaces.len());
    for ns in &namespaces {
        let quotas = quotas_for(&st.kube, ns).await?;
        let limit_ranges = limit_ranges_for(&st.kube, ns).await?;
        out.push(NamespaceQuota {
            namespace: ns.clone(),
            quotas,
            limit_ranges,
        });
    }
    out.sort_by(|a, b| a.namespace.cmp(&b.namespace));
    Ok(Json(out))
}
