//! Error feed (Sentry-style).
//!
//!   GET  /api/errors?cursor=&limit=   -> Page<ErrorEvent>   (admin only)
//!   POST /api/errors                  body ClientErrorReport (any authed user)
//!
//! Server-side errors are captured automatically by the `observe::capture_errors`
//! middleware; this module exposes the admin feed and a browser error-report sink.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};

use serde::Deserialize;

use crate::auth::{AdminIdentity, Identity};
use crate::db::{self, insert_error, ErrorFilter, NewError};
use crate::dto::{ClientErrorReport, ErrorEvent, MutationAck, Page};
use crate::error::ApiResult;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/errors", get(list).post(report))
}

fn clean(s: Option<String>) -> Option<String> {
    s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
}

#[derive(Debug, Deserialize)]
struct ErrorsQuery {
    cursor: Option<String>,
    limit: Option<i64>,
    username: Option<String>,
    status: Option<i32>,
    source: Option<String>,
    role: Option<String>,
}

async fn list(
    _admin: AdminIdentity,
    State(st): State<AppState>,
    Query(q): Query<ErrorsQuery>,
) -> ApiResult<Json<Page<ErrorEvent>>> {
    let filter = ErrorFilter {
        username: clean(q.username),
        status: q.status,
        source: clean(q.source),
        role: clean(q.role),
    };
    let page = db::list_errors(&st.db, q.cursor.as_deref(), q.limit.unwrap_or(50), &filter).await?;
    Ok(Json(page))
}

/// Record a browser-reported client error. Allowed for any authenticated user
/// (the writer gate exempts this path) so viewers' UI errors are captured too.
async fn report(
    identity: Identity,
    State(st): State<AppState>,
    Json(body): Json<ClientErrorReport>,
) -> ApiResult<Json<MutationAck>> {
    insert_error(
        &st.db,
        NewError {
            username: Some(&identity.username),
            source: "client",
            method: None,
            path: body.path.as_deref(),
            status: None,
            code: body.code.as_deref(),
            message: &body.message,
            detail: body.detail,
        },
    )
    .await?;
    Ok(Json(MutationAck::ok(None)))
}
