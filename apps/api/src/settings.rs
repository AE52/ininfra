//! Runtime, reloadable settings (the first-run setup wizard's chosen config).
//!
//! Unlike [`crate::config`] — which is loaded once from the environment and is
//! immutable — `Settings` is mutable at runtime: the setup wizard writes it to
//! the `app_settings` table (see migration 0011) and the in-memory mirror is
//! reloaded after each change. The env `Config` remains the source for infra
//! (DATABASE_URL, SESSION_SECRET, ...) and provides the *defaults* that seed
//! every `Settings` field; the DB JSONB only overlays values present in it.
//!
//! Held in `OnceLock<RwLock<Arc<Settings>>>`, mirroring the `config::init/get`
//! pattern but swappable: `get()` returns a cheap `Arc` snapshot, `reload()`
//! swaps in a fresh `Arc` under the write lock.

use std::sync::{Arc, OnceLock, RwLock};

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;

use crate::error::ApiResult;

/// Wizard feature toggles. Mirrors the `Features` DTO on the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFeatures {
    pub jenkins: bool,
    pub gateway: bool,
    pub ecr: bool,
}

/// Runtime, wizard-managed configuration. Serializes to/from the
/// `app_settings.settings` JSONB column (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub product_name: String,
    pub cluster_name: String,
    pub managed_namespaces: Vec<String>,
    pub cicd_namespace: Option<String>,
    pub features: SettingsFeatures,
}

impl Settings {
    /// Seed a `Settings` purely from the env [`Config`](crate::config::Config)
    /// defaults — the baseline before any DB overlay.
    fn from_config_defaults() -> Self {
        let c = crate::config::get();
        Self {
            product_name: c.product_name.clone(),
            cluster_name: c.cluster_name.clone(),
            managed_namespaces: c.managed_namespaces.clone(),
            cicd_namespace: Some(c.cicd_namespace.clone()),
            features: SettingsFeatures {
                // Env-derived defaults: jenkins/gateway/ecr availability is
                // inferred the same way `app_config` does it pre-wizard.
                jenkins: true,
                gateway: c.gateway.is_some(),
                ecr: false,
            },
        }
    }
}

static SETTINGS: OnceLock<RwLock<Arc<Settings>>> = OnceLock::new();

/// Build the effective settings: start from env defaults, then overlay any
/// fields present in the `app_settings.settings` JSONB. Missing/empty JSONB
/// leaves the env defaults intact.
async fn load(pool: &PgPool) -> ApiResult<Settings> {
    let mut s = Settings::from_config_defaults();

    let row = crate::db::get_app_settings(pool).await?;
    if let Some((_complete, json)) = row {
        overlay(&mut s, &json);
    }
    Ok(s)
}

/// Overlay any present fields of the JSONB blob onto `s`. Each key is optional,
/// so a partial blob only changes the fields it carries.
fn overlay(s: &mut Settings, json: &serde_json::Value) {
    if let Some(v) = json.get("productName").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            s.product_name = v.to_string();
        }
    }
    if let Some(v) = json.get("clusterName").and_then(|v| v.as_str()) {
        if !v.trim().is_empty() {
            s.cluster_name = v.to_string();
        }
    }
    if let Some(arr) = json.get("managedNamespaces").and_then(|v| v.as_array()) {
        let ns: Vec<String> = arr
            .iter()
            .filter_map(|x| x.as_str().map(|s| s.to_string()))
            .filter(|x| !x.trim().is_empty())
            .collect();
        if !ns.is_empty() {
            s.managed_namespaces = ns;
        }
    }
    match json.get("cicdNamespace") {
        Some(serde_json::Value::String(v)) if !v.trim().is_empty() => {
            s.cicd_namespace = Some(v.clone());
        }
        Some(serde_json::Value::Null) => s.cicd_namespace = None,
        _ => {}
    }
    if let Some(f) = json.get("features") {
        if let Some(b) = f.get("jenkins").and_then(|v| v.as_bool()) {
            s.features.jenkins = b;
        }
        if let Some(b) = f.get("gateway").and_then(|v| v.as_bool()) {
            s.features.gateway = b;
        }
        if let Some(b) = f.get("ecr").and_then(|v| v.as_bool()) {
            s.features.ecr = b;
        }
    }
}

/// Initialize the in-memory settings mirror from the DB. Call once at startup,
/// after `config::init()` and `run_migrations()`.
pub async fn init(pool: &PgPool) -> ApiResult<()> {
    let s = load(pool).await?;
    tracing::info!(
        product = %s.product_name,
        cluster = %s.cluster_name,
        namespaces = ?s.managed_namespaces,
        "runtime settings loaded"
    );
    let _ = SETTINGS.set(RwLock::new(Arc::new(s)));
    Ok(())
}

/// Cheap snapshot of the current settings.
pub fn get() -> Arc<Settings> {
    SETTINGS
        .get()
        .expect("settings::init() must run before settings::get()")
        .read()
        .expect("settings lock poisoned")
        .clone()
}

/// Re-read `app_settings` from the DB and swap in a fresh snapshot.
pub async fn reload(pool: &PgPool) -> ApiResult<()> {
    let s = load(pool).await?;
    let lock = SETTINGS
        .get()
        .expect("settings::init() must run before settings::reload()");
    *lock.write().expect("settings lock poisoned") = Arc::new(s);
    Ok(())
}
