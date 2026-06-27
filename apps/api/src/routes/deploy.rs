//! Deploy / release management for a workload.
//!
//!   GET    /api/deploy/:ns/:name                 -> DeployInfo (image, commit, revisions)
//!   POST   /api/deploy/:ns/:name/build           -> trigger the service's Jenkins job
//!   POST   /api/deploy/:ns/:name/rollback        body RollbackRequest -> revert image
//!   GET    /api/deploy/:ns/:name/images          -> Page<EcrImage>
//!   DELETE /api/deploy/:ns/:name/images/:digest  -> delete an image (guards deployed)
//!
//! Reads are open to any authenticated user; the mutating routes are writer-only
//! (the `require_auth` middleware already rejects viewers) and audited. ECR
//! features require AWS creds (see `ecr`); without them the deploy view still
//! shows k8s revision history and rollback works (no ECR needed).

use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment, ReplicaSet};
use k8s_openapi::api::core::v1::{ConfigMap, Secret};
use kube::api::{ListParams, Patch, PatchParams};
use kube::Api;

use crate::auth::Identity;
use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{
    AuditAction, DeployInfo, EcrImage, MutationAck, Page, PageQuery, RevisionInfo, RollbackRequest,
};
use crate::ecr::{self, ImageInfo};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

const REVISION_ANN: &str = "deployment.kubernetes.io/revision";
const CATALOG_KEY: &str = "services.json";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/deploy/:ns/:name", get(get_deploy))
        .route("/api/deploy/:ns/:name/build", post(trigger_build))
        .route("/api/deploy/:ns/:name/rollback", post(rollback))
        .route("/api/deploy/:ns/:name/images", get(list_images))
        .route(
            "/api/deploy/:ns/:name/images/:digest",
            axum::routing::delete(delete_image),
        )
}

/// Parse `<registry>/<repo>[@sha256:..|:tag]` into its parts.
fn parse_image(image: &str) -> (Option<String>, Option<String>, Option<String>, Option<String>) {
    let (main, digest) = match image.split_once('@') {
        Some((m, d)) => (m, Some(d.to_string())),
        None => (image, None),
    };
    // Tag only when there is no digest. ECR hosts have no port, repo paths no ':'.
    let (path, tag) = if digest.is_some() {
        (main, None)
    } else {
        match main.rsplit_once(':') {
            Some((p, t)) if !t.contains('/') => (p, Some(t.to_string())),
            _ => (main, None),
        }
    };
    let (registry, repo) = match path.split_once('/') {
        Some((r, rest)) => (Some(r.to_string()), Some(rest.to_string())),
        None => (None, Some(path.to_string())),
    };
    (registry, repo, digest, tag)
}

fn container_image(d: &Deployment) -> Option<String> {
    d.spec
        .as_ref()
        .and_then(|s| s.template.spec.as_ref())
        .and_then(|p| p.containers.first())
        .and_then(|c| c.image.clone())
}

fn rs_image(rs: &ReplicaSet) -> Option<String> {
    rs.spec
        .as_ref()
        .and_then(|s| s.template.as_ref())
        .and_then(|t| t.spec.as_ref())
        .and_then(|p| p.containers.first())
        .and_then(|c| c.image.clone())
}

fn revision_of(ann: Option<&BTreeMap<String, String>>) -> Option<i64> {
    ann.and_then(|a| a.get(REVISION_ANN)).and_then(|v| v.parse().ok())
}

/// Look up a service object in the build catalog ConfigMap (best-effort).
async fn catalog_service(st: &AppState, ns: &str, name: &str) -> Option<serde_json::Value> {
    let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), ns);
    let cm = api.get_opt(&crate::config::get().build_catalog_cm).await.ok()??;
    let raw = cm.data?.get(CATALOG_KEY)?.clone();
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("services")?
        .as_array()?
        .iter()
        .find(|s| s.get("name").and_then(|v| v.as_str()) == Some(name))
        .cloned()
}

async fn get_deploy(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<DeployInfo>> {
    require_namespace(&ns)?;
    let deploys: Api<Deployment> = Api::namespaced(st.kube.clone(), &ns);
    let d = deploys
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{name}")))?;

    let (registry, repo, digest, tag0) = container_image(&d)
        .as_deref()
        .map(parse_image)
        .unwrap_or((None, None, None, None));
    let revision = revision_of(d.metadata.annotations.as_ref());

    // One ECR call → digest→info map, used to resolve commits for all revisions.
    let ecr_enabled = st.ecr.is_some();
    let mut by_digest: HashMap<String, ImageInfo> = HashMap::new();
    if let (Some(e), Some(r)) = (st.ecr.as_ref(), repo.as_ref()) {
        if let Ok(list) = e.list(r).await {
            for i in list {
                by_digest.insert(i.digest.clone(), i);
            }
        }
    }
    let resolve = |dg: &Option<String>, fallback_tag: Option<String>| {
        let info = dg.as_ref().and_then(|d| by_digest.get(d));
        let commit = info.and_then(|i| ecr::commit_from_tags(&i.tags));
        let tag = info.and_then(|i| i.tags.first().cloned()).or(fallback_tag);
        (commit, tag)
    };
    let (commit, image_tag) = resolve(&digest, tag0);

    // Revision history from the deployment's ReplicaSets.
    let rs_api: Api<ReplicaSet> = Api::namespaced(st.kube.clone(), &ns);
    let mut revisions: Vec<RevisionInfo> = Vec::new();
    for rs in rs_api.list(&ListParams::default()).await?.items {
        let owned = rs
            .metadata
            .owner_references
            .as_ref()
            .map(|ors| ors.iter().any(|o| o.kind == "Deployment" && o.name == name))
            .unwrap_or(false);
        if !owned {
            continue;
        }
        let rev = revision_of(rs.metadata.annotations.as_ref()).unwrap_or(0);
        let (_, _, rdigest, rtag) = rs_image(&rs)
            .as_deref()
            .map(parse_image)
            .unwrap_or((None, None, None, None));
        let (rcommit, rimage_tag) = resolve(&rdigest, rtag);
        revisions.push(RevisionInfo {
            revision: rev,
            image_digest: rdigest,
            image_tag: rimage_tag,
            commit: rcommit,
            created_at: conv::created_at(rs.metadata.creation_timestamp.as_ref()),
            current: revision == Some(rev),
        });
    }
    revisions.sort_by(|a, b| b.revision.cmp(&a.revision));

    let repo_url = catalog_service(&st, &ns, &name)
        .await
        .and_then(|s| s.get("repo").and_then(|v| v.as_str()).map(str::to_string));

    Ok(Json(DeployInfo {
        namespace: ns,
        workload: name.clone(),
        registry,
        repo,
        image_digest: digest,
        image_tag,
        commit,
        repo_url,
        revision,
        jenkins_job: name,
        revisions,
        ecr_enabled,
    }))
}

/// Parse an `owner/name` slug from a GitHub repo URL (https or ssh, optional .git).
fn parse_owner_name(repo: &str) -> Option<String> {
    let after = repo.trim().split("github.com").nth(1)?;
    let s = after.trim_start_matches([':', '/']);
    let s = s.trim_end_matches('/').trim_end_matches(".git").trim_end_matches('/');
    if s.contains('/') {
        Some(s.to_string())
    } else {
        None
    }
}

/// Read the GitHub token from the CI/CD secret (cluster) so we can resolve the
/// branch HEAD. Best-effort; `None` if the secret/key is missing.
async fn read_github_token(kube: &kube::Client, ns: &str) -> Option<String> {
    let api: Api<Secret> = Api::namespaced(kube.clone(), ns);
    let secret = api.get_opt("jenkins-cicd").await.ok()??;
    let bytes = secret.data?.get("github_token")?.0.clone();
    String::from_utf8(bytes).ok()
}

/// Resolve a branch's HEAD commit SHA via the GitHub API.
async fn github_head_sha(repo: &str, branch: &str, token: &str) -> ApiResult<String> {
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    let url = format!("https://api.github.com/repos/{repo}/commits/{branch}");
    let resp = http
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "ininfra-console")
        .send()
        .await
        .map_err(|e| ApiError::Upstream(format!("github request failed: {e}")))?;
    if !resp.status().is_success() {
        return Err(ApiError::Upstream(format!(
            "github returned {} resolving {repo}@{branch}",
            resp.status()
        )));
    }
    let v: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ApiError::Upstream(format!("github decode failed: {e}")))?;
    v.get("sha")
        .and_then(|s| s.as_str())
        .map(str::to_string)
        .ok_or_else(|| ApiError::Upstream("github response missing sha".into()))
}

/// Trigger a build for the service by submitting an Argo `cicd` Workflow for the
/// catalog branch's HEAD (Jenkins was retired). Manually-managed services (not in
/// the catalog) return a clear 400 instead of failing against a dead Jenkins.
async fn trigger_build(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let svc = catalog_service(&st, &ns, &name).await.ok_or_else(|| {
        ApiError::BadRequest(format!(
            "'{name}' is not in the build catalog (it is manually managed) — CI/CD cannot build it."
        ))
    })?;
    let repo = svc
        .get("repo")
        .and_then(|v| v.as_str())
        .and_then(parse_owner_name)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("catalog repo for {name} is malformed")))?;
    let branch = svc
        .get("branch")
        .and_then(|v| v.as_str())
        .unwrap_or("master")
        .to_string();

    let cicd_ns = crate::config::get().cicd_namespace.clone();
    let token = read_github_token(&st.kube, &cicd_ns)
        .await
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("github token unavailable in cluster")))?;
    let sha = github_head_sha(&repo, &branch, &token).await?;

    let workflow = crate::argo::Argo::new(st.kube.clone(), cicd_ns)
        .submit(&repo, &branch, &sha)
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::TriggerBuild,
            target_ns: Some(&ns),
            target_kind: Some("Workflow"),
            target_name: Some(&workflow),
            detail: serde_json::json!({ "repo": repo, "branch": branch, "sha": sha, "via": "deploy" }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

async fn rollback(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Json(body): Json<RollbackRequest>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let rs_api: Api<ReplicaSet> = Api::namespaced(st.kube.clone(), &ns);
    let target = rs_api
        .list(&ListParams::default())
        .await?
        .items
        .into_iter()
        .find(|rs| {
            let owned = rs
                .metadata
                .owner_references
                .as_ref()
                .map(|ors| ors.iter().any(|o| o.kind == "Deployment" && o.name == name))
                .unwrap_or(false);
            owned && revision_of(rs.metadata.annotations.as_ref()) == Some(body.revision)
        })
        .ok_or_else(|| ApiError::NotFound(format!("revision {} for {ns}/{name}", body.revision)))?;

    let image = rs_image(&target)
        .ok_or_else(|| ApiError::BadRequest("target revision has no image".into()))?;

    let deploys: Api<Deployment> = Api::namespaced(st.kube.clone(), &ns);
    let d = deploys
        .get_opt(&name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{name}")))?;
    let cname = d
        .spec
        .as_ref()
        .and_then(|s| s.template.spec.as_ref())
        .and_then(|p| p.containers.first())
        .map(|c| c.name.clone())
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("deployment has no container")))?;

    let patch = serde_json::json!({
        "spec": { "template": { "spec": { "containers": [ { "name": cname, "image": image } ] } } }
    });
    deploys
        .patch(&name, &PatchParams::default(), &Patch::Strategic(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::Rollback,
            target_ns: Some(&ns),
            target_kind: Some("Deployment"),
            target_name: Some(&name),
            detail: serde_json::json!({ "revision": body.revision, "image": image }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

async fn list_images(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<EcrImage>>> {
    require_namespace(&ns)?;
    let e = st
        .ecr
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("ECR access is not configured".into()))?;
    let (repo, cur_digest) = workload_repo(&st, &ns, &name).await?;

    let mut imgs = e.list(&repo).await?;
    imgs.sort_by(|a, b| b.pushed_at.cmp(&a.pushed_at));
    let items: Vec<EcrImage> = imgs
        .into_iter()
        .map(|i| EcrImage {
            commit: ecr::commit_from_tags(&i.tags),
            deployed: cur_digest.as_deref() == Some(i.digest.as_str()),
            digest: i.digest,
            tags: i.tags,
            pushed_at: i.pushed_at,
            size_bytes: i.size_bytes,
        })
        .collect();
    Ok(Json(Page::offset(items, page.cursor.as_deref(), page.limit)))
}

async fn delete_image(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name, digest)): Path<(String, String, String)>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let e = st
        .ecr
        .as_ref()
        .ok_or_else(|| ApiError::BadRequest("ECR access is not configured".into()))?;
    let (repo, cur_digest) = workload_repo(&st, &ns, &name).await?;
    if cur_digest.as_deref() == Some(digest.as_str()) {
        return Err(ApiError::Conflict(
            "refusing to delete the currently deployed image".into(),
        ));
    }
    e.delete(&repo, &digest).await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::DeleteImage,
            target_ns: Some(&ns),
            target_kind: Some("EcrImage"),
            target_name: Some(&repo),
            detail: serde_json::json!({ "digest": digest, "workload": name }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

/// Resolve a workload's ECR repo + currently-deployed digest.
async fn workload_repo(
    st: &AppState,
    ns: &str,
    name: &str,
) -> ApiResult<(String, Option<String>)> {
    let deploys: Api<Deployment> = Api::namespaced(st.kube.clone(), ns);
    let d = deploys
        .get_opt(name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{name}")))?;
    let (_, repo, digest, _) = container_image(&d)
        .as_deref()
        .map(parse_image)
        .unwrap_or((None, None, None, None));
    let repo = repo.ok_or_else(|| ApiError::BadRequest("workload image has no ECR repo".into()))?;
    Ok((repo, digest))
}
