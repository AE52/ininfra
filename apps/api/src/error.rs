//! Error type and the wire error envelope.
//!
//! `ApiError` is the single error type returned by all handlers. It serializes
//! to the `ApiError` shape defined in `@ininfra/shared-types`:
//! `{ "error": { "code": string, "message": string, "details": object|null } }`.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::{json, Value};

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("kubernetes error: {0}")]
    Kube(#[from] kube::Error),

    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("upstream error: {0}")]
    Upstream(String),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    fn parts(&self) -> (StatusCode, &'static str) {
        match self {
            ApiError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            ApiError::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            ApiError::Kube(_) => (StatusCode::BAD_GATEWAY, "kube_error"),
            ApiError::Db(_) => (StatusCode::INTERNAL_SERVER_ERROR, "db_error"),
            ApiError::Upstream(_) => (StatusCode::BAD_GATEWAY, "upstream_error"),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.parts();
        let details: Value = Value::Null;
        if status.is_server_error() {
            tracing::error!(error = %self, code, "request failed");
        } else {
            tracing::warn!(error = %self, code, "request rejected");
        }
        let body = json!({
            "error": {
                "code": code,
                "message": self.to_string(),
                "details": details,
            }
        });
        (status, Json(body)).into_response()
    }
}

/// Convenient result alias for handlers.
pub type ApiResult<T> = Result<T, ApiError>;
