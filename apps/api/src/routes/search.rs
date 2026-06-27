//! Global resource search.
//!
//!   GET /api/search?q=&kind=&namespace=  -> SearchResult[]
//!
//! Searches live cluster resources (Deployments, StatefulSets, Pods, Services),
//! the managed namespaces themselves, Nodes, build-catalog services, and console
//! users (admin only), by case-insensitive name substring. Optional `kind` and
//! `namespace` filters narrow the search (and skip unneeded cluster calls).

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment, StatefulSet};
use k8s_openapi::api::core::v1::{Node, Pod, Service};
use kube::api::ListParams;
use kube::Api;
use serde::Deserialize;

use crate::auth::Identity;
use crate::conv;
use crate::dto::SearchResult;
use crate::error::ApiResult;
use crate::monitor::{health_str, sts_health};
use crate::AppState;

const MAX: usize = 60;

#[derive(Debug, Deserialize)]
struct SearchQuery {
    q: Option<String>,
    kind: Option<String>,
    namespace: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/search", get(search))
}

async fn search(
    identity: Identity,
    State(st): State<AppState>,
    Query(qp): Query<SearchQuery>,
) -> ApiResult<Json<Vec<SearchResult>>> {
    let q = qp.q.unwrap_or_default().trim().to_lowercase();
    if q.is_empty() {
        return Ok(Json(Vec::new()));
    }
    let kind_filter = qp.kind.filter(|s| !s.is_empty());
    let want = |k: &str| kind_filter.as_deref().map(|f| f == k).unwrap_or(true);
    let matches = |name: &str| name.to_lowercase().contains(&q);

    let namespaces: Vec<String> = match &qp.namespace {
        Some(ns) if !ns.is_empty() => vec![ns.clone()],
        _ => crate::k8s::managed_namespaces().to_vec(),
    };

    let mut out: Vec<SearchResult> = Vec::new();

    // Managed namespaces themselves.
    if want("namespace") {
        for ns in &crate::k8s::managed_namespaces() {
            if matches(ns) {
                out.push(SearchResult {
                    kind: "namespace".into(),
                    namespace: None,
                    name: ns.clone(),
                    status: None,
                    href: format!("/services?ns={ns}"),
                    detail: None,
                });
            }
        }
    }

    for ns in &namespaces {
        if want("deployment") {
            let api: Api<Deployment> = Api::namespaced(st.kube.clone(), ns);
            if let Ok(list) = api.list(&ListParams::default()).await {
                for d in list.items {
                    let name = d.metadata.name.clone().unwrap_or_default();
                    if !matches(&name) {
                        continue;
                    }
                    out.push(SearchResult {
                        kind: "deployment".into(),
                        namespace: Some(ns.clone()),
                        name: name.clone(),
                        status: Some(health_str(conv::deployment_health(&d)).into()),
                        href: format!("/services/{ns}/{name}"),
                        detail: d
                            .spec
                            .as_ref()
                            .and_then(|s| s.template.spec.as_ref())
                            .and_then(|p| p.containers.first())
                            .and_then(|c| c.image.clone()),
                    });
                }
            }
        }
        if want("statefulset") {
            let api: Api<StatefulSet> = Api::namespaced(st.kube.clone(), ns);
            if let Ok(list) = api.list(&ListParams::default()).await {
                for s in list.items {
                    let name = s.metadata.name.clone().unwrap_or_default();
                    if !matches(&name) {
                        continue;
                    }
                    out.push(SearchResult {
                        kind: "statefulset".into(),
                        namespace: Some(ns.clone()),
                        name,
                        status: Some(health_str(sts_health(&s)).into()),
                        href: "/stateful".into(),
                        detail: None,
                    });
                }
            }
        }
        if want("service") {
            let api: Api<Service> = Api::namespaced(st.kube.clone(), ns);
            if let Ok(list) = api.list(&ListParams::default()).await {
                for s in list.items {
                    let name = s.metadata.name.clone().unwrap_or_default();
                    if !matches(&name) {
                        continue;
                    }
                    out.push(SearchResult {
                        kind: "service".into(),
                        namespace: Some(ns.clone()),
                        name: name.clone(),
                        status: None,
                        href: format!("/services/{ns}/{name}"),
                        detail: None,
                    });
                }
            }
        }
        if want("pod") {
            let api: Api<Pod> = Api::namespaced(st.kube.clone(), ns);
            if let Ok(list) = api.list(&ListParams::default()).await {
                for p in list.items {
                    let name = p.metadata.name.clone().unwrap_or_default();
                    if !matches(&name) {
                        continue;
                    }
                    out.push(SearchResult {
                        kind: "pod".into(),
                        namespace: Some(ns.clone()),
                        name,
                        status: p.status.as_ref().and_then(|s| s.phase.clone()),
                        href: format!("/services?ns={ns}"),
                        detail: None,
                    });
                }
            }
        }
        if out.len() >= MAX {
            break;
        }
    }

    // Cluster-scoped nodes.
    if want("node") {
        let api: Api<Node> = Api::all(st.kube.clone());
        if let Ok(list) = api.list(&ListParams::default()).await {
            for n in list.items {
                let name = n.metadata.name.clone().unwrap_or_default();
                if matches(&name) {
                    out.push(SearchResult {
                        kind: "node".into(),
                        namespace: None,
                        name,
                        status: None,
                        href: "/nodes".into(),
                        detail: None,
                    });
                }
            }
        }
    }

    // Console users (admin only).
    if want("user") && identity.role == "admin" {
        if let Ok(page) = crate::db::list_users(&st.db, None, 500).await {
            for u in page.items {
                if matches(&u.username) {
                    out.push(SearchResult {
                        kind: "user".into(),
                        namespace: None,
                        name: u.username,
                        status: Some(u.role),
                        href: "/users".into(),
                        detail: None,
                    });
                }
            }
        }
    }

    // Build-catalog services (best-effort; from the CI namespace's catalog CM).
    if want("build") {
        if let Some(names) = catalog_service_names(&st).await {
            for name in names {
                if matches(&name) {
                    out.push(SearchResult {
                        kind: "build".into(),
                        namespace: None,
                        name: name.clone(),
                        status: None,
                        href: format!("/builds?job={name}"),
                        detail: None,
                    });
                }
            }
        }
    }

    out.truncate(MAX);
    Ok(Json(out))
}

/// Service names from the build catalog ConfigMap (best-effort).
async fn catalog_service_names(st: &AppState) -> Option<Vec<String>> {
    use k8s_openapi::api::core::v1::ConfigMap;
    let cfg = crate::config::get();
    let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &cfg.cicd_namespace);
    let cm = api.get_opt(&cfg.build_catalog_cm).await.ok()??;
    let raw = cm.data?.get("services.json")?.clone();
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let arr = parsed.get("services")?.as_array()?;
    Some(
        arr.iter()
            .filter_map(|s| s.get("name").and_then(|v| v.as_str()).map(String::from))
            .collect(),
    )
}
