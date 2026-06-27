//! Builds — Argo Workflows integration.
//!
//!   GET  /api/builds                 recent cicd Workflow runs (history)
//!   POST /api/builds                 body BuildSubmit — submit a cicd Workflow
//!   GET  /api/builds/:id             one run by Workflow name
//!   GET  /api/builds/:id/logs        concatenated pod logs for the run
//!
//! The CI/CD pipeline is the Argo `cicd` WorkflowTemplate (replaces Jenkins).
//! Runs are Workflow CRDs in the CI/CD namespace; this module reads/creates them
//! through the in-cluster kube client (see `crate::argo`).

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};

use crate::argo::Argo;
use crate::auth::Identity;
use crate::config;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{AuditAction, BuildJob, BuildSubmit, Page, PageQuery};
use crate::error::{ApiError, ApiResult};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/builds", get(list_builds).post(submit_build))
        .route("/api/builds/:id", get(get_build))
        .route("/api/builds/:id/logs", get(build_logs))
}

fn argo(st: &AppState) -> Argo {
    Argo::new(st.kube.clone(), config::get().cicd_namespace.clone())
}

async fn list_builds(
    State(st): State<AppState>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<BuildJob>>> {
    let limit = page.limit.unwrap_or(50).clamp(1, 200) as usize;
    let out = argo(&st).list(limit).await?;
    Ok(Json(Page::offset(out, page.cursor.as_deref(), page.limit)))
}

async fn get_build(
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<BuildJob>> {
    validate_id(&id)?;
    Ok(Json(argo(&st).get(&id).await?))
}

async fn build_logs(State(st): State<AppState>, Path(id): Path<String>) -> ApiResult<String> {
    validate_id(&id)?;
    argo(&st).logs(&id).await
}

async fn submit_build(
    identity: Identity,
    State(st): State<AppState>,
    Json(body): Json<BuildSubmit>,
) -> ApiResult<Json<BuildJob>> {
    let repo = body.repo.trim();
    let branch = body.branch.trim();
    let sha = body.sha.trim();
    if repo.is_empty() || branch.is_empty() || sha.is_empty() {
        return Err(ApiError::BadRequest(
            "repo, branch and sha are required".into(),
        ));
    }
    if !repo.contains('/') {
        return Err(ApiError::BadRequest("repo must be in owner/name form".into()));
    }

    let name = argo(&st).submit(repo, branch, sha).await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::TriggerBuild,
            target_ns: Some(&config::get().cicd_namespace),
            target_kind: Some("Workflow"),
            target_name: Some(&name),
            detail: serde_json::json!({ "repo": repo, "branch": branch, "sha": sha }),
        },
    )
    .await?;
    tracing::info!(audit_id, workflow = %name, repo, branch, "build submitted");

    Ok(Json(argo(&st).get(&name).await?))
}

/// Reject ids that aren't plain Kubernetes object names (defense in depth).
fn validate_id(id: &str) -> ApiResult<()> {
    if id.is_empty()
        || id.len() > 253
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
    {
        return Err(ApiError::BadRequest(format!("invalid build id {id:?}")));
    }
    Ok(())
}
