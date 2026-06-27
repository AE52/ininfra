//! HorizontalPodAutoscalers (autoscaling/v2) — view + edit min/max/target CPU.
//!
//!   GET   /api/hpa/:ns               list HPAs in a namespace
//!   GET   /api/hpa/:ns/:name         one HPA
//!   PATCH /api/hpa/:ns/:name         body HpaPatch — change min/max/target CPU
//!
//! RBAC (`horizontalpodautoscalers: get/list/watch/patch`) is already granted.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::autoscaling::v2::HorizontalPodAutoscaler as Hpa2;
use kube::api::{ListParams, Patch, PatchParams};
use kube::Api;

use crate::auth::Identity;
use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{AuditAction, Hpa, HpaPatch, MutationAck, Page, PageQuery};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/hpa/:ns", get(list_hpa))
        .route(
            "/api/hpa/:ns/:name",
            get(get_hpa).patch(patch_hpa),
        )
}

fn to_dto(h: &Hpa2) -> Hpa {
    let name = h.metadata.name.clone().unwrap_or_default();
    let namespace = h.metadata.namespace.clone().unwrap_or_default();
    let spec = h.spec.as_ref();
    let status = h.status.as_ref();

    // Target CPU: first Resource metric named "cpu" with Utilization target.
    let target_cpu = spec.and_then(|s| {
        s.metrics.as_ref().and_then(|ms| {
            ms.iter().find_map(|m| {
                m.resource.as_ref().filter(|r| r.name == "cpu").and_then(|r| {
                    r.target.average_utilization
                })
            })
        })
    });
    // Current CPU from status.currentMetrics.
    let current_cpu = status.and_then(|s| {
        s.current_metrics.as_ref().and_then(|ms| {
            ms.iter().find_map(|m| {
                m.resource.as_ref().filter(|r| r.name == "cpu").and_then(|r| {
                    r.current.average_utilization
                })
            })
        })
    });

    Hpa {
        name,
        namespace,
        target_kind: spec.map(|s| s.scale_target_ref.kind.clone()).unwrap_or_default(),
        target_name: spec.map(|s| s.scale_target_ref.name.clone()).unwrap_or_default(),
        min_replicas: spec.and_then(|s| s.min_replicas).unwrap_or(1),
        max_replicas: spec.map(|s| s.max_replicas).unwrap_or(1),
        current_replicas: status.and_then(|s| s.current_replicas).unwrap_or(0),
        desired_replicas: status.map(|s| s.desired_replicas).unwrap_or(0),
        target_cpu,
        current_cpu,
        created_at: conv::created_at(h.metadata.creation_timestamp.as_ref()),
    }
}

async fn list_hpa(
    State(st): State<AppState>,
    Path(ns): Path<String>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<Hpa>>> {
    require_namespace(&ns)?;
    let api: Api<Hpa2> = Api::namespaced(st.kube.clone(), &ns);
    let list = api.list(&ListParams::default()).await?;
    let mut out: Vec<Hpa> = list.items.iter().map(to_dto).collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

async fn get_hpa(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<Hpa>> {
    require_namespace(&ns)?;
    let api: Api<Hpa2> = Api::namespaced(st.kube.clone(), &ns);
    let h = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("hpa {ns}/{name}")))?;
    Ok(Json(to_dto(&h)))
}

async fn patch_hpa(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Json(body): Json<HpaPatch>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let api: Api<Hpa2> = Api::namespaced(st.kube.clone(), &ns);
    let current = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("hpa {ns}/{name}")))?;
    let before = to_dto(&current);

    if let (Some(mn), Some(mx)) = (body.min_replicas, body.max_replicas) {
        if mn < 1 || mx < mn {
            return Err(ApiError::BadRequest(
                "require 1 <= minReplicas <= maxReplicas".into(),
            ));
        }
    }

    // Build a merge patch. minReplicas/maxReplicas are scalars; for target CPU
    // we replace spec.metrics with a single CPU Utilization metric (these HPAs
    // are CPU-only).
    let mut spec = serde_json::Map::new();
    if let Some(mn) = body.min_replicas {
        spec.insert("minReplicas".into(), serde_json::json!(mn));
    }
    if let Some(mx) = body.max_replicas {
        spec.insert("maxReplicas".into(), serde_json::json!(mx));
    }
    if let Some(cpu) = body.target_cpu {
        if !(1..=100).contains(&cpu) {
            return Err(ApiError::BadRequest("targetCpu must be 1..100".into()));
        }
        spec.insert(
            "metrics".into(),
            serde_json::json!([{
                "type": "Resource",
                "resource": {
                    "name": "cpu",
                    "target": { "type": "Utilization", "averageUtilization": cpu }
                }
            }]),
        );
    }
    if spec.is_empty() {
        return Err(ApiError::BadRequest("no changes provided".into()));
    }
    let patch = serde_json::json!({ "spec": spec });
    api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::EditHpa,
            target_ns: Some(&ns),
            target_kind: Some("HorizontalPodAutoscaler"),
            target_name: Some(&name),
            detail: serde_json::json!({
                "from": { "min": before.min_replicas, "max": before.max_replicas, "targetCpu": before.target_cpu },
                "to": { "min": body.min_replicas, "max": body.max_replicas, "targetCpu": body.target_cpu }
            }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}
