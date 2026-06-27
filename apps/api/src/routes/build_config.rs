//! Build catalog — view and change a service's deploy branch.
//!
//!   GET   /api/build-config/:ns               list services + their branch
//!   PATCH /api/build-config/:ns/:service      change a service's branch
//!
//! The catalog lives in a ConfigMap (name configurable via the
//! `BUILD_CATALOG_CONFIGMAP` env var), key
//! `services.json` (an array of service objects). CI/CD (`run-cicd.sh`) reads
//! `branch` from here to resolve the commit to build. Changing it is a JSON
//! merge-patch of that ConfigMap — covered by the existing `configmaps: patch`
//! RBAC, no new grant needed.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::core::v1::ConfigMap;
use kube::api::{Patch, PatchParams};
use kube::Api;

use crate::auth::Identity;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{AuditAction, BranchChange, BuildConfigService, MutationAck};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

/// Build catalog ConfigMap name (runtime config).
fn catalog_cm() -> &'static str {
    &crate::config::get().build_catalog_cm
}
const CATALOG_KEY: &str = "services.json";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/build-config/:ns", get(list_services))
        .route(
            "/api/build-config/:ns/:service",
            axum::routing::patch(change_branch),
        )
}

/// Read + parse the `services.json` array out of the catalog ConfigMap.
async fn load_catalog(
    api: &Api<ConfigMap>,
) -> ApiResult<Vec<serde_json::Value>> {
    let cm_name = catalog_cm();
    let cm = api
        .get_opt(cm_name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("configmap {cm_name}")))?;
    let raw = cm
        .data
        .as_ref()
        .and_then(|d| d.get(CATALOG_KEY))
        .ok_or_else(|| ApiError::NotFound(format!("{cm_name}/{CATALOG_KEY}")))?;
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("services.json parse: {e}")))?;
    let arr = parsed
        .get("services")
        .and_then(|s| s.as_array())
        .cloned()
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("services.json has no 'services' array")))?;
    Ok(arr)
}

async fn list_services(
    State(st): State<AppState>,
    Path(ns): Path<String>,
) -> ApiResult<Json<Vec<BuildConfigService>>> {
    require_namespace(&ns)?;
    let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &ns);
    // The build catalog is OPTIONAL. When the ConfigMap (or its services.json
    // key) is absent, there is nothing to manage — return an empty list (200)
    // so the UI shows a clean "no catalog" state instead of a 404.
    let arr = match load_catalog(&api).await {
        Ok(a) => a,
        Err(ApiError::NotFound(_)) => return Ok(Json(Vec::new())),
        Err(e) => return Err(e),
    };

    let mut out: Vec<BuildConfigService> = arr
        .iter()
        .map(|s| BuildConfigService {
            name: s.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            repo: s.get("repo").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            branch: s.get("branch").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            enabled: s.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
            dockerfile_path: s
                .get("dockerfilePath")
                .and_then(|v| v.as_str())
                .unwrap_or("Dockerfile")
                .to_string(),
            context_dir: s
                .get("contextDir")
                .and_then(|v| v.as_str())
                .unwrap_or(".")
                .to_string(),
        })
        .filter(|s| !s.name.is_empty())
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(out))
}

async fn change_branch(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, service)): Path<(String, String)>,
    Json(body): Json<BranchChange>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let new_branch = body.branch.trim().to_string();
    if new_branch.is_empty() {
        return Err(ApiError::BadRequest("branch must not be empty".into()));
    }

    let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &ns);
    let mut arr = load_catalog(&api).await?;

    let mut prev: Option<String> = None;
    let mut found = false;
    for s in arr.iter_mut() {
        if s.get("name").and_then(|v| v.as_str()) == Some(service.as_str()) {
            prev = s.get("branch").and_then(|v| v.as_str()).map(|x| x.to_string());
            s["branch"] = serde_json::Value::String(new_branch.clone());
            found = true;
            break;
        }
    }
    if !found {
        return Err(ApiError::NotFound(format!("service {service} not in catalog")));
    }
    if prev.as_deref() == Some(new_branch.as_str()) {
        return Ok(Json(MutationAck::ok(None)));
    }

    // Re-serialize the whole services.json and merge-patch the ConfigMap.
    let new_json = serde_json::to_string(&serde_json::json!({ "services": arr }))
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("re-serialize services.json: {e}")))?;
    let patch = serde_json::json!({ "data": { CATALOG_KEY: new_json } });
    api.patch(catalog_cm(), &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::ChangeBranch,
            target_ns: Some(&ns),
            target_kind: Some("BuildCatalog"),
            target_name: Some(&service),
            detail: serde_json::json!({ "from": prev, "to": new_branch }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}
