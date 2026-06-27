//! `GET /api/services?ns=` — Deployment-backed logical services.
//!
//! A "service" here is a Deployment joined with its same-named core/v1 Service
//! (for ports + external URL) and a rolled-up health verb.

use std::collections::BTreeMap;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::Deployment as K8sDeployment;
use k8s_openapi::api::core::v1::Service as K8sService;
use k8s_openapi::api::networking::v1::Ingress;
use kube::api::ListParams;
use kube::Api;
use serde::Deserialize;

use crate::conv;
use crate::dto::{Page, PageQuery, Service, ServicePort};
use crate::error::ApiResult;
use crate::k8s::{managed_namespaces, require_namespace};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/services", get(list_services))
}

#[derive(Debug, Deserialize)]
struct NsQuery {
    ns: Option<String>,
}

async fn list_services(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<Service>>> {
    // Resolve the namespace set: one (validated) ns, or the full allowlist.
    let namespaces: Vec<String> = match &q.ns {
        Some(ns) => {
            require_namespace(ns)?;
            vec![ns.clone()]
        }
        None => managed_namespaces().to_vec(),
    };

    let mut out = Vec::new();
    for ns in namespaces {
        let deploys: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);
        let svcs: Api<K8sService> = Api::namespaced(st.kube.clone(), &ns);
        let ingresses: Api<Ingress> = Api::namespaced(st.kube.clone(), &ns);

        let deploy_list = deploys.list(&ListParams::default()).await?;
        let svc_list = svcs.list(&ListParams::default()).await?;
        let ing_list = ingresses.list(&ListParams::default()).await?;

        // Index Services and Ingress hosts by their selector/backend target.
        let svc_by_name: BTreeMap<String, &K8sService> = svc_list
            .items
            .iter()
            .filter_map(|s| s.metadata.name.clone().map(|n| (n, s)))
            .collect();
        let url_by_service = index_ingress_urls(&ing_list.items);

        for d in &deploy_list.items {
            let name = match &d.metadata.name {
                Some(n) => n.clone(),
                None => continue,
            };
            let spec = d.spec.as_ref();
            let status = d.status.as_ref();
            let replicas_desired = spec.and_then(|s| s.replicas).unwrap_or(0);
            let replicas_ready = status.and_then(|s| s.ready_replicas).unwrap_or(0);

            let image = spec
                .and_then(|s| s.template.spec.as_ref())
                .and_then(|p| conv::primary_container(&p.containers))
                .and_then(|c| c.image.clone())
                .unwrap_or_default();

            // Match the Service that shares the Deployment's name (common
            // convention); fall back to no ports.
            let matched_svc = svc_by_name.get(&name);
            let ports = matched_svc
                .map(|s| service_ports(s))
                .unwrap_or_default();
            let url = matched_svc
                .and_then(|_| url_by_service.get(&name).cloned());

            out.push(Service {
                name: name.clone(),
                namespace: ns.clone(),
                image,
                health: conv::deployment_health(d),
                replicas_desired,
                replicas_ready,
                ports,
                url,
                created_at: conv::created_at(d.metadata.creation_timestamp.as_ref()),
                labels: d.metadata.labels.clone().unwrap_or_default(),
            });
        }
    }

    out.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

fn service_ports(s: &K8sService) -> Vec<ServicePort> {
    s.spec
        .as_ref()
        .and_then(|sp| sp.ports.as_ref())
        .map(|ports| {
            ports
                .iter()
                .map(|p| ServicePort {
                    name: p.name.clone(),
                    port: p.port,
                    target_port: match &p.target_port {
                        Some(k8s_openapi::apimachinery::pkg::util::intstr::IntOrString::Int(i)) => {
                            serde_json::json!(i)
                        }
                        Some(k8s_openapi::apimachinery::pkg::util::intstr::IntOrString::String(
                            s,
                        )) => serde_json::json!(s),
                        None => serde_json::json!(p.port),
                    },
                    protocol: p.protocol.clone().unwrap_or_else(|| "TCP".to_string()),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map backend Service name -> first external URL found in any Ingress rule.
fn index_ingress_urls(ingresses: &[Ingress]) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for ing in ingresses {
        let Some(spec) = &ing.spec else { continue };
        let Some(rules) = &spec.rules else { continue };
        for rule in rules {
            let Some(host) = &rule.host else { continue };
            let Some(http) = &rule.http else { continue };
            for path in &http.paths {
                if let Some(svc) = &path.backend.service {
                    let scheme = if spec.tls.is_some() { "https" } else { "http" };
                    map.entry(svc.name.clone())
                        .or_insert_with(|| format!("{scheme}://{host}"));
                }
            }
        }
    }
    map
}
