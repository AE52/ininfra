//! Right-sizing advisory — read-only resource recommendations.
//!
//!   GET /api/rightsizing?ns=<optional>
//!
//! For each Deployment and StatefulSet in scope, this compares the workload's
//! configured CPU/memory requests & limits (summed per replica across the pod
//! template's containers) against live aggregate usage from metrics-server
//! (`metrics.k8s.io/v1beta1` `PodMetrics`), and emits a conservative advisory
//! flag. Nothing is ever applied — this is purely informational.
//!
//! Graceful degradation: if metrics-server is absent the `metrics.k8s.io` API
//! 404s; we treat that as "no usage" (usage fields `null`, `metricsAvailable
//! = false`, recommendation `unknown`) rather than erroring, so the page works
//! on clusters without metrics-server.

use std::collections::BTreeMap;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment as K8sDeployment, StatefulSet as K8sSts};
use k8s_openapi::api::core::v1::Pod as K8sPod;
use kube::api::{DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use kube::Api;
use serde::Deserialize;

use crate::dto::{Page, PageQuery, RightsizingRecommendation, RightsizingRow};
use crate::error::ApiResult;
use crate::k8s::{managed_namespaces, require_namespace};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/rightsizing", get(list_rightsizing))
}

#[derive(Debug, Deserialize)]
struct NsQuery {
    ns: Option<String>,
}

const MI: i64 = 1024 * 1024;

/// Parse a k8s CPU quantity into whole millicores. Handles "123m" and plain
/// integer/decimal cores ("2", "0.5"). (Same logic as `nodes.rs`/`pods.rs`.)
fn parse_cpu_millicores(q: &str) -> i64 {
    if let Some(m) = q.strip_suffix('m') {
        m.parse::<i64>().unwrap_or(0)
    } else {
        (q.parse::<f64>().unwrap_or(0.0) * 1000.0).round() as i64
    }
}

/// Parse a k8s memory quantity into bytes. Handles Ki/Mi/Gi/Ti (binary) and
/// K/M/G/T (decimal). (Same logic as `nodes.rs`/`pods.rs`.)
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

/// Live per-pod usage `(cpu_millicores, mem_bytes)` from metrics-server, scoped
/// to one namespace, keyed by pod name. Mirrors the `PodMetrics` query in
/// `nodes.rs`/`pods.rs`: each PodMetrics item has a `.containers[]` array whose
/// `.usage.{cpu,memory}` we sum per pod.
///
/// Returns `(map, available)` where `available` distinguishes "metrics-server
/// present but this namespace has no pods" from "metrics.k8s.io unreachable".
/// On any list error (e.g. metrics.k8s.io 404 → metrics-server absent) we
/// return an empty map with `available = false` so callers degrade gracefully.
async fn pod_usage(
    kube: &kube::Client,
    namespace: &str,
) -> (BTreeMap<String, (i64, i64)>, bool) {
    let gvk = GroupVersionKind::gvk("metrics.k8s.io", "v1beta1", "PodMetrics");
    let ar = ApiResource::from_gvk(&gvk);
    let api: Api<DynamicObject> = Api::namespaced_with(kube.clone(), namespace, &ar);
    let mut out = BTreeMap::new();
    let list = match api.list(&ListParams::default()).await {
        Ok(l) => l,
        // metrics.k8s.io unavailable (metrics-server absent) → degrade, no error.
        Err(_) => return (out, false),
    };
    for m in list.items {
        let name = match m.metadata.name.clone() {
            Some(n) => n,
            None => continue,
        };
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
        out.insert(name, (total_cpu_m, total_mem_bytes));
    }
    (out, true)
}

/// Per-replica configured requests/limits summed across a pod template's
/// containers, plus whether requests are set at all.
#[derive(Default)]
struct ConfiguredResources {
    requests_cpu_m: Option<i64>,
    limits_cpu_m: Option<i64>,
    requests_mem_b: Option<i64>,
    limits_mem_b: Option<i64>,
}

/// Sum requests & limits (cpu + memory) across a pod template's containers.
/// A resource is `Some(0)` if a container set it to 0 explicitly, but `None`
/// if no container declares it — the distinction drives the `no_requests` flag.
fn sum_container_resources(
    containers: &[k8s_openapi::api::core::v1::Container],
) -> ConfiguredResources {
    let mut out = ConfiguredResources::default();
    for c in containers {
        if let Some(res) = c.resources.as_ref() {
            if let Some(reqs) = res.requests.as_ref() {
                if let Some(q) = reqs.get("cpu") {
                    *out.requests_cpu_m.get_or_insert(0) += parse_cpu_millicores(&q.0);
                }
                if let Some(q) = reqs.get("memory") {
                    *out.requests_mem_b.get_or_insert(0) += parse_memory_bytes(&q.0);
                }
            }
            if let Some(lims) = res.limits.as_ref() {
                if let Some(q) = lims.get("cpu") {
                    *out.limits_cpu_m.get_or_insert(0) += parse_cpu_millicores(&q.0);
                }
                if let Some(q) = lims.get("memory") {
                    *out.limits_mem_b.get_or_insert(0) += parse_memory_bytes(&q.0);
                }
            }
        }
    }
    out
}

/// True when `labels` is a superset of every key/value in `selector`. An empty
/// selector never matches (avoids accidentally claiming every pod).
fn labels_match(selector: &BTreeMap<String, String>, labels: &BTreeMap<String, String>) -> bool {
    if selector.is_empty() {
        return false;
    }
    selector
        .iter()
        .all(|(k, v)| labels.get(k).map(|lv| lv == v).unwrap_or(false))
}

/// Recommendation thresholds. Conservative by design: we only flag when metrics
/// are available, and only at clear margins.
const OVER_PROVISIONED_RATIO: f64 = 0.50; // avg usage < 50% of per-replica requests
const UNDER_PROVISIONED_RATIO: f64 = 0.90; // avg usage > 90% of per-replica limits

/// Compute the advisory verdict from per-replica requests/limits and per-replica
/// average usage.
///
/// * `no_requests`      — neither CPU nor memory requests are set.
/// * `under_provisioned`— per-replica avg usage exceeds 90% of a per-replica
///                        limit on either resource (throttle / OOM risk).
/// * `over_provisioned` — per-replica avg usage is below 50% of the per-replica
///                        request on every resource that has both a request and
///                        non-zero usage (room to shrink).
/// * `ok`               — otherwise (requests look reasonable).
fn recommend(
    requests_cpu_m: Option<i64>,
    limits_cpu_m: Option<i64>,
    requests_mem_b: Option<i64>,
    limits_mem_b: Option<i64>,
    usage_cpu_m_per_replica: i64,
    usage_mem_b_per_replica: i64,
) -> RightsizingRecommendation {
    let has_cpu_req = requests_cpu_m.map(|v| v > 0).unwrap_or(false);
    let has_mem_req = requests_mem_b.map(|v| v > 0).unwrap_or(false);
    if !has_cpu_req && !has_mem_req {
        return RightsizingRecommendation::NoRequests;
    }

    // Under-provisioned wins (it's the riskier signal): usage near/over a limit.
    let over_limit = |used: i64, limit: Option<i64>| -> bool {
        match limit {
            Some(l) if l > 0 => (used as f64) > (l as f64) * UNDER_PROVISIONED_RATIO,
            _ => false,
        }
    };
    if over_limit(usage_cpu_m_per_replica, limits_cpu_m)
        || over_limit(usage_mem_b_per_replica, limits_mem_b)
    {
        return RightsizingRecommendation::UnderProvisioned;
    }

    // Over-provisioned: every resource that has a request AND observed usage is
    // running well under it. Resources without a request, or with zero usage,
    // are ignored so we don't flag idle-but-correctly-sized workloads.
    let under_request = |used: i64, req: Option<i64>| -> Option<bool> {
        match req {
            Some(r) if r > 0 && used > 0 => {
                Some((used as f64) < (r as f64) * OVER_PROVISIONED_RATIO)
            }
            _ => None,
        }
    };
    let cpu_signal = under_request(usage_cpu_m_per_replica, requests_cpu_m);
    let mem_signal = under_request(usage_mem_b_per_replica, requests_mem_b);
    let signals: Vec<bool> = [cpu_signal, mem_signal].into_iter().flatten().collect();
    if !signals.is_empty() && signals.iter().all(|&s| s) {
        return RightsizingRecommendation::OverProvisioned;
    }

    RightsizingRecommendation::Ok
}

/// Build one row for a workload from its selector + per-replica configured
/// resources + the namespace's pod list and usage map.
#[allow(clippy::too_many_arguments)]
fn build_row(
    namespace: &str,
    name: &str,
    kind: &str,
    replicas: i32,
    selector: &BTreeMap<String, String>,
    cfg: &ConfiguredResources,
    pods: &[K8sPod],
    usage: &BTreeMap<String, (i64, i64)>,
    metrics_namespace_available: bool,
) -> RightsizingRow {
    // Pods belonging to this workload by label selector.
    let matched: Vec<&K8sPod> = pods
        .iter()
        .filter(|p| {
            let labels = p.metadata.labels.clone().unwrap_or_default();
            labels_match(selector, &labels)
        })
        .collect();

    // Sum live usage across matched pods that have a metrics sample.
    let mut total_cpu_m: i64 = 0;
    let mut total_mem_b: i64 = 0;
    let mut sampled_pods: i64 = 0;
    for p in &matched {
        if let Some(pod_name) = p.metadata.name.as_deref() {
            if let Some((cpu_m, mem_b)) = usage.get(pod_name) {
                total_cpu_m += cpu_m;
                total_mem_b += mem_b;
                sampled_pods += 1;
            }
        }
    }

    // metrics_available is true only when metrics-server is present AND we have
    // at least one usage sample for this workload's pods.
    let metrics_available = metrics_namespace_available && sampled_pods > 0;

    let (usage_cpu_m, usage_mem_mi, usage_cpu_per_replica, usage_mem_per_replica, recommendation) =
        if metrics_available {
            let per_replica_cpu = total_cpu_m / sampled_pods;
            let per_replica_mem_b = total_mem_b / sampled_pods;
            let rec = recommend(
                cfg.requests_cpu_m,
                cfg.limits_cpu_m,
                cfg.requests_mem_b,
                cfg.limits_mem_b,
                per_replica_cpu,
                per_replica_mem_b,
            );
            (
                Some(total_cpu_m),
                Some(total_mem_b / MI),
                Some(per_replica_cpu),
                Some(per_replica_mem_b / MI),
                rec,
            )
        } else {
            (None, None, None, None, RightsizingRecommendation::Unknown)
        };

    RightsizingRow {
        namespace: namespace.to_string(),
        name: name.to_string(),
        kind: kind.to_string(),
        replicas,
        requests_cpu_m: cfg.requests_cpu_m,
        limits_cpu_m: cfg.limits_cpu_m,
        requests_mem_mi: cfg.requests_mem_b.map(|b| b / MI),
        limits_mem_mi: cfg.limits_mem_b.map(|b| b / MI),
        usage_cpu_m,
        usage_mem_mi,
        usage_cpu_m_per_replica: usage_cpu_per_replica,
        usage_mem_mi_per_replica: usage_mem_per_replica,
        metrics_available,
        recommendation,
    }
}

async fn list_rightsizing(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<RightsizingRow>>> {
    let namespaces: Vec<String> = match &q.ns {
        Some(ns) => {
            require_namespace(ns)?;
            vec![ns.clone()]
        }
        None => managed_namespaces(),
    };

    let mut out: Vec<RightsizingRow> = Vec::new();

    for ns in &namespaces {
        // Live usage (best-effort) + pods, both scoped to this namespace.
        let (usage, metrics_ns_available) = pod_usage(&st.kube, ns).await;
        let pods_api: Api<K8sPod> = Api::namespaced(st.kube.clone(), ns);
        let pods = pods_api.list(&ListParams::default()).await?.items;

        // Deployments.
        let dep_api: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), ns);
        for d in dep_api.list(&ListParams::default()).await?.items {
            let name = d.metadata.name.clone().unwrap_or_default();
            let spec = d.spec.as_ref();
            let replicas = spec.and_then(|s| s.replicas).unwrap_or(0);
            let selector = spec
                .map(|s| s.selector.match_labels.clone().unwrap_or_default())
                .unwrap_or_default();
            let containers = spec
                .and_then(|s| s.template.spec.as_ref())
                .map(|p| p.containers.as_slice())
                .unwrap_or(&[]);
            let cfg = sum_container_resources(containers);
            out.push(build_row(
                ns,
                &name,
                "Deployment",
                replicas,
                &selector,
                &cfg,
                &pods,
                &usage,
                metrics_ns_available,
            ));
        }

        // StatefulSets.
        let sts_api: Api<K8sSts> = Api::namespaced(st.kube.clone(), ns);
        for s in sts_api.list(&ListParams::default()).await?.items {
            let name = s.metadata.name.clone().unwrap_or_default();
            let spec = s.spec.as_ref();
            let replicas = spec.and_then(|sp| sp.replicas).unwrap_or(0);
            let selector = spec
                .map(|sp| sp.selector.match_labels.clone().unwrap_or_default())
                .unwrap_or_default();
            let containers = spec
                .and_then(|sp| sp.template.spec.as_ref())
                .map(|p| p.containers.as_slice())
                .unwrap_or(&[]);
            let cfg = sum_container_resources(containers);
            out.push(build_row(
                ns,
                &name,
                "StatefulSet",
                replicas,
                &selector,
                &cfg,
                &pods,
                &usage,
                metrics_ns_available,
            ));
        }
    }

    out.sort_by(|a, b| {
        (&a.namespace, &a.kind, &a.name).cmp(&(&b.namespace, &b.kind, &b.name))
    });
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}
