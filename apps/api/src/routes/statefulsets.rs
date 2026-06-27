//! StatefulSets — the stateful tier (Kafka, ZooKeeper, Redis, ES, Neo4j, …).
//!
//!   GET   /api/statefulsets/:ns                 list
//!   GET   /api/statefulsets/:ns/:name           one
//!   PATCH /api/statefulsets/:ns/:name/scale     body ScaleRequest (audited)
//!   POST  /api/statefulsets/:ns/:name/restart   rolling restart (audited)
//!
//! RBAC (`statefulsets` + `statefulsets/scale`) is already granted. ⚠️ Scaling
//! the stateful tier is high-impact (these hold data) — every change is audited.

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use k8s_openapi::api::apps::v1::StatefulSet as K8sSts;
use kube::api::{ListParams, Patch, PatchParams};
use kube::Api;

use crate::auth::Identity;
use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{AuditAction, HealthStatus, MutationAck, Page, PageQuery, ScaleRequest, StatefulSetSummary};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/statefulsets/:ns", get(list_sts))
        .route("/api/statefulsets/:ns/:name", get(get_sts))
        .route(
            "/api/statefulsets/:ns/:name/scale",
            axum::routing::patch(scale_sts),
        )
        .route("/api/statefulsets/:ns/:name/restart", post(restart_sts))
}

fn health(desired: i32, ready: i32) -> HealthStatus {
    if desired == 0 {
        HealthStatus::Unknown
    } else if ready >= desired {
        HealthStatus::Healthy
    } else if ready == 0 {
        HealthStatus::Degraded
    } else {
        HealthStatus::Progressing
    }
}

fn to_dto(s: &K8sSts) -> StatefulSetSummary {
    let spec = s.spec.as_ref();
    let status = s.status.as_ref();
    let desired = spec.and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = status.and_then(|st| st.ready_replicas).unwrap_or(0);
    let image = spec
        .and_then(|sp| sp.template.spec.as_ref())
        .and_then(|t| t.containers.first())
        .and_then(|c| c.image.clone())
        .unwrap_or_default();

    StatefulSetSummary {
        name: s.metadata.name.clone().unwrap_or_default(),
        namespace: s.metadata.namespace.clone().unwrap_or_default(),
        image,
        health: health(desired, ready),
        replicas_desired: desired,
        replicas_ready: ready,
        service_name: spec.map(|sp| sp.service_name.clone()),
        update_strategy: spec
            .and_then(|sp| sp.update_strategy.as_ref())
            .and_then(|u| u.type_.clone()),
        created_at: conv::created_at(s.metadata.creation_timestamp.as_ref()),
    }
}

async fn list_sts(
    State(st): State<AppState>,
    Path(ns): Path<String>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<StatefulSetSummary>>> {
    require_namespace(&ns)?;
    let api: Api<K8sSts> = Api::namespaced(st.kube.clone(), &ns);
    let list = api.list(&ListParams::default()).await?;
    let mut out: Vec<StatefulSetSummary> = list.items.iter().map(to_dto).collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

async fn get_sts(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<StatefulSetSummary>> {
    require_namespace(&ns)?;
    let api: Api<K8sSts> = Api::namespaced(st.kube.clone(), &ns);
    let s = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("statefulset {ns}/{name}")))?;
    Ok(Json(to_dto(&s)))
}

async fn scale_sts(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Json(body): Json<ScaleRequest>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    if body.replicas < 0 {
        return Err(ApiError::BadRequest("replicas must be >= 0".into()));
    }
    let api: Api<K8sSts> = Api::namespaced(st.kube.clone(), &ns);
    let current = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("statefulset {ns}/{name}")))?;
    let previous = current.spec.and_then(|s| s.replicas).unwrap_or(0);

    let patch = serde_json::json!({ "spec": { "replicas": body.replicas } });
    api.patch_scale(&name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::Scale,
            target_ns: Some(&ns),
            target_kind: Some("StatefulSet"),
            target_name: Some(&name),
            detail: serde_json::json!({ "from": previous, "to": body.replicas }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

async fn restart_sts(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let api: Api<K8sSts> = Api::namespaced(st.kube.clone(), &ns);
    if api.get_opt(&name).await?.is_none() {
        return Err(ApiError::NotFound(format!("statefulset {ns}/{name}")));
    }
    let now = chrono::Utc::now().to_rfc3339();
    let patch = serde_json::json!({
        "spec": { "template": { "metadata": { "annotations": {
            "kubectl.kubernetes.io/restartedAt": now
        }}}}
    });
    api.patch(&name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::Restart,
            target_ns: Some(&ns),
            target_kind: Some("StatefulSet"),
            target_name: Some(&name),
            detail: serde_json::json!({ "restartedAt": now }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}
