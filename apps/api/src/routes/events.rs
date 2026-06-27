//! Events — namespace k8s-event feed from Postgres (1-week history), newest first.
//!
//!   GET /api/events/:ns
//!
//! Query params (all optional):
//!   q            — full-text search: ILIKE over reason/message/involved_name
//!   since        — shorthand time range: "1h" | "6h" | "24h" | "48h" | "7d" (sets `from`)
//!   from         — RFC3339 lower bound on last_seen (inclusive)
//!   to           — RFC3339 upper bound on last_seen (inclusive)
//!   involvedKind — exact kind filter (case-insensitive)
//!   involvedName — exact name filter
//!   cursor / limit — standard keyset pagination
//!
//! The collector (monitor::spawn_events) upserts every ~45s; native k8s events
//! expire after ~1h so Postgres is the only source of truth for history.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use crate::db::{list_k8s_events, K8sEventFilter};
use crate::dto::{EventInfo, Page, PageQuery};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/events/:ns", get(list_events))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventQuery {
    /// Full-text search over reason / message / involved_name (ILIKE).
    q: Option<String>,
    /// Shorthand time window: "1h", "6h", "24h", "48h", "7d".
    since: Option<String>,
    /// RFC3339 lower bound on last_seen.
    from: Option<String>,
    /// RFC3339 upper bound on last_seen.
    to: Option<String>,
    involved_kind: Option<String>,
    involved_name: Option<String>,
}

/// Parse a `since` shorthand ("1h", "24h", "7d", …) into an absolute UTC timestamp.
fn parse_since(s: &str) -> ApiResult<DateTime<Utc>> {
    let s = s.trim();
    let (num_str, unit) = if let Some(n) = s.strip_suffix('d') {
        (n, "d")
    } else if let Some(n) = s.strip_suffix('h') {
        (n, "h")
    } else if let Some(n) = s.strip_suffix('m') {
        (n, "m")
    } else {
        return Err(ApiError::BadRequest(format!(
            "unsupported since format: {s:?}; use e.g. '1h', '24h', '7d'"
        )));
    };
    let n: i64 = num_str
        .trim()
        .parse()
        .map_err(|_| ApiError::BadRequest(format!("invalid since value: {s:?}")))?;
    let secs = match unit {
        "d" => n * 86_400,
        "h" => n * 3_600,
        "m" => n * 60,
        _ => unreachable!(),
    };
    Ok(Utc::now() - chrono::Duration::seconds(secs))
}

fn parse_rfc3339(s: &str, field: &str) -> ApiResult<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|_| ApiError::BadRequest(format!("{field} must be RFC3339, got: {s:?}")))
}

async fn list_events(
    State(st): State<AppState>,
    Path(ns): Path<String>,
    Query(q): Query<EventQuery>,
    Query(page): Query<PageQuery>,
) -> ApiResult<Json<Page<EventInfo>>> {
    require_namespace(&ns)?;

    // Resolve time bounds: `since` takes priority over `from` when both are given.
    let from: Option<DateTime<Utc>> = match (&q.since, &q.from) {
        (Some(s), _) => Some(parse_since(s)?),
        (None, Some(f)) => Some(parse_rfc3339(f, "from")?),
        (None, None) => None,
    };
    let to: Option<DateTime<Utc>> = q.to.as_deref().map(|s| parse_rfc3339(s, "to")).transpose()?;

    let filter = K8sEventFilter {
        q: q.q,
        from,
        to,
        involved_kind: q.involved_kind,
        involved_name: q.involved_name,
    };

    let result = list_k8s_events(
        &st.db,
        &ns,
        page.cursor.as_deref(),
        page.limit.unwrap_or(50),
        &filter,
    )
    .await?;

    Ok(Json(result))
}
