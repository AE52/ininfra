//! Error-capture middleware — records every failed response (HTTP >= 400) into
//! the `error_events` feed, attributed to the acting user. Best-effort and
//! non-blocking: capture never alters or delays the response the client gets.

use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::Request,
    middleware::Next,
    response::Response,
};

use crate::auth::Identity;
use crate::db::{insert_error, NewError};
use crate::AppState;

/// Error bodies are tiny JSON envelopes; cap the buffer defensively.
const MAX_ERR_BODY: usize = 64 * 1024;

pub async fn capture_errors(State(st): State<AppState>, req: Request<Body>, next: Next) -> Response {
    // `require_auth` (the outer layer) already injected the Identity.
    let username = req.extensions().get::<Identity>().map(|i| i.username.clone());
    let method = req.method().to_string();
    let path = req.uri().path().to_string();

    let res = next.run(req).await;
    if res.status().as_u16() < 400 {
        return res;
    }

    let status = res.status().as_u16();
    let (parts, body) = res.into_parts();
    let bytes = to_bytes(body, MAX_ERR_BODY).await.unwrap_or_default();
    let (code, message, detail) = parse_envelope(&bytes, status);

    // Fire-and-forget so capture never blocks the response.
    let pool = st.db.clone();
    tokio::spawn(async move {
        let _ = insert_error(
            &pool,
            NewError {
                username: username.as_deref(),
                source: "server",
                method: Some(&method),
                path: Some(&path),
                status: Some(status as i32),
                code: code.as_deref(),
                message: &message,
                detail,
            },
        )
        .await;
    });

    Response::from_parts(parts, Body::from(bytes))
}

/// Extract `{ error: { code, message, details } }`; fall back to the status text.
fn parse_envelope(bytes: &[u8], status: u16) -> (Option<String>, String, serde_json::Value) {
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(bytes) {
        if let Some(err) = v.get("error") {
            let code = err.get("code").and_then(|c| c.as_str()).map(String::from);
            let message = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("error")
                .to_string();
            let details = err.get("details").cloned().unwrap_or(serde_json::Value::Null);
            return (code, message, serde_json::json!({ "details": details }));
        }
    }
    // Not our `{error:{…}}` envelope (e.g. an axum extractor rejection like
    // "Failed to deserialize query string: …"). Surface the raw body as the
    // message/detail so the error feed isn't a bare "HTTP 400" with no reason.
    let body = String::from_utf8_lossy(bytes);
    let body = body.trim();
    if body.is_empty() {
        (None, format!("HTTP {status}"), serde_json::json!({}))
    } else {
        let message: String = body.chars().take(300).collect();
        let detail: String = body.chars().take(2000).collect();
        (None, message, serde_json::json!({ "body": detail }))
    }
}
