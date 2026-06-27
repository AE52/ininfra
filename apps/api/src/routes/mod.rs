//! Route registration.
//!
//! Each resource area gets its own submodule (services, deployments, env, pods,
//! logs, builds, nodes, audit). Build-phase Rust agents create those modules
//! and wire them into `router()` below. The paths here are the AUTHORITATIVE
//! server contract — they must match `apps/web/lib/api.ts` and the README.
//!
//! Endpoint contract (all JSON, all under `/api` except `/healthz`):
//!
//!   GET    /healthz
//!   GET    /api/services?ns=
//!   GET    /api/deployments?ns=
//!   GET    /api/deployments/:ns/:name
//!   PATCH  /api/deployments/:ns/:name/scale      body ScaleRequest
//!   POST   /api/deployments/:ns/:name/restart
//!   GET    /api/env/:ns/:workload?reveal=
//!   PATCH  /api/env/:ns/:workload                body EnvPatch
//!   GET    /api/pods/:ns?selector=
//!   DELETE /api/pods/:ns/:name
//!   GET    /api/logs/:ns/:pod?container=&tail=
//!   GET    /api/logs/:ns/:pod/stream?container=  (SSE)
//!   GET    /api/logs-multi/:ns?pods=&q=&regex=&since=&from=&to=&limit=
//!   GET    /api/logs-multi/:ns/stream?pods=      (SSE)
//!   GET    /api/builds?job=
//!   POST   /api/builds                           body BuildTrigger
//!   GET    /api/builds/:job/:number
//!   GET    /api/nodes
//!   GET    /api/cronjobs?ns=
//!   GET    /api/jobs?ns=
//!   PATCH  /api/cronjobs/:ns/:name/suspend        body SuspendRequest
//!   POST   /api/cronjobs/:ns/:name/trigger
//!   GET    /api/audit?cursor=&limit=
//!   GET    /api/manifest/:kind/:ns/:name        (read-only raw YAML)
//!   GET    /api/describe/:kind/:ns/:name        (read-only events + status summary)
//!   GET    /api/secrets/health?ns=              (read-only TLS cert expiry scan)

use axum::{routing::get, Router};

use crate::AppState;

mod audit;
mod auth;
mod build_config;
mod builds;
mod deploy;
mod deployments;
mod describe;
mod errors;
mod favorites;
mod gateway;
mod search;
mod events;
mod hpa;
mod jobs;
mod logs;
mod manifest;
mod nodes;
mod env;
mod pods;
mod pvc;
mod secrets;
mod services;
mod setup;
mod statefulsets;
mod status;
mod users;
mod rbac;

/// Build the full application router.
///
/// Two tiers:
///   * PUBLIC  — `/healthz`, `POST /api/auth/login`, `POST /api/auth/logout`.
///   * PROTECTED — every resource route + `GET /api/auth/me`, fronted by the
///     `require_auth` middleware. Requests without a valid `session` cookie get
///     a 401, so the console is usable only after login.
pub fn router(state: AppState) -> Router {
    let secret = state.session_secret.clone();
    let capture_state = state.clone();

    let protected = Router::new()
        .merge(services::routes())
        .merge(deployments::routes())
        .merge(env::routes())
        .merge(pods::routes())
        .merge(logs::routes())
        .merge(builds::routes())
        .merge(nodes::routes())
        .merge(audit::routes())
        .merge(build_config::routes())
        .merge(hpa::routes())
        .merge(jobs::routes())
        .merge(statefulsets::routes())
        .merge(events::routes())
        .merge(pvc::routes())
        .merge(secrets::routes())
        .merge(users::routes())
        .merge(rbac::routes())
        .merge(deploy::routes())
        .merge(errors::routes())
        .merge(status::routes())
        .merge(favorites::routes())
        .merge(search::routes())
        .merge(gateway::routes())
        .merge(manifest::routes())
        .merge(describe::routes())
        .route("/api/auth/me", get(auth::me))
        // Layer order (outermost → innermost on request, innermost → outermost on response):
        //   require_auth (outermost) → capture_errors → enforce_permissions (innermost)
        //
        // route_layer adds layers from innermost outward, so we add:
        //   1. enforce_permissions first  → runs INNERMOST (handler-adjacent)
        //   2. capture_errors second      → wraps enforce_permissions (sees 403s)
        //   3. require_auth last          → runs OUTERMOST (auth gate)
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::perms::enforce_permissions,
        ))
        .route_layer(axum::middleware::from_fn_with_state(
            capture_state,
            crate::observe::capture_errors,
        ))
        .route_layer(axum::middleware::from_fn_with_state(
            secret,
            crate::auth::require_auth,
        ));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/config", get(app_config))
        .merge(setup::routes())
        .merge(auth::public_routes())
        .merge(protected)
        .with_state(state)
}

/// Liveness/readiness probe. Returns `{"status":"ok"}`.
async fn healthz() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({ "status": "ok" }))
}

/// Public runtime config — lets the UI render cluster name / namespaces /
/// enabled features without any of it being hard-coded in the frontend.
async fn app_config(
    axum::extract::State(st): axum::extract::State<AppState>,
) -> axum::Json<crate::dto::AppConfig> {
    // Product/cluster/namespaces always come from the runtime settings (env
    // defaults pre-wizard, wizard-chosen values after).
    let s = crate::settings::get();
    let c = crate::config::get();

    // Feature flags: once setup is complete, honor the wizard toggles; before
    // that, keep the env-derived behavior (so the console works pre-wizard).
    let setup_complete = matches!(
        crate::db::get_app_settings(&st.db).await,
        Ok(Some((true, _)))
    );
    let features = if setup_complete {
        crate::dto::Features {
            ecr: s.features.ecr,
            jenkins: s.features.jenkins,
            gateway: s.features.gateway,
        }
    } else {
        crate::dto::Features {
            ecr: st.ecr.is_some(),
            jenkins: !st.jenkins_base_url.trim().is_empty(),
            gateway: c.gateway.is_some(),
        }
    };

    axum::Json(crate::dto::AppConfig {
        product_name: s.product_name.clone(),
        cluster_name: s.cluster_name.clone(),
        managed_namespaces: s.managed_namespaces.clone(),
        features,
    })
}
