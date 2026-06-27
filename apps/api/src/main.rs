//! inInfra Console API.
//!
//! axum HTTP server fronting a kube-rs client (cluster ops) and a Postgres pool
//! (audit log + saved config). This file owns process bootstrap, shared state,
//! middleware, and graceful shutdown. Business logic lives in `routes::*`.

mod argo;
mod auth;
mod config;
mod conv;
mod db;
mod dto;
mod ecr;
mod error;
mod gateway_log;
mod k8s;
mod loki;
mod monitor;
mod observe;
mod perms;
mod routes;
mod settings;

use std::net::SocketAddr;
use std::sync::Arc;

use kube::Client;
use sqlx::PgPool;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

/// Shared application state injected into every handler.
#[derive(Clone)]
pub struct AppState {
    pub kube: Client,
    pub db: PgPool,
    /// Base URL of the Jenkins server used to trigger/track builds.
    pub jenkins_base_url: String,
    /// HS256 signing secret for session JWTs (shared with `auth` middleware).
    pub session_secret: auth::SecretKey,
    /// ECR client for image inventory / delete / commit resolution. `None` when
    /// AWS creds are not configured (deploy view degrades to k8s-only).
    pub ecr: Option<ecr::Ecr>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env in development; no-op if absent.
    let _ = dotenvy::dotenv();

    // Load deployment-agnostic runtime config (namespaces, cluster name, etc.).
    config::init();

    // Both `ring` and `aws-lc-rs` are compiled in (reqwest/sqlx vs the AWS SDK),
    // so rustls cannot auto-select a process-wide crypto provider. Pin aws-lc-rs
    // explicitly before any TLS client is built, or rustls panics at first use.
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("failed to install rustls crypto provider");

    init_tracing();

    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let jenkins_base_url = std::env::var("JENKINS_BASE_URL")
        .unwrap_or_else(|_| "http://jenkins.default.svc:8080".to_string());
    let bind_addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()
        .expect("BIND_ADDR must be a valid socket address");

    // Session signing secret (HS256). Required — refusing to boot without it
    // prevents accidentally running with a guessable/empty key.
    let session_secret = std::env::var("SESSION_SECRET")
        .expect("SESSION_SECRET must be set (>=32 random bytes)");
    if session_secret.len() < 16 {
        panic!("SESSION_SECRET is too short; provide >=32 random bytes");
    }
    let session_secret: auth::SecretKey = Arc::new(session_secret.into_bytes());

    // Initialize external dependencies.
    let kube = k8s::init_client().await?;
    let db = db::init_pool(&database_url).await?;
    db::run_migrations(&db).await?;

    // Load the runtime, wizard-managed settings: env Config defaults overlaid
    // with any values persisted by the setup wizard. Must run after migrations
    // (reads app_settings) and after config::init (the defaults source).
    settings::init(&db).await?;

    let ecr = ecr::init().await;

    // Bootstrap the admin user from env (sourced from a k8s Secret). Idempotent:
    // upsert refreshes the hash so rotating ADMIN_PASSWORD + restart updates it.
    bootstrap_admin(&db).await?;

    let state = AppState {
        kube,
        db,
        jenkins_base_url,
        session_secret,
        ecr,
    };

    // CORS: same-origin in prod (web proxies via /api), permissive for dev.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Background status monitor: records health transitions for the status page.
    monitor::spawn(state.clone());
    // Background gateway tailer: persists API-gateway 5xx (no-op if unconfigured).
    monitor::spawn_gateway(state.clone());
    // Background k8s event collector: upserts events every 45s for 1-week history.
    monitor::spawn_events(state.clone());
    // Background retention pruner: trims old audit/error/gateway/status/k8s_events rows.
    monitor::spawn_pruner(state.clone());

    let app = routes::router(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "ininfra-api listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Upsert the operator-provisioned admin from `ADMIN_USERNAME`/`ADMIN_PASSWORD`.
/// Both must be set together; if neither is set we skip (e.g. local dev with a
/// pre-seeded DB). Plaintext is hashed with argon2id and never stored or logged.
async fn bootstrap_admin(db: &PgPool) -> anyhow::Result<()> {
    let username = std::env::var("ADMIN_USERNAME").ok();
    let password = std::env::var("ADMIN_PASSWORD").ok();
    match (username, password) {
        (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => {
            let hash = auth::hash_password(&p)?;
            // ae52 is the bootstrap super_admin — the one operator-provisioned
            // account that can manage RBAC and can never be locked out. Upserted
            // on every boot so rotating ADMIN_PASSWORD takes effect on restart.
            db::upsert_user(db, &u, &hash, "super_admin").await?;
            tracing::info!(username = %u, "admin user provisioned");
        }
        _ => {
            tracing::warn!(
                "ADMIN_USERNAME/ADMIN_PASSWORD not set; skipping admin bootstrap"
            );
        }
    }
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,ininfra_api=debug"));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().json())
        .init();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    tracing::info!("shutdown signal received");
}
