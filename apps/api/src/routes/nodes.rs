//! `GET /api/nodes` — cluster-scoped node inventory.

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::core::v1::{Node as K8sNode, Pod as K8sPod};
use kube::api::{DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use kube::Api;

use crate::conv;
use crate::dto::{
    NodeCondition, NodeDetail, NodeInfo, NodeSystemInfo, NodeTaint, Page, PageQuery, PodSummary,
    ResourceAllocation,
};
use crate::error::{ApiError, ApiResult};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/nodes", get(list_nodes))
        .route("/api/nodes/:name", get(get_node))
}

/// Live per-node usage (cpu, memory) from metrics-server. Best-effort: returns
/// an empty map if metrics.k8s.io is unavailable, so the nodes view degrades to
/// capacity-only rather than erroring.
async fn node_usage(kube: &kube::Client) -> BTreeMap<String, (String, String)> {
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
            let cpu = usage["cpu"].as_str().unwrap_or("").to_string();
            let mem = usage["memory"].as_str().unwrap_or("").to_string();
            if !cpu.is_empty() || !mem.is_empty() {
                out.insert(name, (cpu, mem));
            }
        }
    }
    out
}

/// Parse a k8s CPU quantity string into whole millicores. Handles "123m" and
/// plain integer/decimal cores ("2", "0.5").
fn parse_cpu_millicores(q: &str) -> i64 {
    if let Some(m) = q.strip_suffix('m') {
        m.parse::<i64>().unwrap_or(0)
    } else {
        (q.parse::<f64>().unwrap_or(0.0) * 1000.0).round() as i64
    }
}

/// Parse a k8s memory quantity string into bytes. Handles Ki/Mi/Gi/Ti (binary)
/// and K/M/G/T (decimal).
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

/// Format a byte count back into the most compact binary k8s quantity
/// ("<n>Gi" / "<n>Mi" / "<n>Ki"), preferring an exact integer division so the
/// allocated totals read cleanly. Falls back to bytes when sub-Ki.
fn format_memory_bytes(bytes: i64) -> String {
    const KI: i64 = 1024;
    const MI: i64 = 1024 * 1024;
    const GI: i64 = 1024 * 1024 * 1024;
    if bytes >= GI && bytes % GI == 0 {
        format!("{}Gi", bytes / GI)
    } else if bytes >= MI && bytes % MI == 0 {
        format!("{}Mi", bytes / MI)
    } else if bytes >= KI {
        format!("{}Ki", bytes / KI)
    } else {
        format!("{}", bytes)
    }
}

/// Cluster-wide live per-pod usage from metrics-server, keyed by `(namespace, name)`.
/// A node hosts pods across many namespaces, so unlike the namespaced `pod_usage`
/// in `pods.rs` we query `PodMetrics` with `Api::all_with` and key by namespace+name.
/// Containers are summed per pod; CPU emitted as millicores ("42m") and memory as
/// kibibytes ("65536Ki") to match what the frontend's `cpuToCores`/`memToBytes` parse.
/// Best-effort: empty map if metrics.k8s.io is unavailable.
async fn pod_usage_all(kube: &kube::Client) -> BTreeMap<(String, String), (String, String)> {
    let gvk = GroupVersionKind::gvk("metrics.k8s.io", "v1beta1", "PodMetrics");
    let ar = ApiResource::from_gvk(&gvk);
    let api: Api<DynamicObject> = Api::all_with(kube.clone(), &ar);
    let mut out = BTreeMap::new();
    if let Ok(list) = api.list(&ListParams::default()).await {
        for m in list.items {
            let name = match m.metadata.name.clone() {
                Some(n) => n,
                None => continue,
            };
            let ns = m.metadata.namespace.clone().unwrap_or_default();
            let containers = match m.data["containers"].as_array() {
                Some(a) => a.clone(),
                None => continue,
            };
            let mut total_cpu_m: i64 = 0;
            let mut total_mem_bytes: i64 = 0;
            for c in &containers {
                let usage = &c["usage"];
                if let Some(cpu_str) = usage["cpu"].as_str() {
                    total_cpu_m += parse_cpu_millicores(cpu_str);
                }
                if let Some(mem_str) = usage["memory"].as_str() {
                    total_mem_bytes += parse_memory_bytes(mem_str);
                }
            }
            out.insert(
                (ns, name),
                (format!("{}m", total_cpu_m), format!("{}Ki", total_mem_bytes / 1024)),
            );
        }
    }
    out
}

async fn get_node(
    State(st): State<AppState>,
    Path(name): Path<String>,
) -> ApiResult<Json<NodeDetail>> {
    let nodes: Api<K8sNode> = Api::all(st.kube.clone());
    let node = nodes
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("node {name}")))?;

    // All pods cluster-wide scheduled on this node.
    let pods_api: Api<K8sPod> = Api::all(st.kube.clone());
    let all_pods = pods_api.list(&ListParams::default()).await?;
    let node_pods: Vec<&K8sPod> = all_pods
        .items
        .iter()
        .filter(|p| p.spec.as_ref().and_then(|s| s.node_name.as_deref()) == Some(name.as_str()))
        .collect();

    // Live usage: node metrics (best-effort) for the headline, and cluster-wide
    // pod metrics keyed by (namespace, name) since this node spans namespaces.
    let node_usage_map = node_usage(&st.kube).await;
    let pod_usage_map = pod_usage_all(&st.kube).await;

    let mut pods_per_node: BTreeMap<String, i32> = BTreeMap::new();
    pods_per_node.insert(name.clone(), node_pods.len() as i32);
    let node_info = to_dto(&node, &pods_per_node, &node_usage_map);

    let mut pods: Vec<PodSummary> = node_pods
        .iter()
        .map(|p| {
            let mut summary = conv::pod_summary(p);
            let key = (summary.namespace.clone(), summary.name.clone());
            if let Some((cpu, mem)) = pod_usage_map.get(&key) {
                summary.usage_cpu = Some(cpu.clone());
                summary.usage_memory = Some(mem.clone());
            }
            summary
        })
        .collect();
    pods.sort_by(|a, b| (a.namespace.as_str(), a.name.as_str()).cmp(&(b.namespace.as_str(), b.name.as_str())));

    let status = node.status.as_ref();

    let conditions: Vec<NodeCondition> = status
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .map(|c| NodeCondition {
                    type_: c.type_.clone(),
                    status: c.status.clone(),
                    reason: c.reason.clone(),
                    message: c.message.clone(),
                    last_transition_time: c.last_transition_time.as_ref().map(conv::time),
                })
                .collect()
        })
        .unwrap_or_default();

    let system_info = status
        .and_then(|s| s.node_info.as_ref())
        .map(|i| NodeSystemInfo {
            os_image: i.os_image.clone(),
            kernel_version: i.kernel_version.clone(),
            container_runtime: i.container_runtime_version.clone(),
            architecture: i.architecture.clone(),
            operating_system: i.operating_system.clone(),
            kube_proxy_version: i.kube_proxy_version.clone(),
        })
        .unwrap_or(NodeSystemInfo {
            os_image: String::new(),
            kernel_version: String::new(),
            container_runtime: String::new(),
            architecture: String::new(),
            operating_system: String::new(),
            kube_proxy_version: String::new(),
        });

    let addr_of = |kind: &str| -> Option<String> {
        status
            .and_then(|s| s.addresses.as_ref())
            .and_then(|addrs| addrs.iter().find(|a| a.type_ == kind))
            .map(|a| a.address.clone())
    };
    let internal_ip = addr_of("InternalIP");
    let external_ip = addr_of("ExternalIP");

    let provider_id = node.spec.as_ref().and_then(|s| s.provider_id.clone());

    let labels = node.metadata.labels.clone().unwrap_or_default();
    let nodegroup = labels.get("eks.amazonaws.com/nodegroup").cloned();
    let ami = labels
        .get("eks.amazonaws.com/nodegroup-image")
        .or_else(|| labels.get("node.k8s.aws/ami"))
        .cloned()
        .or_else(|| {
            labels
                .iter()
                .find(|(k, _)| k.contains("ami"))
                .map(|(_, v)| v.clone())
        });

    let taints_detail: Vec<NodeTaint> = node
        .spec
        .as_ref()
        .and_then(|s| s.taints.as_ref())
        .map(|ts| {
            ts.iter()
                .map(|t| NodeTaint {
                    key: t.key.clone(),
                    value: t.value.clone(),
                    effect: t.effect.clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    // Sum requests AND limits (cpu + memory) across all containers of every pod
    // scheduled on this node, reusing the metrics-quantity parsers.
    let (mut req_cpu_m, mut req_mem_b, mut lim_cpu_m, mut lim_mem_b) = (0i64, 0i64, 0i64, 0i64);
    for p in &node_pods {
        let containers = p
            .spec
            .as_ref()
            .map(|s| s.containers.as_slice())
            .unwrap_or(&[]);
        for c in containers {
            if let Some(res) = c.resources.as_ref() {
                if let Some(reqs) = res.requests.as_ref() {
                    if let Some(q) = reqs.get("cpu") {
                        req_cpu_m += parse_cpu_millicores(&q.0);
                    }
                    if let Some(q) = reqs.get("memory") {
                        req_mem_b += parse_memory_bytes(&q.0);
                    }
                }
                if let Some(lims) = res.limits.as_ref() {
                    if let Some(q) = lims.get("cpu") {
                        lim_cpu_m += parse_cpu_millicores(&q.0);
                    }
                    if let Some(q) = lims.get("memory") {
                        lim_mem_b += parse_memory_bytes(&q.0);
                    }
                }
            }
        }
    }
    let allocated = ResourceAllocation {
        requests_cpu: format!("{}m", req_cpu_m),
        requests_memory: format_memory_bytes(req_mem_b),
        limits_cpu: format!("{}m", lim_cpu_m),
        limits_memory: format_memory_bytes(lim_mem_b),
    };

    Ok(Json(NodeDetail {
        node: node_info,
        pods,
        conditions,
        system_info,
        internal_ip,
        external_ip,
        provider_id,
        ami,
        nodegroup,
        taints_detail,
        allocated,
    }))
}

async fn list_nodes(
    State(st): State<AppState>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<NodeInfo>>> {
    let nodes: Api<K8sNode> = Api::all(st.kube.clone());
    let pods: Api<K8sPod> = Api::all(st.kube.clone());

    let node_list = nodes.list(&ListParams::default()).await?;

    // Count scheduled (non-terminal) pods per node in one pass.
    let mut pods_per_node: BTreeMap<String, i32> = BTreeMap::new();
    let pod_list = pods.list(&ListParams::default()).await?;
    for p in &pod_list.items {
        if let Some(node) = p.spec.as_ref().and_then(|s| s.node_name.clone()) {
            *pods_per_node.entry(node).or_insert(0) += 1;
        }
    }

    // Live usage from metrics-server (best-effort).
    let usage = node_usage(&st.kube).await;

    let mut out: Vec<NodeInfo> = node_list
        .items
        .iter()
        .map(|n| to_dto(n, &pods_per_node, &usage))
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

fn to_dto(
    n: &K8sNode,
    pods_per_node: &BTreeMap<String, i32>,
    usage: &BTreeMap<String, (String, String)>,
) -> NodeInfo {
    let name = n.metadata.name.clone().unwrap_or_default();
    let labels = n.metadata.labels.clone().unwrap_or_default();
    let status = n.status.as_ref();

    let (capacity, allocatable) = match status {
        Some(s) => (s.capacity.as_ref(), s.allocatable.as_ref()),
        None => (None, None),
    };
    let capacity = capacity.cloned();
    let allocatable = allocatable.cloned();

    let kubelet_version = status
        .and_then(|s| s.node_info.as_ref())
        .map(|i| i.kubelet_version.clone())
        .unwrap_or_default();

    let taints = n
        .spec
        .as_ref()
        .and_then(|s| s.taints.as_ref())
        .map(|ts| {
            ts.iter()
                .map(|t| {
                    let val = t.value.clone().unwrap_or_default();
                    format!("{}={}:{}", t.key, val, t.effect)
                })
                .collect()
        })
        .unwrap_or_default();

    NodeInfo {
        name: name.clone(),
        ready: conv::node_ready(n),
        instance_type: labels
            .get("node.kubernetes.io/instance-type")
            .or_else(|| labels.get("beta.kubernetes.io/instance-type"))
            .cloned(),
        kubelet_version,
        zone: labels
            .get("topology.kubernetes.io/zone")
            .or_else(|| labels.get("failure-domain.beta.kubernetes.io/zone"))
            .cloned(),
        capacity_cpu: conv::node_qty(&capacity, "cpu"),
        capacity_memory: conv::node_qty(&capacity, "memory"),
        allocatable_cpu: conv::node_qty(&allocatable, "cpu"),
        allocatable_memory: conv::node_qty(&allocatable, "memory"),
        usage_cpu: usage.get(&name).map(|(c, _)| c.clone()).filter(|s| !s.is_empty()),
        usage_memory: usage.get(&name).map(|(_, m)| m.clone()).filter(|s| !s.is_empty()),
        pod_count: pods_per_node.get(&name).copied().unwrap_or(0),
        taints,
        created_at: conv::created_at(n.metadata.creation_timestamp.as_ref()),
        spot: conv::node_is_spot(n),
        capacity_type: conv::node_capacity_type(n).to_string(),
    }
}
