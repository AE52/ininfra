//! Postgres connection pool + migration runner.
//!
//! Build-phase DB agent adds query functions (audit insert/list, saved config)
//! here or in a sibling module. Migrations live in `db/migrations` at the repo
//! root and are applied with `run_migrations`.

use sqlx::postgres::{PgPool, PgPoolOptions};
use sqlx::types::Json;
use sqlx::{Postgres, QueryBuilder};

/// Parse a `"<ts_rfc3339>|<uuid>"` keyset cursor.
fn parse_keyset(
    cursor: Option<&str>,
) -> ApiResult<Option<(chrono::DateTime<chrono::Utc>, uuid::Uuid)>> {
    match cursor {
        None => Ok(None),
        Some(c) => {
            let (ts_str, id_str) = c
                .split_once('|')
                .ok_or_else(|| ApiError::BadRequest("malformed cursor".into()))?;
            let ts = chrono::DateTime::parse_from_rfc3339(ts_str)
                .map_err(|_| ApiError::BadRequest("malformed cursor timestamp".into()))?
                .with_timezone(&chrono::Utc);
            let id = uuid::Uuid::parse_str(id_str)
                .map_err(|_| ApiError::BadRequest("malformed cursor id".into()))?;
            Ok(Some((ts, id)))
        }
    }
}

/// True when a sqlx error is Postgres reporting an invalid regular expression
/// (SQLSTATE `2201B`, `invalid_regular_expression`). Used to turn a malformed
/// user-supplied `~*` pattern into a 400 rather than a 500.
fn is_invalid_regex_error(e: &sqlx::Error) -> bool {
    matches!(e, sqlx::Error::Database(db) if db.code().as_deref() == Some("2201B"))
}

/// Delete log rows older than the configured retention. `audit_days`/`log_days`
/// of 0 mean "keep forever". Returns the number of rows pruned.
pub async fn prune_logs(pool: &PgPool, audit_days: i64, log_days: i64) -> ApiResult<u64> {
    async fn prune(pool: &PgPool, table: &str, days: i64) -> ApiResult<u64> {
        // `table` is a fixed literal (never user input), so interpolation is safe.
        let res = sqlx::query(&format!(
            "DELETE FROM {table} WHERE ts < now() - ($1 * interval '1 day')"
        ))
        .bind(days)
        .execute(pool)
        .await?;
        Ok(res.rows_affected())
    }
    let mut n = 0;
    if audit_days > 0 {
        n += prune(pool, "audit_log", audit_days).await?;
    }
    if log_days > 0 {
        for t in ["error_events", "gateway_errors", "gateway_requests", "status_events"] {
            n += prune(pool, t, log_days).await?;
        }
    }
    Ok(n)
}

/// Delete k8s_events rows where `last_seen` is older than `event_days` days.
/// Returns the number of rows pruned. 0 means "keep forever".
pub async fn prune_k8s_events(pool: &PgPool, event_days: i64) -> ApiResult<u64> {
    if event_days == 0 {
        return Ok(0);
    }
    let res = sqlx::query(
        "DELETE FROM k8s_events WHERE last_seen < now() - ($1 * interval '1 day')",
    )
    .bind(event_days)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

use crate::dto::{AuditAction, AuditEntry, Page};
use crate::error::{ApiError, ApiResult};

/// Connect to Postgres using `DATABASE_URL`, with a bounded pool.
pub async fn init_pool(database_url: &str) -> ApiResult<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;
    tracing::info!("postgres pool initialized");
    Ok(pool)
}

/// Apply pending migrations embedded from `db/migrations`.
///
/// The path is relative to the workspace root at compile time; adjust the
/// `migrate!` macro path if the binary is built from a different CWD.
pub async fn run_migrations(pool: &PgPool) -> ApiResult<()> {
    sqlx::migrate!("../../db/migrations").run(pool).await.map_err(|e| {
        ApiError::Internal(anyhow::anyhow!("migration failed: {e}"))
    })?;
    tracing::info!("migrations applied");
    Ok(())
}

/* ------------------------------------------------------------------ */
/* Users — login/auth backing store (see migration 0002, auth.rs).     */
/* ------------------------------------------------------------------ */

/// A user row as needed for authentication.
#[derive(sqlx::FromRow)]
pub struct UserRow {
    pub username: String,
    pub password_hash: String,
    pub role: String,
}

/// Look up a user by username (case-insensitive).
pub async fn get_user(pool: &PgPool, username: &str) -> ApiResult<Option<UserRow>> {
    let row = sqlx::query_as::<_, UserRow>(
        "SELECT username, password_hash, role FROM users WHERE lower(username) = lower($1)",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// Create or update a user (used to bootstrap the admin from env on startup).
/// On conflict the password hash + role are refreshed so rotating the Secret
/// and restarting updates the credentials.
pub async fn upsert_user(
    pool: &PgPool,
    username: &str,
    password_hash: &str,
    role: &str,
) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO users (username, password_hash, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (username)
        DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
        "#,
    )
    .bind(username)
    .bind(password_hash)
    .bind(role)
    .execute(pool)
    .await?;
    Ok(())
}

/// Stamp `last_login = now()` for a user. Best-effort.
pub async fn touch_last_login(pool: &PgPool, username: &str) -> ApiResult<()> {
    sqlx::query("UPDATE users SET last_login = now() WHERE lower(username) = lower($1)")
        .bind(username)
        .execute(pool)
        .await?;
    Ok(())
}

/* ---- user management (admin CRUD over the same table) ---- */

use crate::dto::User;

/// Full user row for the management API (never exposes password_hash).
#[derive(sqlx::FromRow)]
struct UserMgmtRow {
    id: uuid::Uuid,
    username: String,
    role: String,
    created_at: chrono::DateTime<chrono::Utc>,
    last_login: Option<chrono::DateTime<chrono::Utc>>,
}

impl From<UserMgmtRow> for User {
    fn from(r: UserMgmtRow) -> Self {
        User {
            id: r.id.to_string(),
            username: r.username,
            role: r.role,
            created_at: r.created_at,
            last_login: r.last_login,
        }
    }
}

/// Cursor-paginated user list, ordered by username. Cursor is the last
/// username on the previous page (keyset on `lower(username)`). Includes a
/// total count.
pub async fn list_users(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: i64,
) -> ApiResult<Page<User>> {
    let limit = limit.clamp(1, 200);
    let rows: Vec<UserMgmtRow> = match cursor {
        Some(c) => {
            sqlx::query_as::<_, UserMgmtRow>(
                "SELECT id, username, role, created_at, last_login FROM users \
                 WHERE lower(username) > lower($1) ORDER BY lower(username) ASC LIMIT $2",
            )
            .bind(c)
            .bind(limit + 1)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_as::<_, UserMgmtRow>(
                "SELECT id, username, role, created_at, last_login FROM users \
                 ORDER BY lower(username) ASC LIMIT $1",
            )
            .bind(limit + 1)
            .fetch_all(pool)
            .await?
        }
    };

    let total: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(pool)
        .await?;

    let mut users: Vec<User> = rows.into_iter().map(User::from).collect();
    let next_cursor = if users.len() as i64 > limit {
        users.truncate(limit as usize);
        users.last().map(|u| u.username.clone())
    } else {
        None
    };
    Ok(Page { items: users, next_cursor, total: Some(total) })
}

/// Look up a single user by id.
pub async fn get_user_by_id(pool: &PgPool, id: &uuid::Uuid) -> ApiResult<Option<User>> {
    let row = sqlx::query_as::<_, UserMgmtRow>(
        "SELECT id, username, role, created_at, last_login FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(User::from))
}

/// Insert a new user. Returns `Conflict` if the username already exists.
pub async fn create_user(
    pool: &PgPool,
    username: &str,
    password_hash: &str,
    role: &str,
) -> ApiResult<User> {
    let row = sqlx::query_as::<_, UserMgmtRow>(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) \
         RETURNING id, username, role, created_at, last_login",
    )
    .bind(username)
    .bind(password_hash)
    .bind(role)
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            ApiError::Conflict(format!("user '{username}' already exists"))
        }
        _ => ApiError::from(e),
    })?;
    Ok(User::from(row))
}

/// Update a user's role and/or password hash. Returns the updated row, or
/// `None` if no such id.
pub async fn update_user(
    pool: &PgPool,
    id: &uuid::Uuid,
    role: Option<&str>,
    password_hash: Option<&str>,
) -> ApiResult<Option<User>> {
    let row = sqlx::query_as::<_, UserMgmtRow>(
        "UPDATE users SET \
            role = COALESCE($2, role), \
            password_hash = COALESCE($3, password_hash) \
         WHERE id = $1 \
         RETURNING id, username, role, created_at, last_login",
    )
    .bind(id)
    .bind(role)
    .bind(password_hash)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(User::from))
}

/// Delete a user by id. Returns true when a row was removed.
pub async fn delete_user(pool: &PgPool, id: &uuid::Uuid) -> ApiResult<bool> {
    let res = sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}

/// Count users with a privileged role (admin or super_admin).
/// Used to prevent removing the last privileged account (lockout guard).
pub async fn count_privileged(pool: &PgPool) -> ApiResult<i64> {
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM users WHERE role IN ('admin', 'super_admin')"
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}

/// Count users holding an admin-class role (admin or super_admin). Used by the
/// setup wizard to decide whether a first admin still needs to be created.
pub async fn count_admins(pool: &PgPool) -> ApiResult<i64> {
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM users WHERE role IN ('admin', 'super_admin')",
    )
    .fetch_one(pool)
    .await?;
    Ok(n)
}

/* ------------------------------------------------------------------ */
/* app_settings — singleton runtime settings (setup wizard).           */
/* ------------------------------------------------------------------ */

/// Read the singleton settings row: `(setup_complete, settings_json)`. Returns
/// `None` only if the seeded row is somehow missing (treated as "not set up").
pub async fn get_app_settings(
    pool: &PgPool,
) -> ApiResult<Option<(bool, serde_json::Value)>> {
    let row: Option<(bool, Json<serde_json::Value>)> = sqlx::query_as(
        "SELECT setup_complete, settings FROM app_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(c, j)| (c, j.0)))
}

/// Upsert the singleton settings row (id = 1), replacing `setup_complete` and
/// the `settings` JSONB and stamping `updated_at`. Runs inside the caller's
/// transaction so it commits atomically with the first-admin creation.
pub async fn upsert_app_settings(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    setup_complete: bool,
    settings_json: &serde_json::Value,
) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO app_settings (id, setup_complete, settings, updated_at)
        VALUES (1, $1, $2, now())
        ON CONFLICT (id)
        DO UPDATE SET setup_complete = EXCLUDED.setup_complete,
                      settings = EXCLUDED.settings,
                      updated_at = now()
        "#,
    )
    .bind(setup_complete)
    .bind(Json(settings_json))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Create a user inside an existing transaction (used by the setup wizard so
/// the first admin and the settings row commit atomically).
pub async fn create_user_tx(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    username: &str,
    password_hash: &str,
    role: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)",
    )
    .bind(username)
    .bind(password_hash)
    .bind(role)
    .execute(&mut **tx)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            ApiError::Conflict(format!("user '{username}' already exists"))
        }
        _ => ApiError::from(e),
    })?;
    Ok(())
}

/// True when the migrations table exists and has at least one applied row.
pub async fn migrations_applied(pool: &PgPool) -> bool {
    let row: Result<(i64,), _> =
        sqlx::query_as("SELECT count(*) FROM _sqlx_migrations")
            .fetch_one(pool)
            .await;
    matches!(row, Ok((n,)) if n > 0)
}

/* ------------------------------------------------------------------ */
/* Error events (Sentry-style failure feed).                           */
/* ------------------------------------------------------------------ */

use crate::dto::ErrorEvent;

/// What to record for a captured error.
pub struct NewError<'a> {
    pub username: Option<&'a str>,
    pub source: &'a str,
    pub method: Option<&'a str>,
    pub path: Option<&'a str>,
    pub status: Option<i32>,
    pub code: Option<&'a str>,
    pub message: &'a str,
    pub detail: serde_json::Value,
}

/// Insert an error event. Best-effort: callers typically `let _ =` the result
/// so error capture never breaks the request being served.
pub async fn insert_error(pool: &PgPool, e: NewError<'_>) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO error_events (username, source, method, path, status, code, message, detail)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(e.username)
    .bind(e.source)
    .bind(e.method)
    .bind(e.path)
    .bind(e.status)
    .bind(e.code)
    .bind(e.message)
    .bind(Json(e.detail))
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct ErrorRow {
    id: uuid::Uuid,
    ts: chrono::DateTime<chrono::Utc>,
    username: Option<String>,
    source: String,
    method: Option<String>,
    path: Option<String>,
    status: Option<i32>,
    code: Option<String>,
    message: String,
    detail: Json<serde_json::Value>,
}

impl From<ErrorRow> for ErrorEvent {
    fn from(r: ErrorRow) -> Self {
        ErrorEvent {
            id: r.id.to_string(),
            ts: r.ts,
            username: r.username,
            source: r.source,
            method: r.method,
            path: r.path,
            status: r.status,
            code: r.code,
            message: r.message,
            detail: r.detail.0,
        }
    }
}

/* ------------------------------------------------------------------ */
/* Status events (status page engine).                                 */
/* ------------------------------------------------------------------ */

/// Record a component status transition.
pub async fn insert_status_event(
    pool: &PgPool,
    kind: &str,
    namespace: &str,
    name: &str,
    status: &str,
    prev: Option<&str>,
    detail: serde_json::Value,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO status_events (kind, namespace, name, status, prev_status, detail) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(kind)
    .bind(namespace)
    .bind(name)
    .bind(status)
    .bind(prev)
    .bind(Json(detail))
    .execute(pool)
    .await?;
    Ok(())
}

/// A single recorded transition (for reconstructing incidents/uptime).
#[derive(sqlx::FromRow, Clone)]
pub struct StatusTransition {
    pub ts: chrono::DateTime<chrono::Utc>,
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub status: String,
}

/// All transitions at/after `since`, oldest first.
pub async fn status_events_since(
    pool: &PgPool,
    since: chrono::DateTime<chrono::Utc>,
) -> ApiResult<Vec<StatusTransition>> {
    let rows = sqlx::query_as::<_, StatusTransition>(
        "SELECT ts, kind, namespace, name, status FROM status_events \
         WHERE ts >= $1 ORDER BY ts ASC",
    )
    .bind(since)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// The most recent status for every component seen so far — used to seed the
/// monitor on startup so a restart doesn't re-record unchanged components.
pub async fn latest_statuses(pool: &PgPool) -> ApiResult<Vec<(String, String, String)>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT ON (namespace, name) namespace, name, status \
         FROM status_events ORDER BY namespace, name, ts DESC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/* ------------------------------------------------------------------ */
/* Gateway errors (persisted 5xx from the API gateway access log).     */
/* ------------------------------------------------------------------ */

use crate::dto::{GatewayError, GatewayLogEntry, GatewayRequest};

/// Record a gateway 5xx. `ts` defaults to now when the log line had no parseable time.
pub async fn insert_gateway_error(pool: &PgPool, e: &GatewayLogEntry) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO gateway_errors \
         (ts, method, path, status, upstream_status, host, client_ip, latency_ms, upstream_addr, user_agent) \
         VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(e.ts)
    .bind(&e.method)
    .bind(&e.path)
    .bind(e.status)
    .bind(e.upstream_status)
    .bind(&e.host)
    .bind(&e.client_ip)
    .bind(e.latency_ms)
    .bind(&e.upstream_addr)
    .bind(&e.user_agent)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct GatewayErrorRow {
    id: uuid::Uuid,
    ts: chrono::DateTime<chrono::Utc>,
    method: String,
    path: String,
    status: i32,
    upstream_status: Option<i32>,
    host: Option<String>,
    client_ip: Option<String>,
    latency_ms: Option<i64>,
    upstream_addr: Option<String>,
    user_agent: Option<String>,
}

impl From<GatewayErrorRow> for GatewayError {
    fn from(r: GatewayErrorRow) -> Self {
        GatewayError {
            id: r.id.to_string(),
            ts: r.ts,
            method: r.method,
            path: r.path,
            status: r.status,
            upstream_status: r.upstream_status,
            host: r.host,
            client_ip: r.client_ip,
            latency_ms: r.latency_ms,
            upstream_addr: r.upstream_addr,
            user_agent: r.user_agent,
        }
    }
}

/// Cursor-paginated, newest-first gateway error feed. Cursor `"<ts>|<id>"`.
/// Filters for the gateway error feed (all optional, ANDed).
#[derive(Debug, Default)]
pub struct GatewayErrorFilter {
    /// Partial, case-insensitive match on the request path.
    pub path: Option<String>,
    pub status: Option<i32>,
    pub method: Option<String>,
}

pub async fn list_gateway_errors(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: i64,
    f: &GatewayErrorFilter,
) -> ApiResult<Page<GatewayError>> {
    let limit = limit.clamp(1, 200);
    let keyset = parse_keyset(cursor)?;

    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT id, ts, method, path, status, upstream_status, host, client_ip, latency_ms, upstream_addr, user_agent FROM gateway_errors WHERE TRUE",
    );
    if let Some(path) = &f.path {
        qb.push(" AND path ILIKE ").push_bind(format!("%{path}%"));
    }
    if let Some(status) = f.status {
        qb.push(" AND status = ").push_bind(status);
    }
    if let Some(method) = &f.method {
        qb.push(" AND method = ").push_bind(method.clone());
    }
    if let Some((ts, id)) = keyset {
        qb.push(" AND (ts, id) < (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY ts DESC, id DESC LIMIT ").push_bind(limit + 1);

    let rows: Vec<GatewayErrorRow> =
        qb.build_query_as::<GatewayErrorRow>().fetch_all(pool).await?;
    let mut items: Vec<GatewayError> = rows.into_iter().map(GatewayError::from).collect();
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|e| format!("{}|{}", e.ts.to_rfc3339(), e.id))
    } else {
        None
    };
    Ok(Page::new(items, next_cursor))
}

/* ------------------------------------------------------------------ */
/* Gateway requests (sampled all-requests feed, with real client IP).  */
/* ------------------------------------------------------------------ */

/// Persist one sampled gateway access-log line. `ts` defaults to now when the
/// line had no parseable time.
pub async fn insert_gateway_request(pool: &PgPool, e: &GatewayLogEntry) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO gateway_requests \
         (ts, method, path, status, upstream_status, host, client_ip, xff, latency_ms, upstream_addr, user_agent, bytes, request_id, has_auth, x_user_id, x_role_id, is_admin) \
         VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)",
    )
    .bind(e.ts)
    .bind(&e.method)
    .bind(&e.path)
    .bind(e.status)
    .bind(e.upstream_status)
    .bind(&e.host)
    .bind(&e.client_ip)
    .bind(&e.xff)
    .bind(e.latency_ms)
    .bind(&e.upstream_addr)
    .bind(&e.user_agent)
    .bind(e.bytes)
    .bind(&e.request_id)
    .bind(e.has_auth)
    .bind(&e.x_user_id)
    .bind(&e.x_role_id)
    .bind(e.is_admin)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct GatewayRequestRow {
    id: uuid::Uuid,
    ts: chrono::DateTime<chrono::Utc>,
    method: String,
    path: String,
    status: i32,
    upstream_status: Option<i32>,
    host: Option<String>,
    client_ip: Option<String>,
    xff: Option<String>,
    latency_ms: Option<i64>,
    upstream_addr: Option<String>,
    user_agent: Option<String>,
    bytes: Option<i64>,
    request_id: Option<String>,
    has_auth: Option<bool>,
    x_user_id: Option<String>,
    x_role_id: Option<String>,
    is_admin: Option<bool>,
}

impl From<GatewayRequestRow> for GatewayRequest {
    fn from(r: GatewayRequestRow) -> Self {
        GatewayRequest {
            id: r.id.to_string(),
            ts: r.ts,
            method: r.method,
            path: r.path,
            status: r.status,
            upstream_status: r.upstream_status,
            host: r.host,
            client_ip: r.client_ip,
            xff: r.xff,
            latency_ms: r.latency_ms,
            upstream_addr: r.upstream_addr,
            user_agent: r.user_agent,
            bytes: r.bytes,
            request_id: r.request_id,
            has_auth: r.has_auth,
            x_user_id: r.x_user_id,
            x_role_id: r.x_role_id,
            is_admin: r.is_admin,
        }
    }
}

/// Filters for the sampled request feed (all optional, ANDed).
#[derive(Debug, Default)]
pub struct GatewayRequestFilter {
    /// Exact or prefix match on the client IP (ILIKE '<ip>%').
    pub ip: Option<String>,
    /// Partial, case-insensitive match on the request path.
    pub path: Option<String>,
    pub status: Option<i32>,
    pub method: Option<String>,
    /// Only requests that carried (true) / lacked (false) an Authorization header.
    pub has_auth: Option<bool>,
    /// Exact match on the resolved caller user id.
    pub user_id: Option<String>,
    /// Exact match on the resolved caller role id.
    pub role_id: Option<String>,
    /// Only admin (true) / non-admin (false) callers.
    pub is_admin: Option<bool>,
}

/// Cursor-paginated, newest-first sampled request feed. Cursor `"<ts>|<id>"`.
pub async fn list_gateway_requests(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: i64,
    f: &GatewayRequestFilter,
) -> ApiResult<Page<GatewayRequest>> {
    let limit = limit.clamp(1, 200);
    let keyset = parse_keyset(cursor)?;

    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT id, ts, method, path, status, upstream_status, host, client_ip, xff, latency_ms, upstream_addr, user_agent, bytes, request_id, has_auth, x_user_id, x_role_id, is_admin FROM gateway_requests WHERE TRUE",
    );
    if let Some(ip) = &f.ip {
        qb.push(" AND client_ip ILIKE ").push_bind(format!("{ip}%"));
    }
    if let Some(path) = &f.path {
        qb.push(" AND path ILIKE ").push_bind(format!("%{path}%"));
    }
    if let Some(status) = f.status {
        qb.push(" AND status = ").push_bind(status);
    }
    if let Some(method) = &f.method {
        qb.push(" AND method = ").push_bind(method.clone());
    }
    if let Some(has_auth) = f.has_auth {
        qb.push(" AND has_auth = ").push_bind(has_auth);
    }
    if let Some(user_id) = &f.user_id {
        qb.push(" AND x_user_id = ").push_bind(user_id.clone());
    }
    if let Some(role_id) = &f.role_id {
        qb.push(" AND x_role_id = ").push_bind(role_id.clone());
    }
    if let Some(is_admin) = f.is_admin {
        qb.push(" AND is_admin = ").push_bind(is_admin);
    }
    if let Some((ts, id)) = keyset {
        qb.push(" AND (ts, id) < (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY ts DESC, id DESC LIMIT ").push_bind(limit + 1);

    let rows: Vec<GatewayRequestRow> =
        qb.build_query_as::<GatewayRequestRow>().fetch_all(pool).await?;
    let mut items: Vec<GatewayRequest> = rows.into_iter().map(GatewayRequest::from).collect();
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|e| format!("{}|{}", e.ts.to_rfc3339(), e.id))
    } else {
        None
    };
    Ok(Page::new(items, next_cursor))
}

/* ------------------------------------------------------------------ */
/* Favorites (per-user pinned resources).                              */
/* ------------------------------------------------------------------ */

use crate::dto::{Favorite, NewFavorite};

#[derive(sqlx::FromRow)]
struct FavoriteRow {
    id: uuid::Uuid,
    kind: String,
    namespace: String,
    name: String,
    href: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

impl From<FavoriteRow> for Favorite {
    fn from(r: FavoriteRow) -> Self {
        Favorite {
            id: r.id.to_string(),
            kind: r.kind,
            namespace: r.namespace,
            name: r.name,
            href: r.href,
            created_at: r.created_at,
        }
    }
}

pub async fn list_favorites(pool: &PgPool, username: &str) -> ApiResult<Vec<Favorite>> {
    let rows = sqlx::query_as::<_, FavoriteRow>(
        "SELECT id, kind, namespace, name, href, created_at FROM favorites \
         WHERE username = $1 ORDER BY created_at DESC",
    )
    .bind(username)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Favorite::from).collect())
}

/// Add (or refresh) a favorite. Idempotent on (username, kind, namespace, name).
pub async fn add_favorite(
    pool: &PgPool,
    username: &str,
    f: &NewFavorite,
) -> ApiResult<Favorite> {
    let row = sqlx::query_as::<_, FavoriteRow>(
        "INSERT INTO favorites (username, kind, namespace, name, href) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (username, kind, namespace, name) DO UPDATE SET href = EXCLUDED.href \
         RETURNING id, kind, namespace, name, href, created_at",
    )
    .bind(username)
    .bind(&f.kind)
    .bind(&f.namespace)
    .bind(&f.name)
    .bind(&f.href)
    .fetch_one(pool)
    .await?;
    Ok(Favorite::from(row))
}

pub async fn remove_favorite(
    pool: &PgPool,
    username: &str,
    kind: &str,
    namespace: &str,
    name: &str,
) -> ApiResult<bool> {
    let res = sqlx::query(
        "DELETE FROM favorites WHERE username = $1 AND kind = $2 AND namespace = $3 AND name = $4",
    )
    .bind(username)
    .bind(kind)
    .bind(namespace)
    .bind(name)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

/// Each component's status as of just before `before` — the entry state for an
/// uptime window (so downtime that started before the window is accounted for).
pub async fn statuses_as_of(
    pool: &PgPool,
    before: chrono::DateTime<chrono::Utc>,
) -> ApiResult<Vec<(String, String, String)>> {
    let rows: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT DISTINCT ON (namespace, name) namespace, name, status \
         FROM status_events WHERE ts < $1 ORDER BY namespace, name, ts DESC",
    )
    .bind(before)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Cursor-paginated, newest-first error feed. Cursor is `"<ts_rfc3339>|<id>"`,
/// keyset on `(ts, id)`. `limit` clamped to `[1, 200]`.
/// Filters for the error feed (all optional, ANDed).
#[derive(Debug, Default)]
pub struct ErrorFilter {
    /// Partial, case-insensitive match on username.
    pub username: Option<String>,
    pub status: Option<i32>,
    pub source: Option<String>,
    /// User's current role (admin|viewer) — joins the users table.
    pub role: Option<String>,
}

pub async fn list_errors(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: i64,
    f: &ErrorFilter,
) -> ApiResult<Page<ErrorEvent>> {
    let limit = limit.clamp(1, 200);
    let keyset = parse_keyset(cursor)?;

    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT e.id, e.ts, e.username, e.source, e.method, e.path, e.status, e.code, e.message, e.detail FROM error_events e",
    );
    if f.role.is_some() {
        qb.push(" JOIN users u ON lower(u.username) = lower(e.username)");
    }
    qb.push(" WHERE TRUE");
    if let Some(username) = &f.username {
        qb.push(" AND e.username ILIKE ").push_bind(format!("%{username}%"));
    }
    if let Some(status) = f.status {
        qb.push(" AND e.status = ").push_bind(status);
    }
    if let Some(source) = &f.source {
        qb.push(" AND e.source = ").push_bind(source.clone());
    }
    if let Some(role) = &f.role {
        qb.push(" AND u.role = ").push_bind(role.clone());
    }
    if let Some((ts, id)) = keyset {
        qb.push(" AND (e.ts, e.id) < (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY e.ts DESC, e.id DESC LIMIT ")
        .push_bind(limit + 1);

    let rows: Vec<ErrorRow> = qb.build_query_as::<ErrorRow>().fetch_all(pool).await?;

    let mut items: Vec<ErrorEvent> = rows.into_iter().map(ErrorEvent::from).collect();
    let next_cursor = if items.len() as i64 > limit {
        items.truncate(limit as usize);
        items.last().map(|e| format!("{}|{}", e.ts.to_rfc3339(), e.id))
    } else {
        None
    };
    Ok(Page::new(items, next_cursor))
}

/* ------------------------------------------------------------------ */
/* Audit log — the shared write path for every mutating handler.       */
/* ------------------------------------------------------------------ */

/// What to record for a mutating action. `actor` is the authenticated user's
/// username (injected via the `Identity` extractor on mutating handlers).
pub struct NewAudit<'a> {
    pub actor: &'a str,
    pub action: AuditAction,
    pub target_ns: Option<&'a str>,
    pub target_kind: Option<&'a str>,
    pub target_name: Option<&'a str>,
    pub detail: serde_json::Value,
}

/// Insert an audit row and return its generated id (as a string, matching the
/// `AuditEntry.id` / `MutationAck.auditId` DTO field).
pub async fn insert_audit(pool: &PgPool, a: NewAudit<'_>) -> ApiResult<String> {
    let id: uuid::Uuid = sqlx::query_scalar(
        r#"
        INSERT INTO audit_log (actor, action, target_ns, target_kind, target_name, detail)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
    )
    .bind(a.actor)
    .bind(a.action.as_str())
    .bind(a.target_ns)
    .bind(a.target_kind)
    .bind(a.target_name)
    .bind(Json(a.detail))
    .fetch_one(pool)
    .await?;
    Ok(id.to_string())
}

/// One row of `audit_log`, decoded straight from Postgres.
#[derive(sqlx::FromRow)]
struct AuditRow {
    id: uuid::Uuid,
    ts: chrono::DateTime<chrono::Utc>,
    actor: String,
    action: String,
    target_ns: Option<String>,
    target_kind: Option<String>,
    target_name: Option<String>,
    detail: Json<serde_json::Value>,
}

impl From<AuditRow> for AuditEntry {
    fn from(r: AuditRow) -> Self {
        AuditEntry {
            id: r.id.to_string(),
            ts: r.ts,
            actor: r.actor,
            action: r.action,
            target_ns: r.target_ns,
            target_kind: r.target_kind,
            target_name: r.target_name,
            detail: r.detail.0,
        }
    }
}

/// Cursor-paginated, newest-first audit feed.
///
/// The cursor is the opaque `"<ts_rfc3339>|<id>"` of the last item on the
/// previous page; pagination is keyset on `(ts, id)` so it is stable under
/// concurrent inserts. `limit` is clamped to `[1, 200]`.
/// Filters for the audit feed (all optional, ANDed).
#[derive(Debug, Default)]
pub struct AuditFilter {
    /// Partial, case-insensitive match on the actor (username).
    pub actor: Option<String>,
    pub action: Option<String>,
    /// Target namespace (exact).
    pub ns: Option<String>,
    /// Actor's current role (admin|viewer) — joins the users table.
    pub role: Option<String>,
    /// Full-text search over actor/action/target_name/target_ns/detail::text.
    /// When `regex` is false, uses ILIKE '%q%'; when true, uses Postgres `~*`.
    pub q: Option<String>,
    /// Whether `q` is a regex pattern (true) or a plain substring (false).
    pub regex: bool,
    /// Lower bound on `ts` (inclusive).
    pub from: Option<chrono::DateTime<chrono::Utc>>,
    /// Upper bound on `ts` (inclusive).
    pub to: Option<chrono::DateTime<chrono::Utc>>,
}

pub async fn list_audit(
    pool: &PgPool,
    cursor: Option<&str>,
    limit: i64,
    f: &AuditFilter,
) -> ApiResult<Page<AuditEntry>> {
    let limit = limit.clamp(1, 200);
    let keyset = parse_keyset(cursor)?;

    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT a.id, a.ts, a.actor, a.action, a.target_ns, a.target_kind, a.target_name, a.detail FROM audit_log a",
    );
    if f.role.is_some() {
        qb.push(" JOIN users u ON lower(u.username) = lower(a.actor)");
    }
    qb.push(" WHERE TRUE");
    if let Some(actor) = &f.actor {
        qb.push(" AND a.actor ILIKE ").push_bind(format!("%{actor}%"));
    }
    if let Some(action) = &f.action {
        qb.push(" AND a.action = ").push_bind(action.clone());
    }
    if let Some(ns) = &f.ns {
        qb.push(" AND a.target_ns = ").push_bind(ns.clone());
    }
    if let Some(role) = &f.role {
        qb.push(" AND u.role = ").push_bind(role.clone());
    }
    // Full-text search: regex mode uses Postgres `~*` (case-insensitive),
    // substring mode uses ILIKE. Both cover actor, action, target_name,
    // target_ns, and the JSON detail cast to text.
    if let Some(q) = &f.q {
        if f.regex {
            qb.push(" AND (a.actor ~* ")
                .push_bind(q.clone())
                .push(" OR a.action ~* ")
                .push_bind(q.clone())
                .push(" OR a.target_name ~* ")
                .push_bind(q.clone())
                .push(" OR a.target_ns ~* ")
                .push_bind(q.clone())
                .push(" OR a.detail::text ~* ")
                .push_bind(q.clone())
                .push(")");
        } else {
            let pat = format!("%{q}%");
            qb.push(" AND (a.actor ILIKE ")
                .push_bind(pat.clone())
                .push(" OR a.action ILIKE ")
                .push_bind(pat.clone())
                .push(" OR a.target_name ILIKE ")
                .push_bind(pat.clone())
                .push(" OR a.target_ns ILIKE ")
                .push_bind(pat.clone())
                .push(" OR a.detail::text ILIKE ")
                .push_bind(pat)
                .push(")");
        }
    }
    if let Some(from) = f.from {
        qb.push(" AND a.ts >= ").push_bind(from);
    }
    if let Some(to) = f.to {
        qb.push(" AND a.ts <= ").push_bind(to);
    }
    if let Some((ts, id)) = keyset {
        qb.push(" AND (a.ts, a.id) < (")
            .push_bind(ts)
            .push(", ")
            .push_bind(id)
            .push(")");
    }
    qb.push(" ORDER BY a.ts DESC, a.id DESC LIMIT ")
        .push_bind(limit + 1);

    let rows: Vec<AuditRow> = qb
        .build_query_as::<AuditRow>()
        .fetch_all(pool)
        .await
        .map_err(|e| {
            // A pattern that passes the Rust `regex` crate can still be invalid
            // POSIX ERE, which makes Postgres `~*` raise SQLSTATE 2201B
            // (invalid_regular_expression). Surface that as a 400 (client error)
            // instead of a 500 — only meaningful in regex mode.
            if f.regex && is_invalid_regex_error(&e) {
                ApiError::BadRequest("invalid search pattern".into())
            } else {
                ApiError::from(e)
            }
        })?;

    let mut entries: Vec<AuditEntry> = rows.into_iter().map(AuditEntry::from).collect();
    let next_cursor = if entries.len() as i64 > limit {
        // Drop the probe row; the cursor points at the last kept item.
        entries.truncate(limit as usize);
        entries
            .last()
            .map(|e| format!("{}|{}", e.ts.to_rfc3339(), e.id))
    } else {
        None
    };

    Ok(Page::new(entries, next_cursor))
}

/* ------------------------------------------------------------------ */
/* k8s_events — persisted Kubernetes event store (1-week history).     */
/* ------------------------------------------------------------------ */

use crate::dto::EventInfo;

/// All fields needed to upsert one k8s event.
pub struct K8sEventRow<'a> {
    pub namespace: &'a str,
    pub type_: &'a str,
    pub reason: &'a str,
    pub message: &'a str,
    pub involved_kind: &'a str,
    pub involved_name: &'a str,
    pub count: i32,
    pub first_seen: Option<chrono::DateTime<chrono::Utc>>,
    pub last_seen: Option<chrono::DateTime<chrono::Utc>>,
    pub source: Option<&'a str>,
}

/// Upsert one event row.
///
/// On conflict on the dedup key `(namespace, involved_kind, involved_name,
/// reason, message)` the count is updated to the max of existing/new,
/// `last_seen` is refreshed, and `type` / `source` / `observed_at` are updated.
pub async fn upsert_k8s_event(pool: &PgPool, e: &K8sEventRow<'_>) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO k8s_events
            (namespace, type, reason, message, involved_kind, involved_name,
             count, first_seen, last_seen, source, observed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        ON CONFLICT (namespace, involved_kind, involved_name, reason, message)
        DO UPDATE SET
            type        = EXCLUDED.type,
            count       = GREATEST(k8s_events.count, EXCLUDED.count),
            last_seen   = EXCLUDED.last_seen,
            source      = COALESCE(EXCLUDED.source, k8s_events.source),
            observed_at = now()
        "#,
    )
    .bind(e.namespace)
    .bind(e.type_)
    .bind(e.reason)
    .bind(e.message)
    .bind(e.involved_kind)
    .bind(e.involved_name)
    .bind(e.count)
    .bind(e.first_seen)
    .bind(e.last_seen)
    .bind(e.source)
    .execute(pool)
    .await?;
    Ok(())
}

/// Filters for the k8s event feed (all optional, ANDed).
#[derive(Debug, Default)]
pub struct K8sEventFilter {
    /// Partial, case-insensitive search over reason, message, and involved_name.
    pub q: Option<String>,
    /// Lower bound on `last_seen` (inclusive).
    pub from: Option<chrono::DateTime<chrono::Utc>>,
    /// Upper bound on `last_seen` (inclusive).
    pub to: Option<chrono::DateTime<chrono::Utc>>,
    /// Exact match on involved_kind (case-insensitive).
    pub involved_kind: Option<String>,
    /// Exact match on involved_name.
    pub involved_name: Option<String>,
}

#[derive(sqlx::FromRow)]
struct K8sEventDbRow {
    id: i64,
    #[allow(dead_code)]
    namespace: String,
    #[sqlx(rename = "type")]
    type_: String,
    reason: String,
    message: String,
    involved_kind: String,
    involved_name: String,
    count: i32,
    first_seen: Option<chrono::DateTime<chrono::Utc>>,
    last_seen: Option<chrono::DateTime<chrono::Utc>>,
    source: Option<String>,
}

impl From<K8sEventDbRow> for EventInfo {
    fn from(r: K8sEventDbRow) -> Self {
        EventInfo {
            type_: r.type_,
            reason: r.reason,
            message: r.message,
            involved_kind: r.involved_kind,
            involved_name: r.involved_name,
            count: r.count,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            source: r.source,
        }
    }
}

/// Cursor-paginated, newest-first k8s event feed for one namespace.
/// Cursor is the `id` (bigint as decimal string) of the last seen row.
pub async fn list_k8s_events(
    pool: &PgPool,
    namespace: &str,
    cursor: Option<&str>,
    limit: i64,
    f: &K8sEventFilter,
) -> ApiResult<Page<EventInfo>> {
    let limit = limit.clamp(1, 200);
    let cursor_id: Option<i64> = cursor
        .map(|c| {
            c.parse::<i64>()
                .map_err(|_| ApiError::BadRequest("malformed cursor".into()))
        })
        .transpose()?;

    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
        "SELECT id, namespace, type, reason, message, involved_kind, involved_name, \
         count, first_seen, last_seen, source FROM k8s_events WHERE namespace = ",
    );
    qb.push_bind(namespace);
    if let Some(q) = &f.q {
        let pat = format!("%{q}%");
        qb.push(" AND (reason ILIKE ")
            .push_bind(pat.clone())
            .push(" OR message ILIKE ")
            .push_bind(pat.clone())
            .push(" OR involved_name ILIKE ")
            .push_bind(pat)
            .push(")");
    }
    if let Some(from) = f.from {
        qb.push(" AND last_seen >= ").push_bind(from);
    }
    if let Some(to) = f.to {
        qb.push(" AND last_seen <= ").push_bind(to);
    }
    if let Some(kind) = &f.involved_kind {
        qb.push(" AND involved_kind ILIKE ").push_bind(kind.clone());
    }
    if let Some(name) = &f.involved_name {
        qb.push(" AND involved_name = ").push_bind(name.clone());
    }
    if let Some(id) = cursor_id {
        qb.push(" AND id < ").push_bind(id);
    }
    qb.push(" ORDER BY last_seen DESC NULLS LAST, id DESC LIMIT ")
        .push_bind(limit + 1);

    let rows: Vec<K8sEventDbRow> =
        qb.build_query_as::<K8sEventDbRow>().fetch_all(pool).await?;

    // We need the raw `id` for the cursor but EventInfo doesn't carry it.
    // Re-query with id included and derive the cursor before converting.
    // Actually, we already SELECT id in the query above — extract it before converting.
    let next_cursor = if rows.len() as i64 > limit {
        rows.get(limit as usize - 1).map(|r| r.id.to_string())
    } else {
        None
    };

    let mut items: Vec<EventInfo> = rows.into_iter().map(EventInfo::from).collect();
    if items.len() as i64 > limit {
        items.truncate(limit as usize);
    }

    Ok(Page::new(items, next_cursor))
}

/* ------------------------------------------------------------------ */
/* RBAC — role_permissions overrides                                   */
/* ------------------------------------------------------------------ */

/// Look up a stored permission override for (role, key).
/// Returns `None` when no row exists (caller should use code default).
/// On DB error, propagate — callers must handle and fall back to default.
pub async fn get_permission_override(
    pool: &PgPool,
    role: &str,
    key: &str,
) -> ApiResult<Option<bool>> {
    let row: Option<(bool,)> = sqlx::query_as(
        "SELECT allowed FROM role_permissions WHERE role = $1 AND permission_key = $2",
    )
    .bind(role)
    .bind(key)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(v,)| v))
}

/// Return all stored overrides as (role, key, allowed) tuples.
pub async fn list_permission_overrides(
    pool: &PgPool,
) -> ApiResult<Vec<(String, String, bool)>> {
    let rows: Vec<(String, String, bool)> =
        sqlx::query_as("SELECT role, permission_key, allowed FROM role_permissions ORDER BY role, permission_key")
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

/// Insert or replace a permission override.
pub async fn upsert_permission_override(
    pool: &PgPool,
    role: &str,
    key: &str,
    allowed: bool,
    updated_by: &str,
) -> ApiResult<()> {
    sqlx::query(
        r#"
        INSERT INTO role_permissions (role, permission_key, allowed, updated_by, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (role, permission_key)
        DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = now()
        "#,
    )
    .bind(role)
    .bind(key)
    .bind(allowed)
    .bind(updated_by)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete an override row (reverts the key to its code default).
pub async fn delete_permission_override(
    pool: &PgPool,
    role: &str,
    key: &str,
) -> ApiResult<()> {
    sqlx::query(
        "DELETE FROM role_permissions WHERE role = $1 AND permission_key = $2",
    )
    .bind(role)
    .bind(key)
    .execute(pool)
    .await?;
    Ok(())
}
