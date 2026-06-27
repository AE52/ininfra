//! Authentication endpoints.
//!
//!   POST /api/auth/login   body {username,password} -> sets `session` cookie
//!   POST /api/auth/logout  clears the `session` cookie
//!   GET  /api/auth/me       (protected) -> current identity
//!
//! `login`/`logout` are mounted on the PUBLIC router (no auth gate); `me` is
//! mounted behind `require_auth` in `routes::router`.

use axum::{
    extract::State,
    http::header,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::auth::{self, Identity};
use crate::db;
use crate::error::{ApiError, ApiResult};
use crate::AppState;

/// Public auth routes (login + logout). `me` is wired separately (protected).
pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    username: String,
    password: String,
}

async fn login(
    State(st): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> ApiResult<Response> {
    // Uniform error for both "no such user" and "wrong password" to avoid
    // username enumeration.
    let invalid = || ApiError::Forbidden("invalid credentials".into());

    let user = db::get_user(&st.db, &req.username)
        .await?
        .ok_or_else(invalid)?;

    if !auth::verify_password(&req.password, &user.password_hash) {
        return Err(invalid());
    }

    let now = chrono::Utc::now().timestamp();
    let token = auth::issue_token(&st.session_secret, &user.username, &user.role, now)
        .map_err(ApiError::Internal)?;
    let _ = db::touch_last_login(&st.db, &user.username).await;

    let mut resp =
        Json(json!({ "username": user.username, "role": user.role })).into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        auth::session_cookie(&token)
            .parse()
            .expect("cookie header is valid ascii"),
    );
    Ok(resp)
}

async fn logout() -> Response {
    let mut resp = Json(json!({ "ok": true })).into_response();
    resp.headers_mut().insert(
        header::SET_COOKIE,
        auth::clear_cookie()
            .parse()
            .expect("cookie header is valid ascii"),
    );
    resp
}

/// `GET /api/auth/me` — echo the authenticated identity. Mounted behind auth.
pub async fn me(identity: Identity) -> Json<serde_json::Value> {
    Json(json!({ "username": identity.username, "role": identity.role }))
}
