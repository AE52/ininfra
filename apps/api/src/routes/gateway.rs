//! API gateway: access-log view, persisted 5xx history, and config editor.
//!
//!   GET   /api/gateway/logs?tail=&only5xx=   -> GatewayLogEntry[] (live, parsed)
//!   GET   /api/gateway/errors?cursor=&limit= -> Page<GatewayError> (persisted 5xx)
//!   GET   /api/gateway/config                -> GatewayConfig (config-map keys)
//!   PATCH /api/gateway/config  body GatewayConfigPatch -> MutationAck (admin)
//!   POST  /api/gateway/restart               -> MutationAck (admin; apply config)
//!
//! Enabled only when GATEWAY_NAMESPACE/DEPLOYMENT/CONFIG_CONFIGMAP are set.

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::ConfigMap;
use kube::api::{Patch, PatchParams};
use kube::Api;
use serde::Deserialize;

use crate::auth::Identity;
use crate::config::{self, GatewayTarget};
use crate::db::{self, insert_audit, GatewayErrorFilter, GatewayRequestFilter, NewAudit};
use crate::dto::{
    AuditAction, GatewayConfig, GatewayConfigKey, GatewayConfigPatch, GatewayError,
    GatewayLogEntry, GatewayRequest, MutationAck, Page,
};
use crate::error::{ApiError, ApiResult};
use crate::gateway_log;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/gateway/logs", get(logs))
        .route("/api/gateway/errors", get(errors))
        .route("/api/gateway/requests", get(requests))
        .route("/api/gateway/config", get(get_config).patch(patch_config))
        .route("/api/gateway/restart", post(restart))
}

fn gw() -> ApiResult<&'static GatewayTarget> {
    config::get()
        .gateway
        .as_ref()
        .ok_or_else(|| ApiError::NotFound("gateway integration is not configured".into()))
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
}

/// Treat an empty/whitespace query value (e.g. `?tail=`) as absent instead of a
/// parse error — the UI sends empty params for cleared filters, and a hard 400
/// there is worse than ignoring the param.
fn empty_as_none<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: std::str::FromStr,
    T::Err: std::fmt::Display,
{
    let opt = Option::<String>::deserialize(d)?;
    match opt.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(s) => s.parse().map(Some).map_err(serde::de::Error::custom),
    }
}

/// Lenient bool: empty/absent → false; accepts true/1/on/yes.
fn lenient_bool<'de, D>(d: D) -> Result<bool, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<String>::deserialize(d)?;
    Ok(matches!(
        opt.as_deref().map(str::trim),
        Some("true") | Some("1") | Some("on") | Some("yes")
    ))
}

#[derive(Debug, Deserialize)]
struct LogQuery {
    #[serde(default, deserialize_with = "empty_as_none")]
    tail: Option<i64>,
    #[serde(default, deserialize_with = "lenient_bool")]
    only5xx: bool,
    #[serde(default, deserialize_with = "empty_as_none")]
    status: Option<i32>,
    method: Option<String>,
    path: Option<String>,
}

async fn logs(
    _identity: Identity,
    State(st): State<AppState>,
    Query(q): Query<LogQuery>,
) -> ApiResult<Json<Vec<GatewayLogEntry>>> {
    let g = gw()?;
    let tail = q.tail.unwrap_or(500).clamp(1, 5000);
    let lines = gateway_log::fetch_lines(&st, g, tail, None).await;
    let mut out: Vec<GatewayLogEntry> =
        lines.iter().filter_map(|l| gateway_log::parse_line(l)).collect();
    if q.only5xx {
        out.retain(gateway_log::is_5xx);
    }
    if let Some(status) = q.status {
        out.retain(|e| e.status == status);
    }
    if let Some(method) = clean(q.method) {
        out.retain(|e| e.method.eq_ignore_ascii_case(&method));
    }
    if let Some(path) = clean(q.path) {
        let p = path.to_lowercase();
        out.retain(|e| e.path.to_lowercase().contains(&p));
    }
    out.reverse(); // newest first
    Ok(Json(out))
}

#[derive(Debug, Deserialize)]
struct GwErrQuery {
    cursor: Option<String>,
    limit: Option<i64>,
    status: Option<i32>,
    method: Option<String>,
    path: Option<String>,
}

async fn errors(
    _identity: Identity,
    State(st): State<AppState>,
    Query(q): Query<GwErrQuery>,
) -> ApiResult<Json<Page<GatewayError>>> {
    gw()?;
    let filter = GatewayErrorFilter {
        path: clean(q.path),
        status: q.status,
        method: clean(q.method),
    };
    Ok(Json(
        db::list_gateway_errors(&st.db, q.cursor.as_deref(), q.limit.unwrap_or(50), &filter).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct GwReqQuery {
    cursor: Option<String>,
    limit: Option<i64>,
    ip: Option<String>,
    status: Option<i32>,
    method: Option<String>,
    path: Option<String>,
    has_auth: Option<bool>,
    user_id: Option<String>,
    role_id: Option<String>,
    is_admin: Option<bool>,
}

async fn requests(
    _identity: Identity,
    State(st): State<AppState>,
    Query(q): Query<GwReqQuery>,
) -> ApiResult<Json<Page<GatewayRequest>>> {
    gw()?;
    let filter = GatewayRequestFilter {
        ip: clean(q.ip),
        path: clean(q.path),
        status: q.status,
        method: clean(q.method).map(|m| m.to_uppercase()),
        has_auth: q.has_auth,
        user_id: clean(q.user_id),
        role_id: clean(q.role_id),
        is_admin: q.is_admin,
    };
    Ok(Json(
        db::list_gateway_requests(&st.db, q.cursor.as_deref(), q.limit.unwrap_or(50), &filter)
            .await?,
    ))
}

async fn get_config(
    _identity: Identity,
    State(st): State<AppState>,
) -> ApiResult<Json<GatewayConfig>> {
    let g = gw()?;
    let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &g.namespace);
    let cm = api
        .get_opt(&g.config_cm)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("configmap {}/{}", g.namespace, g.config_cm)))?;
    let mut keys: Vec<GatewayConfigKey> = cm
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| GatewayConfigKey { key, value })
        .collect();
    keys.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(Json(GatewayConfig {
        namespace: g.namespace.clone(),
        deployment: g.deployment.clone(),
        config_map: g.config_cm.clone(),
        resource_version: cm.metadata.resource_version.unwrap_or_default(),
        keys,
    }))
}

async fn patch_config(
    identity: Identity,
    State(st): State<AppState>,
    Json(body): Json<GatewayConfigPatch>,
) -> ApiResult<Json<MutationAck>> {
    let g = gw()?;
    let api: Api<ConfigMap> = Api::namespaced(st.kube.clone(), &g.namespace);
    let current = api
        .get_opt(&g.config_cm)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("configmap {}/{}", g.namespace, g.config_cm)))?;
    match &current.metadata.resource_version {
        Some(rv) if rv == &body.resource_version => {}
        _ => {
            return Err(ApiError::Conflict(
                "resourceVersion mismatch; reload and retry".into(),
            ))
        }
    }
    let changed: Vec<&String> = body.data.keys().collect();
    let patch = serde_json::json!({
        "metadata": { "resourceVersion": body.resource_version },
        "data": body.data,
    });
    api.patch(&g.config_cm, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::EditGateway,
            target_ns: Some(&g.namespace),
            target_kind: Some("ConfigMap"),
            target_name: Some(&g.config_cm),
            detail: serde_json::json!({ "changedKeys": changed }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

async fn restart(
    identity: Identity,
    State(st): State<AppState>,
) -> ApiResult<Json<MutationAck>> {
    let g = gw()?;
    let api: Api<Deployment> = Api::namespaced(st.kube.clone(), &g.namespace);
    let now = chrono::Utc::now().to_rfc3339();
    let patch = serde_json::json!({
        "spec": { "template": { "metadata": { "annotations": {
            "kubectl.kubernetes.io/restartedAt": now
        }}}}
    });
    api.patch(&g.deployment, &PatchParams::default(), &Patch::Merge(&patch))
        .await?;

    let audit_id = insert_audit(
        &st.db,
        NewAudit {
            actor: &identity.username,
            action: AuditAction::Restart,
            target_ns: Some(&g.namespace),
            target_kind: Some("Deployment"),
            target_name: Some(&g.deployment),
            detail: serde_json::json!({ "reason": "gateway config apply", "restartedAt": now }),
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}
