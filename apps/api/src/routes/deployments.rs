//! Deployment list/detail + scale + rollout restart.
//!
//!   GET   /api/deployments?ns=
//!   GET   /api/deployments/:ns/:name
//!   PATCH /api/deployments/:ns/:name/scale     (audited `scale`)
//!   POST  /api/deployments/:ns/:name/restart   (audited `restart`)

use axum::{
    extract::{Path, Query, State},
    routing::{get, patch, post},
    Json, Router,
};
use k8s_openapi::api::apps::v1::Deployment as K8sDeployment;
use kube::api::{ListParams, Patch, PatchParams};
use kube::Api;
use serde::Deserialize;

use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{
    AuditAction, Deployment, MutationAck, Page, PageQuery, ResourceRequirements, ScaleRequest,
};
use crate::error::{ApiError, ApiResult};
use crate::k8s::{managed_namespaces, require_namespace};
use crate::auth::Identity;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/deployments", get(list_deployments))
        .route("/api/deployments/:ns/:name", get(get_deployment))
        .route("/api/deployments/:ns/:name/scale", patch(scale_deployment))
        .route(
            "/api/deployments/:ns/:name/restart",
            post(restart_deployment),
        )
}

#[derive(Debug, Deserialize)]
struct NsQuery {
    ns: Option<String>,
}

async fn list_deployments(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<Deployment>>> {
    let namespaces: Vec<String> = match &q.ns {
        Some(ns) => {
            require_namespace(ns)?;
            vec![ns.clone()]
        }
        None => managed_namespaces().to_vec(),
    };

    let mut out = Vec::new();
    for ns in namespaces {
        let api: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);
        for d in api.list(&ListParams::default()).await?.items {
            out.push(to_dto(&d, &ns));
        }
    }
    out.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

async fn get_deployment(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<Deployment>> {
    require_namespace(&ns)?;
    let api: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);
    let d = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{name}")))?;
    Ok(Json(to_dto(&d, &ns)))
}

async fn scale_deployment(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Json(body): Json<ScaleRequest>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    if body.replicas < 0 {
        return Err(ApiError::BadRequest("replicas must be >= 0".into()));
    }

    let api: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);

    // Read current desired for the audit diff (and to 404 cleanly).
    let current = api
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{name}")))?;
    let previous = current.spec.and_then(|s| s.replicas).unwrap_or(0);

    // Patch only the replica count via the `/scale` subresource. A merge patch
    // (not server-side apply) avoids needing apiVersion/kind in the body — SSA
    // on the scale subresource fails with "invalid object type: /, Kind=".
    let patch = serde_json::json!({ "spec": { "replicas": body.replicas } });
    api.patch_scale(&name, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::Scale,
            target_ns: Some(&ns),
            target_kind: Some("Deployment"),
            target_name: Some(&name),
            detail: serde_json::json!({ "from": previous, "to": body.replicas }),
        },
    )
    .await?;

    Ok(Json(MutationAck::ok(Some(audit_id))))
}

async fn restart_deployment(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let api: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);

    // 404 cleanly before mutating.
    if api.get_opt(&name).await?.is_none() {
        return Err(ApiError::NotFound(format!("deployment {ns}/{name}")));
    }

    // `kubectl rollout restart` equivalent: stamp the pod template with a
    // restartedAt annotation, which forces a new ReplicaSet rollout.
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
            target_kind: Some("Deployment"),
            target_name: Some(&name),
            detail: serde_json::json!({ "restartedAt": now }),
        },
    )
    .await?;

    Ok(Json(MutationAck::ok(Some(audit_id))))
}

fn to_dto(d: &K8sDeployment, ns: &str) -> Deployment {
    let spec = d.spec.as_ref();
    let status = d.status.as_ref();

    let template_containers = spec
        .and_then(|s| s.template.spec.as_ref())
        .map(|p| p.containers.as_slice())
        .unwrap_or(&[]);

    let primary = conv::primary_container(template_containers);
    let image = primary.and_then(|c| c.image.clone()).unwrap_or_default();
    let resources = primary
        .map(|c| conv::resources(c.resources.as_ref()))
        .unwrap_or(ResourceRequirements {
            requests_cpu: None,
            requests_memory: None,
            limits_cpu: None,
            limits_memory: None,
        });

    let strategy = spec
        .and_then(|s| s.strategy.as_ref())
        .and_then(|st| st.type_.clone())
        .unwrap_or_else(|| "RollingUpdate".to_string());

    let (config_map_refs, secret_refs) = conv::env_refs(d);

    Deployment {
        name: d.metadata.name.clone().unwrap_or_default(),
        namespace: ns.to_string(),
        image,
        health: conv::deployment_health(d),
        replicas_desired: spec.and_then(|s| s.replicas).unwrap_or(0),
        replicas_ready: status.and_then(|s| s.ready_replicas).unwrap_or(0),
        replicas_updated: status.and_then(|s| s.updated_replicas).unwrap_or(0),
        replicas_available: status.and_then(|s| s.available_replicas).unwrap_or(0),
        strategy,
        resources,
        containers: template_containers
            .iter()
            .map(conv::container_spec)
            .collect(),
        conditions: conv::deployment_conditions(d),
        config_map_refs,
        secret_refs,
        created_at: conv::created_at(d.metadata.creation_timestamp.as_ref()),
        annotations: d.metadata.annotations.clone().unwrap_or_default(),
    }
}
