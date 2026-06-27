//! First-run setup wizard endpoints (PUBLIC, self-gating).
//!
//!   GET  /api/setup/status      -> SetupStatus (always available)
//!   GET  /api/setup/namespaces  -> { namespaces: [...] } (409 once complete)
//!   POST /api/setup/complete    -> { ok: true } (409 once complete)
//!
//! Until setup is complete the UI has no admin/credentials, so these run on the
//! PUBLIC router (no auth). They self-gate: once `app_settings.setup_complete`
//! is true, `namespaces` and `complete` return 409 so the wizard can't re-run.

use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use k8s_openapi::api::core::v1::Namespace;
use kube::api::ListParams;
use kube::Api;
use serde::{Deserialize, Serialize};

use crate::db;
use crate::error::{ApiError, ApiResult};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/setup/status", get(status))
        .route("/api/setup/namespaces", get(namespaces))
        .route("/api/setup/complete", post(complete))
}

/* ------------------------------------------------------------------ */
/* Wire DTOs (camelCase) — local to the wizard.                        */
/* ------------------------------------------------------------------ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DbStatus {
    connected: bool,
    migrated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupStatus {
    needs_setup: bool,
    has_admin: bool,
    setup_complete: bool,
    db: DbStatus,
    detected_cluster_mode: &'static str,
    product_name: String,
    cluster_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NamespaceList {
    namespaces: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupFeatures {
    jenkins: bool,
    gateway: bool,
    ecr: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminCredentials {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupCompleteRequest {
    product_name: String,
    cluster_name: String,
    managed_namespaces: Vec<String>,
    #[serde(default)]
    cicd_namespace: Option<String>,
    features: SetupFeatures,
    admin: AdminCredentials,
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/// In-cluster when the mounted ServiceAccount token exists; otherwise we have a
/// working kube client (built at startup) so report kubeconfig; else unknown.
fn detect_cluster_mode() -> &'static str {
    const SA_TOKEN: &str = "/var/run/secrets/kubernetes.io/serviceaccount/token";
    if std::path::Path::new(SA_TOKEN).exists() {
        "in-cluster"
    } else {
        // The client is built before routing starts; if we got here it built.
        "kubeconfig"
    }
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/// `GET /api/setup/status` — always available, used by the UI to decide whether
/// to show the wizard. Never errors on a healthy DB.
async fn status(State(st): State<AppState>) -> ApiResult<Json<SetupStatus>> {
    let (setup_complete, db_connected) = match db::get_app_settings(&st.db).await {
        Ok(Some((c, _))) => (c, true),
        Ok(None) => (false, true),
        Err(_) => (false, false),
    };
    let migrated = if db_connected {
        db::migrations_applied(&st.db).await
    } else {
        false
    };
    let has_admin = db::count_admins(&st.db).await.map(|n| n > 0).unwrap_or(false);

    let s = crate::settings::get();
    Ok(Json(SetupStatus {
        needs_setup: !setup_complete || !has_admin,
        has_admin,
        setup_complete,
        db: DbStatus {
            connected: db_connected,
            migrated,
        },
        detected_cluster_mode: detect_cluster_mode(),
        product_name: s.product_name.clone(),
        cluster_name: s.cluster_name.clone(),
    }))
}

/// `GET /api/setup/namespaces` — list the cluster's namespaces (pre-setup only).
async fn namespaces(State(st): State<AppState>) -> ApiResult<Json<NamespaceList>> {
    if setup_is_complete(&st).await {
        return Err(ApiError::Conflict("setup already complete".into()));
    }
    let api: Api<Namespace> = Api::all(st.kube.clone());
    let list = api.list(&ListParams::default()).await?;
    let mut namespaces: Vec<String> =
        list.items.into_iter().filter_map(|n| n.metadata.name).collect();
    namespaces.sort();
    Ok(Json(NamespaceList { namespaces }))
}

/// `POST /api/setup/complete` — validate, persist settings + first admin in one
/// transaction, then reload the in-memory settings.
async fn complete(
    State(st): State<AppState>,
    Json(req): Json<SetupCompleteRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    if setup_is_complete(&st).await {
        return Err(ApiError::Conflict("setup already complete".into()));
    }

    // ---- validation ----
    let product_name = req.product_name.trim().to_string();
    if product_name.is_empty() {
        return Err(ApiError::BadRequest("productName is required".into()));
    }
    let cluster_name = req.cluster_name.trim().to_string();
    if cluster_name.is_empty() {
        return Err(ApiError::BadRequest("clusterName is required".into()));
    }
    let managed: Vec<String> = req
        .managed_namespaces
        .iter()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    if managed.is_empty() {
        return Err(ApiError::BadRequest(
            "managedNamespaces must contain at least one namespace".into(),
        ));
    }
    let cicd_namespace = req
        .cicd_namespace
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let admin_username = req.admin.username.trim().to_string();
    if admin_username.is_empty() {
        return Err(ApiError::BadRequest("admin.username is required".into()));
    }
    if req.admin.password.len() < 8 {
        return Err(ApiError::BadRequest(
            "admin.password must be at least 8 characters".into(),
        ));
    }

    // ---- build the settings JSONB blob (camelCase, matches Settings) ----
    let settings_json = serde_json::json!({
        "productName": product_name,
        "clusterName": cluster_name,
        "managedNamespaces": managed,
        "cicdNamespace": cicd_namespace,
        "features": {
            "jenkins": req.features.jenkins,
            "gateway": req.features.gateway,
            "ecr": req.features.ecr,
        },
    });

    // Hash before opening the transaction (CPU-bound, no DB held).
    let hash = crate::auth::hash_password(&req.admin.password).map_err(ApiError::Internal)?;

    // ---- one transaction: settings + first admin ----
    let mut tx = st.db.begin().await?;
    db::upsert_app_settings(&mut tx, true, &settings_json).await?;
    // Only create the first admin when none exists yet (the env bootstrap path
    // may already have provisioned one — in that case setup just records config).
    if db::count_admins(&st.db).await? == 0 {
        // Highest-privilege role in the enum.
        db::create_user_tx(&mut tx, &admin_username, &hash, "super_admin").await?;
    }
    tx.commit().await?;

    // Reload the in-memory mirror so subsequent requests see the new config.
    crate::settings::reload(&st.db).await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

/// Whether setup should be treated as already complete (i.e. the wizard's
/// `namespaces`/`complete` endpoints must be closed).
///
/// Fails CLOSED: on a DB read error we cannot prove setup is still pending, so
/// we treat it as complete/unavailable. This prevents a transient DB outage from
/// briefly re-opening the public `POST /api/setup/complete`, which would let an
/// unauthenticated caller seed a new admin. The normal path (DB readable) is
/// unchanged: complete only when the stored row says so.
async fn setup_is_complete(st: &AppState) -> bool {
    match db::get_app_settings(&st.db).await {
        Ok(Some((complete, _))) => complete,
        // Row genuinely missing → setup truly pending (first run).
        Ok(None) => false,
        // DB unreadable → fail closed (treat as complete/unavailable).
        Err(_) => true,
    }
}
