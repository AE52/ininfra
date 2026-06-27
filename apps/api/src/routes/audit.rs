//! `GET /api/audit?cursor=&limit=` — cursor-paginated audit feed (ts DESC).

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use regex::Regex;
use serde::Deserialize;

use crate::db::{list_audit, AuditFilter};
use crate::dto::{AuditEntry, Page};
use crate::error::{ApiError, ApiResult};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/audit", get(get_audit))
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
}

#[derive(Debug, Deserialize)]
struct AuditQuery {
    cursor: Option<String>,
    limit: Option<i64>,
    actor: Option<String>,
    action: Option<String>,
    ns: Option<String>,
    role: Option<String>,
    /// Full-text search term (substring or regex depending on `regex` flag).
    q: Option<String>,
    /// When `"true"`, `q` is treated as a Postgres regex (`~*`).
    #[serde(default)]
    regex: Option<String>,
    /// RFC3339 lower bound on `ts` (inclusive). Ignored when `since` is also set.
    from: Option<String>,
    /// RFC3339 upper bound on `ts` (inclusive).
    to: Option<String>,
    /// Shorthand time window resolved server-side to an absolute lower bound:
    /// `1h`, `24h`, `7d`, `30d`. When present, overrides `from`.
    since: Option<String>,
}

async fn get_audit(
    State(st): State<AppState>,
    Query(q): Query<AuditQuery>,
) -> ApiResult<Json<Page<AuditEntry>>> {
    // ── regex flag ─────────────────────────────────────────────────────────
    let use_regex = q.regex.as_deref() == Some("true");

    // ── full-text search term ───────────────────────────────────────────────
    let search = clean(q.q);
    if use_regex {
        if let Some(pattern) = &search {
            // Validate the regex with the `regex` crate before handing it to Postgres.
            Regex::new(pattern)
                .map_err(|e| ApiError::BadRequest(format!("invalid regex: {e}")))?;
        }
    }

    // ── time bounds ─────────────────────────────────────────────────────────
    // `since` preset takes priority over `from`.
    let from: Option<DateTime<Utc>> = if let Some(since) = clean(q.since) {
        let lower = match since.as_str() {
            "1h" => Some(Utc::now() - Duration::hours(1)),
            "24h" => Some(Utc::now() - Duration::hours(24)),
            "7d" => Some(Utc::now() - Duration::days(7)),
            "30d" => Some(Utc::now() - Duration::days(30)),
            other => {
                return Err(ApiError::BadRequest(format!(
                    "unknown since preset '{other}'; expected 1h, 24h, 7d, or 30d"
                )));
            }
        };
        lower
    } else if let Some(s) = clean(q.from) {
        Some(
            DateTime::parse_from_rfc3339(&s)
                .map_err(|_| ApiError::BadRequest("from: not a valid RFC3339 timestamp".into()))?
                .with_timezone(&Utc),
        )
    } else {
        None
    };

    let to: Option<DateTime<Utc>> = if let Some(s) = clean(q.to) {
        Some(
            DateTime::parse_from_rfc3339(&s)
                .map_err(|_| ApiError::BadRequest("to: not a valid RFC3339 timestamp".into()))?
                .with_timezone(&Utc),
        )
    } else {
        None
    };

    let filter = AuditFilter {
        actor: clean(q.actor),
        action: clean(q.action),
        ns: clean(q.ns),
        role: clean(q.role),
        q: search,
        regex: use_regex,
        from,
        to,
    };
    let page = list_audit(&st.db, q.cursor.as_deref(), q.limit.unwrap_or(50), &filter).await?;
    Ok(Json(page))
}
