//! Pods.
//!
//!   GET    /api/pods/:ns?selector=
//!   DELETE /api/pods/:ns/:name        (audited `delete_pod`)

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::core::v1::Pod as K8sPod;
use kube::api::{DeleteParams, DynamicObject, ListParams};
use kube::core::{ApiResource, GroupVersionKind};
use kube::Api;
use serde::Deserialize;

use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{AuditAction, MutationAck, Page, PageQuery, PodSummary};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::auth::Identity;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/pods/:ns", get(list_pods))
        .route("/api/pods/:ns/:name", axum::routing::delete(delete_pod))
}

#[derive(Debug, Deserialize)]
struct SelectorQuery {
    selector: Option<String>,
}

/// Parse a k8s CPU quantity string into whole millicores (i64).
/// Handles "123m" (millicores) and plain integer/decimal cores ("2", "0.5").
fn parse_cpu_millicores(q: &str) -> i64 {
    if let Some(m) = q.strip_suffix('m') {
        m.parse::<i64>().unwrap_or(0)
    } else {
        // Plain cores (possibly fractional, e.g. "2" or "0.5")
        (q.parse::<f64>().unwrap_or(0.0) * 1000.0).round() as i64
    }
}

/// Parse a k8s memory quantity string into bytes (i64).
/// Handles Ki, Mi, Gi, Ti (binary) and K, M, G, T (decimal).
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

/// Live per-pod usage (cpu, memory) from metrics-server, scoped to one namespace.
/// Best-effort: returns an empty map if metrics.k8s.io is unavailable.
///
/// Each PodMetrics item has a `.containers[]` array; we sum all containers to get
/// the pod's total. CPU is emitted as millicores ("42m"), memory as kibibytes
/// ("65536Ki") so the frontend's `cpuToCores` / `memToBytes` can parse both.
async fn pod_usage(kube: &kube::Client, namespace: &str) -> BTreeMap<String, (String, String)> {
    let gvk = GroupVersionKind::gvk("metrics.k8s.io", "v1beta1", "PodMetrics");
    let ar = ApiResource::from_gvk(&gvk);
    let api: Api<DynamicObject> = Api::namespaced_with(kube.clone(), namespace, &ar);
    let mut out = BTreeMap::new();
    if let Ok(list) = api.list(&ListParams::default()).await {
        for m in list.items {
            let name = match m.metadata.name.clone() {
                Some(n) => n,
                None => continue,
            };
            // Sum all containers: .containers[].usage.{cpu,memory}
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
            let cpu_str = format!("{}m", total_cpu_m);
            let mem_str = format!("{}Ki", total_mem_bytes / 1024);
            out.insert(name, (cpu_str, mem_str));
        }
    }
    out
}

async fn list_pods(
    State(st): State<AppState>,
    Path(ns): Path<String>,
    Query(q): Query<SelectorQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<PodSummary>>> {
    require_namespace(&ns)?;
    let api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);
    let mut lp = ListParams::default();
    if let Some(sel) = q.selector.filter(|s| !s.is_empty()) {
        lp = lp.labels(&sel);
    }

    // Live usage from metrics-server (best-effort).
    let usage = pod_usage(&st.kube, &ns).await;

    let mut out: Vec<PodSummary> = api
        .list(&lp)
        .await?
        .items
        .iter()
        .map(|p| {
            let mut summary = conv::pod_summary(p);
            if let Some((cpu, mem)) = usage.get(&summary.name) {
                summary.usage_cpu = Some(cpu.clone());
                summary.usage_memory = Some(mem.clone());
            }
            summary
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

async fn delete_pod(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);
    if api.get_opt(&name).await?.is_none() {
        return Err(ApiError::NotFound(format!("pod {ns}/{name}")));
    }
    api.delete(&name, &DeleteParams::default()).await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::DeletePod,
            target_ns: Some(&ns),
            target_kind: Some("Pod"),
            target_name: Some(&name),
            detail: serde_json::json!({}),
        },
    )
    .await?;

    Ok(Json(MutationAck::ok(Some(audit_id))))
}
