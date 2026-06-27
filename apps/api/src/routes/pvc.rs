//! PersistentVolumeClaims — storage inventory per namespace.
//!
//!   GET /api/pvc/:ns
//!
//! Read-only. Shows capacity, phase (Bound/Pending), storage class, and which
//! pods currently mount the claim. Real used-bytes needs Prometheus
//! (kubelet_volume_stats_*) and is out of scope for v1 — capacity + phase only.
//!
//! ⚠️ Requires `persistentvolumeclaims: get/list/watch` RBAC (added to
//! 10-rbac.yaml alongside this module).

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::core::v1::{PersistentVolumeClaim as K8sPvc, Pod as K8sPod};
use kube::api::ListParams;
use kube::Api;
use serde::Deserialize;

use crate::auth::Identity;
use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{
    AuditAction, FileContent, MutationAck, Page, Pvc, PvcFile, WriteFileRequest,
};
use crate::error::{ApiError, ApiResult};
use crate::k8s::{exec_in_pod, require_namespace};
use crate::AppState;

/// Max bytes read back for a single file view.
const READ_CAP: usize = 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/pvc/:ns", get(list_pvc))
        .route("/api/pvc/:ns/:name/files", get(list_files))
        .route(
            "/api/pvc/:ns/:name/file",
            get(read_file).put(write_file).delete(delete_file),
        )
}

async fn list_pvc(
    State(st): State<AppState>,
    Path(ns): Path<String>,
) -> ApiResult<Json<Vec<Pvc>>> {
    require_namespace(&ns)?;
    let pvcs: Api<K8sPvc> = Api::namespaced(st.kube.clone(), &ns);
    let pods: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);

    // Map claimName -> [pod names] in one pass over pods.
    let pod_list = pods.list(&ListParams::default()).await?;
    let mut claim_to_pods: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in &pod_list.items {
        let pod_name = p.metadata.name.clone().unwrap_or_default();
        if let Some(vols) = p.spec.as_ref().and_then(|s| s.volumes.as_ref()) {
            for v in vols {
                if let Some(claim) = v.persistent_volume_claim.as_ref() {
                    claim_to_pods
                        .entry(claim.claim_name.clone())
                        .or_default()
                        .push(pod_name.clone());
                }
            }
        }
    }

    let list = pvcs.list(&ListParams::default()).await?;
    let mut out: Vec<Pvc> = list
        .items
        .iter()
        .map(|p| {
            let name = p.metadata.name.clone().unwrap_or_default();
            let spec = p.spec.as_ref();
            let status = p.status.as_ref();
            let capacity = status
                .and_then(|s| s.capacity.as_ref())
                .and_then(|c| c.get("storage"))
                .map(|q| q.0.clone())
                .or_else(|| {
                    spec.and_then(|s| s.resources.as_ref())
                        .and_then(|r| r.requests.as_ref())
                        .and_then(|req| req.get("storage"))
                        .map(|q| q.0.clone())
                });
            Pvc {
                used_by_pods: claim_to_pods.get(&name).cloned().unwrap_or_default(),
                name: name.clone(),
                namespace: ns.clone(),
                phase: status
                    .and_then(|s| s.phase.clone())
                    .unwrap_or_else(|| "Unknown".into()),
                capacity,
                storage_class: spec.and_then(|s| s.storage_class_name.clone()),
                access_modes: spec
                    .and_then(|s| s.access_modes.clone())
                    .unwrap_or_default(),
                volume_name: spec.and_then(|s| s.volume_name.clone()),
                created_at: conv::created_at(p.metadata.creation_timestamp.as_ref()),
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Json(out))
}

/* ------------------------------------------------------------------ */
/* File browser — exec into a pod that mounts the claim.               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Deserialize)]
struct PathQuery {
    #[serde(default)]
    path: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
struct FileQuery {
    path: String,
}

/// Where a claim is mounted and by whom: (pod, container, mountPath).
struct Mount {
    pod: String,
    container: String,
    mount_path: String,
}

/// Find a running pod that mounts `claim` and resolve the container +
/// mountPath to exec against. Errors with a clear message when no such pod
/// exists (the browser only works for claims with a live, shell-capable pod).
async fn resolve_mount(st: &AppState, ns: &str, claim: &str) -> ApiResult<Mount> {
    let pods: Api<K8sPod> = Api::namespaced(st.kube.clone(), ns);
    let list = pods.list(&ListParams::default()).await?;

    for p in &list.items {
        let running = p
            .status
            .as_ref()
            .and_then(|s| s.phase.as_deref())
            .map(|ph| ph == "Running")
            .unwrap_or(false);
        if !running {
            continue;
        }
        let spec = match p.spec.as_ref() {
            Some(s) => s,
            None => continue,
        };
        // Volume (by name) that references this claim.
        let vol_name = spec.volumes.as_ref().and_then(|vols| {
            vols.iter().find_map(|v| {
                v.persistent_volume_claim
                    .as_ref()
                    .filter(|c| c.claim_name == claim)
                    .map(|_| v.name.clone())
            })
        });
        let vol_name = match vol_name {
            Some(n) => n,
            None => continue,
        };
        // Container that mounts that volume → mountPath.
        for c in &spec.containers {
            if let Some(mounts) = &c.volume_mounts {
                if let Some(m) = mounts.iter().find(|m| m.name == vol_name) {
                    return Ok(Mount {
                        pod: p.metadata.name.clone().unwrap_or_default(),
                        container: c.name.clone(),
                        mount_path: m.mount_path.clone(),
                    });
                }
            }
        }
    }

    Err(ApiError::BadRequest(format!(
        "no running pod currently mounts claim '{claim}'; file browsing needs a live pod"
    )))
}

/// Join a user-supplied relative path onto the mount root, rejecting any
/// traversal. Returns (absolute_path, normalized_relative_path).
fn safe_join(mount: &str, rel: Option<&str>) -> ApiResult<(String, String)> {
    let rel = rel.unwrap_or("/");
    let mut parts: Vec<&str> = Vec::new();
    for seg in rel.split('/') {
        match seg {
            "" | "." => continue,
            ".." => {
                return Err(ApiError::BadRequest("path traversal ('..') is not allowed".into()))
            }
            s if s.contains('\0') => {
                return Err(ApiError::BadRequest("invalid path".into()))
            }
            s => parts.push(s),
        }
    }
    let normalized = format!("/{}", parts.join("/"));
    let mount = mount.trim_end_matches('/');
    let abs = if normalized == "/" {
        mount.to_string()
    } else {
        format!("{mount}{normalized}")
    };
    Ok((abs, normalized))
}

/// Char-0 of an `ls -l` mode string → our `FileKind`.
fn kind_of(mode: &str) -> &'static str {
    match mode.chars().next() {
        Some('d') => "dir",
        Some('-') => "file",
        Some('l') => "symlink",
        _ => "other",
    }
}

/// Parse one `ls -lA` line into a PvcFile, given the parent relative dir.
fn parse_ls_line(line: &str, parent: &str) -> Option<PvcFile> {
    if line.is_empty() || line.starts_with("total ") {
        return None;
    }
    let mut it = line.split_whitespace();
    let mode = it.next()?.to_string();
    it.next()?; // link count
    it.next()?; // owner
    it.next()?; // group
    let size_tok = it.next()?;
    let d1 = it.next()?;
    let d2 = it.next()?;
    let d3 = it.next()?;
    let rest = it.collect::<Vec<_>>().join(" ");
    if rest.is_empty() {
        return None;
    }
    let (name, link_target) = match rest.split_once(" -> ") {
        Some((n, t)) => (n.to_string(), Some(t.to_string())),
        None => (rest, None),
    };
    let kind = kind_of(&mode);
    let size = if kind == "file" { size_tok.parse::<i64>().ok() } else { None };
    let parent = parent.trim_end_matches('/');
    let path = format!("{parent}/{name}");
    Some(PvcFile {
        name,
        path,
        kind: kind.to_string(),
        size,
        mode,
        modified_at: Some(format!("{d1} {d2} {d3}")),
        link_target,
    })
}

async fn list_files(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Query(q): Query<PathQuery>,
) -> ApiResult<Json<Page<PvcFile>>> {
    require_namespace(&ns)?;
    let mount = resolve_mount(&st, &ns, &name).await?;
    let (abs, rel) = safe_join(&mount.mount_path, q.path.as_deref())?;

    // `$1` carries the path positionally so a filename can't be shell-injected.
    let out = exec_in_pod(
        &st.kube,
        &ns,
        &mount.pod,
        Some(&mount.container),
        &["sh", "-c", "ls -lA \"$1\"", "sh", &abs],
        None,
    )
    .await?;
    if !out.success {
        return Err(ApiError::BadRequest(format!(
            "cannot list '{rel}': {}",
            out.stderr.trim()
        )));
    }

    let text = String::from_utf8_lossy(&out.stdout);
    let mut files: Vec<PvcFile> = text
        .lines()
        .filter_map(|l| parse_ls_line(l, &rel))
        .collect();
    // Directories first, then alphabetical.
    files.sort_by(|a, b| {
        let ad = (a.kind != "dir", &a.name);
        let bd = (b.kind != "dir", &b.name);
        ad.cmp(&bd)
    });

    let total = files.len() as i64;
    let offset: usize = q
        .cursor
        .as_deref()
        .and_then(|c| c.parse().ok())
        .unwrap_or(0);
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let page: Vec<PvcFile> = files.into_iter().skip(offset).take(limit).collect();
    let next_cursor = if (offset + page.len()) < total as usize {
        Some((offset + limit).to_string())
    } else {
        None
    };

    Ok(Json(Page { items: page, next_cursor, total: Some(total) }))
}

async fn read_file(
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Query(q): Query<FileQuery>,
) -> ApiResult<Json<FileContent>> {
    require_namespace(&ns)?;
    let mount = resolve_mount(&st, &ns, &name).await?;
    let (abs, rel) = safe_join(&mount.mount_path, Some(&q.path))?;

    // Size first (so we can flag truncation), then a capped read.
    let size_out = exec_in_pod(
        &st.kube,
        &ns,
        &mount.pod,
        Some(&mount.container),
        &["sh", "-c", "wc -c < \"$1\"", "sh", &abs],
        None,
    )
    .await?;
    if !size_out.success {
        return Err(ApiError::BadRequest(format!(
            "cannot read '{rel}': {}",
            size_out.stderr.trim()
        )));
    }
    let size: i64 = String::from_utf8_lossy(&size_out.stdout)
        .trim()
        .parse()
        .unwrap_or(0);

    let cap = READ_CAP.to_string();
    let content_out = exec_in_pod(
        &st.kube,
        &ns,
        &mount.pod,
        Some(&mount.container),
        &["sh", "-c", "head -c \"$2\" \"$1\"", "sh", &abs, &cap],
        None,
    )
    .await?;
    if !content_out.success {
        return Err(ApiError::BadRequest(format!(
            "cannot read '{rel}': {}",
            content_out.stderr.trim()
        )));
    }

    let bytes = content_out.stdout;
    let binary = bytes.contains(&0u8);
    let truncated = size as usize > READ_CAP;
    let content = if binary {
        String::new()
    } else {
        String::from_utf8_lossy(&bytes).into_owned()
    };

    Ok(Json(FileContent { path: rel, size, content, truncated, binary }))
}

async fn write_file(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Query(q): Query<FileQuery>,
    Json(body): Json<WriteFileRequest>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let mount = resolve_mount(&st, &ns, &name).await?;
    let (abs, rel) = safe_join(&mount.mount_path, Some(&q.path))?;
    if abs == mount.mount_path.trim_end_matches('/') {
        return Err(ApiError::BadRequest("refusing to write the mount root".into()));
    }

    let out = exec_in_pod(
        &st.kube,
        &ns,
        &mount.pod,
        Some(&mount.container),
        &["sh", "-c", "cat > \"$1\"", "sh", &abs],
        Some(body.content.as_bytes()),
    )
    .await?;
    if !out.success {
        return Err(ApiError::BadRequest(format!(
            "cannot write '{rel}': {}",
            out.stderr.trim()
        )));
    }

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::WriteFile,
            target_ns: Some(&ns),
            target_kind: Some("PersistentVolumeClaim"),
            target_name: Some(&name),
            detail: serde_json::json!({ "path": rel, "bytes": body.content.len(), "pod": mount.pod }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

async fn delete_file(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, name)): Path<(String, String)>,
    Query(q): Query<FileQuery>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;
    let mount = resolve_mount(&st, &ns, &name).await?;
    let (abs, rel) = safe_join(&mount.mount_path, Some(&q.path))?;
    if abs == mount.mount_path.trim_end_matches('/') {
        return Err(ApiError::BadRequest("refusing to delete the mount root".into()));
    }

    // `rm -f` a single path (no recursion); fails on directories.
    let out = exec_in_pod(
        &st.kube,
        &ns,
        &mount.pod,
        Some(&mount.container),
        &["sh", "-c", "rm -f \"$1\"", "sh", &abs],
        None,
    )
    .await?;
    if !out.success {
        return Err(ApiError::BadRequest(format!(
            "cannot delete '{rel}': {}",
            out.stderr.trim()
        )));
    }

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::DeleteFile,
            target_ns: Some(&ns),
            target_kind: Some("PersistentVolumeClaim"),
            target_name: Some(&name),
            detail: serde_json::json!({ "path": rel, "pod": mount.pod }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}
