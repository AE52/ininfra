//! Environment editor — ConfigMaps + Secrets backing a workload.
//!
//!   GET   /api/env/:ns/:workload?reveal=    (secrets masked unless reveal=1)
//!   PATCH /api/env/:ns/:workload            (optimistic concurrency; audited)
//!
//! The set of backing objects is derived from the Deployment's `envFrom` /
//! `valueFrom` references (see `conv::env_refs`), which covers the common
//! convention of a `<name>-config` ConfigMap and `<name>-runtime-env` Secret
//! without hard-coding those names.

use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use base64::Engine;
use k8s_openapi::api::apps::v1::Deployment as K8sDeployment;
use k8s_openapi::api::core::v1::{ConfigMap, Secret};
use k8s_openapi::ByteString;
use kube::api::{Patch, PatchParams};
use kube::Api;
use serde::Deserialize;

use crate::conv;
use crate::db::{insert_audit, NewAudit};
use crate::dto::{AuditAction, EnvBundle, EnvObject, EnvPatch, EnvSource, EnvVar, MutationAck};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::auth::Identity;
use crate::AppState;

const MASK: &str = "••••••";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/env/:ns/:workload", get(get_env).patch(patch_env))
}

#[derive(Debug, Deserialize)]
struct RevealQuery {
    reveal: Option<String>,
}

async fn get_env(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, workload)): Path<(String, String)>,
    Query(q): Query<RevealQuery>,
) -> ApiResult<Json<EnvBundle>> {
    require_namespace(&ns)?;
    let requested_reveal = matches!(q.reveal.as_deref(), Some("1") | Some("true"));

    // Revealing decoded Secret values is admin-class only. A non-admin asking
    // for reveal=1 is rejected outright (rather than silently masked) so the
    // restriction is explicit; the masked view stays available to everyone.
    let is_admin = identity.role == "admin" || identity.role == "super_admin";
    if requested_reveal && !is_admin {
        return Err(ApiError::Forbidden(
            "revealing secret values requires the admin or super_admin role".into(),
        ));
    }
    let reveal = requested_reveal && is_admin;

    let deploys: Api<K8sDeployment> = Api::namespaced(st.kube.clone(), &ns);
    let d = deploys
        .get_opt(&workload)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("deployment {ns}/{workload}")))?;
    let (cm_names, secret_names) = conv::env_refs(&d);

    let cm_api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &ns);
    let secret_api: Api<Secret> = Api::namespaced(st.kube.clone(), &ns);

    let mut config_maps = Vec::new();
    for name in cm_names {
        if let Some(cm) = cm_api.get_opt(&name).await? {
            config_maps.push(configmap_to_object(&name, &cm));
        }
    }

    let mut secrets = Vec::new();
    for name in secret_names {
        if let Some(s) = secret_api.get_opt(&name).await? {
            secrets.push(secret_to_object(&name, &s, reveal));
        }
    }

    let inline = inline_env(&d);

    // Audit the privileged reveal (decoded secret values left the server). The
    // entry records WHICH secrets were revealed, never their values.
    if reveal {
        let revealed: Vec<String> = secrets.iter().map(|s| s.name.clone()).collect();
        insert_audit(
            &st.db,
            NewAudit {
                actor: &identity.username,
                action: AuditAction::RevealSecret,
                target_ns: Some(&ns),
                target_kind: Some("Secret"),
                target_name: Some(&workload),
                detail: serde_json::json!({
                    "workload": workload,
                    "secrets": revealed,
                }),
            },
        )
        .await?;
    }

    Ok(Json(EnvBundle {
        namespace: ns,
        workload,
        config_maps,
        secrets,
        inline,
    }))
}

/// Literal `env:` entries (those with a direct `value`, not a `valueFrom`)
/// declared on the pod's containers. These have no ConfigMap/Secret backing,
/// so they were previously invisible — surfaced here read-only. Prefixed with
/// the container name when the workload has more than one container.
fn inline_env(d: &K8sDeployment) -> Vec<EnvVar> {
    let containers = d
        .spec
        .as_ref()
        .and_then(|s| s.template.spec.as_ref())
        .map(|p| p.containers.as_slice())
        .unwrap_or(&[]);
    let multi = containers.len() > 1;

    let mut out = Vec::new();
    for c in containers {
        if let Some(env) = &c.env {
            for e in env {
                // Only literal values; valueFrom entries are covered by the
                // ConfigMap/Secret objects above.
                if let Some(v) = &e.value {
                    out.push(EnvVar {
                        key: e.name.clone(),
                        value: v.clone(),
                        source: EnvSource::Inline,
                        source_name: multi.then(|| c.name.clone()),
                        masked: false,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

async fn patch_env(
    identity: Identity,
    State(st): State<AppState>,
    Path((ns, workload)): Path<(String, String)>,
    Json(body): Json<EnvPatch>,
) -> ApiResult<Json<MutationAck>> {
    require_namespace(&ns)?;

    // Apply the new data map with optimistic concurrency: we send the client's
    // resourceVersion in metadata, and the apiserver rejects (409) on mismatch.
    let pp = PatchParams::default();

    let (kind, changed_keys) = match body.source {
        EnvSource::Configmap => {
            let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &ns);
            let current = api
                .get_opt(&body.name)
                .await?
                .ok_or_else(|| ApiError::NotFound(format!("configmap {ns}/{}", body.name)))?;
            check_resource_version(&current.metadata.resource_version, &body.resource_version)?;
            let changed = diff_keys(
                current.data.as_ref(),
                &body.data,
                |m, k| m.get(k).cloned(),
            );

            let patch = serde_json::json!({
                "metadata": { "resourceVersion": body.resource_version },
                "data": body.data,
            });
            api.patch(&body.name, &pp, &Patch::Merge(&patch)).await?;
            ("ConfigMap", changed)
        }
        EnvSource::Secret => {
            let api: Api<Secret> = Api::namespaced(st.kube.clone(), &ns);
            let current = api
                .get_opt(&body.name)
                .await?
                .ok_or_else(|| ApiError::NotFound(format!("secret {ns}/{}", body.name)))?;
            check_resource_version(&current.metadata.resource_version, &body.resource_version)?;

            // Compare against decoded current values to compute the key diff,
            // but never log secret values.
            let decoded: BTreeMap<String, String> = current
                .data
                .as_ref()
                .map(|d| {
                    d.iter()
                        .map(|(k, v)| (k.clone(), String::from_utf8_lossy(&v.0).into_owned()))
                        .collect()
                })
                .unwrap_or_default();
            let changed = diff_keys(Some(&decoded), &body.data, |m, k| m.get(k).cloned());

            // Patch via stringData so the apiserver base64-encodes for us.
            let patch = serde_json::json!({
                "metadata": { "resourceVersion": body.resource_version },
                "stringData": body.data,
            });
            api.patch(&body.name, &pp, &Patch::Merge(&patch)).await?;
            ("Secret", changed)
        }
        EnvSource::Inline => {
            return Err(ApiError::BadRequest(
                "inline env is not editable; patch a configmap or secret".into(),
            ));
        }
    };

    // Audit records WHICH keys changed, never secret values.
    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::EditEnv,
            target_ns: Some(&ns),
            target_kind: Some(kind),
            target_name: Some(&body.name),
            detail: serde_json::json!({
                "workload": workload,
                "source": kind,
                "changedKeys": changed_keys,
            }),
        },
    )
    .await?;

    Ok(Json(MutationAck::ok(Some(audit_id))))
}

fn check_resource_version(current: &Option<String>, expected: &str) -> ApiResult<()> {
    match current {
        Some(rv) if rv == expected => Ok(()),
        _ => Err(ApiError::Conflict(
            "resourceVersion mismatch; object was modified, reload and retry".into(),
        )),
    }
}

/// Keys whose value differs between `current` and `desired`, plus added/removed
/// keys. Used only for the audit trail.
fn diff_keys<M>(
    current: Option<&M>,
    desired: &BTreeMap<String, String>,
    get: impl Fn(&M, &str) -> Option<String>,
) -> Vec<String>
where
    M: MapKeys,
{
    let mut changed = Vec::new();
    for (k, v) in desired {
        let prev = current.and_then(|m| get(m, k));
        if prev.as_deref() != Some(v.as_str()) {
            changed.push(k.clone());
        }
    }
    if let Some(m) = current {
        for k in m.keys_vec() {
            if !desired.contains_key(&k) {
                changed.push(k);
            }
        }
    }
    changed.sort();
    changed.dedup();
    changed
}

/// Tiny abstraction so `diff_keys` works over both ConfigMap (`String` values)
/// and our decoded-secret map.
trait MapKeys {
    fn keys_vec(&self) -> Vec<String>;
}
impl MapKeys for BTreeMap<String, String> {
    fn keys_vec(&self) -> Vec<String> {
        self.keys().cloned().collect()
    }
}

fn configmap_to_object(name: &str, cm: &ConfigMap) -> EnvObject {
    let mut data: Vec<EnvVar> = cm
        .data
        .as_ref()
        .map(|d| {
            d.iter()
                .map(|(k, v)| EnvVar {
                    key: k.clone(),
                    value: v.clone(),
                    source: EnvSource::Configmap,
                    source_name: Some(name.to_string()),
                    masked: false,
                })
                .collect()
        })
        .unwrap_or_default();
    data.sort_by(|a, b| a.key.cmp(&b.key));
    EnvObject {
        name: name.to_string(),
        source: EnvSource::Configmap,
        data,
        resource_version: cm.metadata.resource_version.clone().unwrap_or_default(),
    }
}

fn secret_to_object(name: &str, s: &Secret, reveal: bool) -> EnvObject {
    let decode = |b: &ByteString| -> String {
        // Secret .data is already raw bytes in the typed model; decode utf8.
        // (Kept generic in case of base64-wrapped sources.)
        match std::str::from_utf8(&b.0) {
            Ok(s) => s.to_string(),
            Err(_) => base64::engine::general_purpose::STANDARD.encode(&b.0),
        }
    };
    let mut data: Vec<EnvVar> = s
        .data
        .as_ref()
        .map(|d| {
            d.iter()
                .map(|(k, v)| EnvVar {
                    key: k.clone(),
                    value: if reveal {
                        decode(v)
                    } else {
                        MASK.to_string()
                    },
                    source: EnvSource::Secret,
                    source_name: Some(name.to_string()),
                    masked: !reveal,
                })
                .collect()
        })
        .unwrap_or_default();
    data.sort_by(|a, b| a.key.cmp(&b.key));
    EnvObject {
        name: name.to_string(),
        source: EnvSource::Secret,
        data,
        resource_version: s.metadata.resource_version.clone().unwrap_or_default(),
    }
}
