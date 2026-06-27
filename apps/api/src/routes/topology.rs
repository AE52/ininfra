//! Pod topology & PodDisruptionBudget safety view.
//!
//!   GET /api/topology/:kind/:ns/:name   (kind ∈ deployment | statefulset)
//!
//! A read-only, `require_namespace`-gated answer to "where do this workload's
//! replicas actually run, and is voluntary disruption safe?":
//!
//!   * resolve the workload's pod label selector (`spec.selector.matchLabels`),
//!   * list the workload's pods in the namespace and keep the *scheduled* ones
//!     (a pod with a `spec.nodeName`),
//!   * map each pod's node → that node's `topology.kubernetes.io/zone` (and
//!     region) by listing nodes once and building a name→labels map,
//!   * aggregate per-node and per-zone counts,
//!   * flag single-node / single-zone SPOFs,
//!   * find the PodDisruptionBudget whose selector matches the workload's pods
//!     and surface its live budget/status.
//!
//! Strictly read-only: governed by the `topology.read` permission and the same
//! managed-namespace allowlist as every other read endpoint.

use std::collections::BTreeMap;

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment as K8sDeployment, StatefulSet as K8sSts};
use k8s_openapi::api::core::v1::{Node as K8sNode, Pod as K8sPod};
use k8s_openapi::api::policy::v1::PodDisruptionBudget;
use k8s_openapi::apimachinery::pkg::util::intstr::IntOrString;
use kube::api::ListParams;
use kube::Api;

use crate::dto::{PdbStatus, TopologyNode, TopologyResponse, TopologyZone};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/topology/:kind/:ns/:name", get(topology))
}

/// The node label carrying the availability zone. Falls back to the deprecated
/// `failure-domain.beta.kubernetes.io/zone` for older nodes (mirrors `nodes.rs`).
const ZONE_LABEL: &str = "topology.kubernetes.io/zone";
const ZONE_LABEL_LEGACY: &str = "failure-domain.beta.kubernetes.io/zone";

/// Render an `IntOrString` as it was written (e.g. `2` → "2", `25%` stays "25%").
fn int_or_string(v: &IntOrString) -> String {
    match v {
        IntOrString::Int(i) => i.to_string(),
        IntOrString::String(s) => s.clone(),
    }
}

/// True when `labels` is a superset of every key/value in `selector`. An empty
/// selector never matches (avoids accidentally claiming every pod in the ns) —
/// the same convention used by `rightsizing.rs::labels_match`.
fn labels_match(selector: &BTreeMap<String, String>, labels: &BTreeMap<String, String>) -> bool {
    if selector.is_empty() {
        return false;
    }
    selector
        .iter()
        .all(|(k, v)| labels.get(k).map(|lv| lv == v).unwrap_or(false))
}

/// Read a node's zone from its labels (current label, then the legacy one).
fn node_zone(labels: &BTreeMap<String, String>) -> Option<String> {
    labels
        .get(ZONE_LABEL)
        .or_else(|| labels.get(ZONE_LABEL_LEGACY))
        .cloned()
}

async fn topology(
    State(st): State<AppState>,
    Path((kind, ns, name)): Path<(String, String, String)>,
) -> ApiResult<Json<TopologyResponse>> {
    require_namespace(&ns)?;
    let kind = kind.to_ascii_lowercase();

    // 1. Resolve the workload's pod label selector (spec.selector.matchLabels).
    let selector: BTreeMap<String, String> = match kind.as_str() {
        "deployment" => {
            let api: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);
            let d = api
                .get_opt(&name)
                .await?
                .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{name}")))?;
            d.spec
                .and_then(|s| s.selector.match_labels)
                .unwrap_or_default()
        }
        "statefulset" => {
            let api: Api<K8sSts> = Api::namespaced(st.kube.clone(), &ns);
            let s = api
                .get_opt(&name)
                .await?
                .ok_or_else(|| ApiError::NotFound(format!("statefulset {ns}/{name}")))?;
            s.spec
                .and_then(|sp| sp.selector.match_labels)
                .unwrap_or_default()
        }
        other => {
            return Err(ApiError::BadRequest(format!(
                "unsupported kind {other:?} (expected one of: deployment, statefulset)"
            )))
        }
    };

    // 2. List the workload's pods in the namespace (server-side label filter).
    //    A null/empty selector would match nothing here, which is correct: a
    //    workload with no selector owns no pods.
    let pods_api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);
    let mut lp = ListParams::default();
    if !selector.is_empty() {
        let sel = selector
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join(",");
        lp = lp.labels(&sel);
    }
    let pods = pods_api.list(&lp).await?.items;

    // 3. List nodes once → name→zone map (one list call, reused across pods).
    let nodes_api: Api<K8sNode> = Api::all(st.kube.clone());
    let node_list = nodes_api.list(&ListParams::default()).await?;
    let mut node_zone_map: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut cluster_zones: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for n in &node_list.items {
        let nname = n.metadata.name.clone().unwrap_or_default();
        let labels = n.metadata.labels.clone().unwrap_or_default();
        let zone = node_zone(&labels);
        if let Some(z) = &zone {
            cluster_zones.insert(z.clone());
        }
        node_zone_map.insert(nname, zone);
    }
    // How many distinct zones the cluster spans — drives the single-zone flag.
    let cluster_zone_count = cluster_zones.len();

    // 4. Aggregate scheduled pods by node and by zone. A pod is "scheduled" when
    //    it has a spec.nodeName (regardless of phase, so we still account for
    //    pods that are starting up); unscheduled/pending pods don't occupy a
    //    node so they're excluded from the distribution.
    let mut per_node: BTreeMap<String, i32> = BTreeMap::new();
    let mut per_zone: BTreeMap<Option<String>, i32> = BTreeMap::new();
    let mut total_pods: i32 = 0;
    for p in &pods {
        let node_name = match p.spec.as_ref().and_then(|s| s.node_name.clone()) {
            Some(n) if !n.is_empty() => n,
            _ => continue, // unscheduled — no node to place it on
        };
        total_pods += 1;
        *per_node.entry(node_name.clone()).or_insert(0) += 1;
        // Unknown node (not in the listed set) → unknown zone (None).
        let zone = node_zone_map.get(&node_name).cloned().flatten();
        *per_zone.entry(zone).or_insert(0) += 1;
    }

    // Node rows, highest-count first then name for stable ordering.
    let mut node_rows: Vec<TopologyNode> = per_node
        .into_iter()
        .map(|(node, count)| {
            let zone = node_zone_map.get(&node).cloned().flatten();
            TopologyNode { node, zone, count }
        })
        .collect();
    node_rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.node.cmp(&b.node)));

    // Zone rows, highest-count first; unknown zone (None) sorts last on ties.
    let mut zone_rows: Vec<TopologyZone> = per_zone
        .into_iter()
        .map(|(zone, count)| TopologyZone { zone, count })
        .collect();
    zone_rows.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.zone.cmp(&b.zone))
    });

    // 5. SPOF flags.
    //   * single_node: every counted pod landed on one node.
    //   * single_zone: every counted pod landed in one *known* zone AND the
    //     cluster spans more than one zone (a single-zone cluster can't spread,
    //     so flagging it would be noise).
    let single_node = total_pods > 0 && node_rows.len() == 1;
    let distinct_known_zones = zone_rows.iter().filter(|z| z.zone.is_some()).count();
    let single_zone =
        total_pods > 0 && distinct_known_zones == 1 && cluster_zone_count > 1;

    // 6. Find the PodDisruptionBudget whose selector matches this workload's
    //    pods. We match by selector → pod labels: a PDB applies to a pod when
    //    every key/value in the PDB's matchLabels is present on the pod. We test
    //    the PDB selector against the *workload's* selector labels (those are the
    //    labels the controller stamps on every replica), which is robust even
    //    when the namespace currently has zero running pods.
    let pdb_api: Api<PodDisruptionBudget> = Api::namespaced(st.kube.clone(), &ns);
    let pdb = pdb_api
        .list(&ListParams::default())
        .await?
        .items
        .into_iter()
        .find(|p| {
            p.spec
                .as_ref()
                .and_then(|s| s.selector.as_ref())
                .and_then(|sel| sel.match_labels.clone())
                .map(|ml| labels_match(&ml, &selector))
                .unwrap_or(false)
        });

    let pdb = pdb.map(|p| {
        let spec = p.spec.as_ref();
        let status = p.status.as_ref();
        PdbStatus {
            name: p.metadata.name.clone().unwrap_or_default(),
            min_available: spec
                .and_then(|s| s.min_available.as_ref())
                .map(int_or_string),
            max_unavailable: spec
                .and_then(|s| s.max_unavailable.as_ref())
                .map(int_or_string),
            current_healthy: status.map(|s| s.current_healthy).unwrap_or(0),
            desired_healthy: status.map(|s| s.desired_healthy).unwrap_or(0),
            disruptions_allowed: status.map(|s| s.disruptions_allowed).unwrap_or(0),
            expected_pods: status.map(|s| s.expected_pods).unwrap_or(0),
        }
    });

    Ok(Json(TopologyResponse {
        namespace: ns,
        name,
        kind,
        total_pods,
        nodes: node_rows,
        zones: zone_rows,
        single_node,
        single_zone,
        pdb,
    }))
}
