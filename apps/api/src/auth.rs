//! Authentication: argon2id password hashing + stateless JWT session cookies.
//!
//! Flow:
//!   * `POST /api/auth/login` verifies the password against the stored argon2
//!     hash and, on success, sets an HttpOnly `session` cookie holding a signed
//!     HS256 JWT (12h TTL).
//!   * `require_auth` middleware fronts every protected route: it reads the
//!     `session` cookie, verifies the JWT against `SESSION_SECRET`, and injects
//!     an `Identity` into the request extensions (extractable by handlers for
//!     audit attribution). Missing/invalid → 401.
//!
//! The secret is process-wide and injected via `from_fn_with_state`. Tokens are
//! stateless (no server-side session store): logout just clears the cookie, and
//! rotating `SESSION_SECRET` invalidates every outstanding token.

use std::sync::Arc;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use axum::{
    body::Body,
    extract::{FromRequestParts, State},
    http::{header, request::Parts, Request, StatusCode},
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{
    decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation,
};
use serde::{Deserialize, Serialize};

use crate::error::ApiError;

/// Name of the session cookie.
pub const SESSION_COOKIE: &str = "session";
/// Token lifetime: 12 hours.
const TOKEN_TTL_SECS: i64 = 60 * 60 * 12;

/// Process-wide signing secret, shared with the auth middleware.
pub type SecretKey = Arc<Vec<u8>>;

/// Authenticated identity, injected into request extensions by `require_auth`.
#[derive(Clone, Debug)]
pub struct Identity {
    pub username: String,
    pub role: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String,
    role: String,
    iat: i64,
    exp: i64,
}

/// Hash a plaintext password to an argon2id PHC string.
pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("password hash failed: {e}"))?
        .to_string())
}

/// Constant-time-ish verification of a password against a stored PHC hash.
pub fn verify_password(password: &str, phc: &str) -> bool {
    match PasswordHash::new(phc) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Mint a signed session token for `username`/`role`. `now` is a unix timestamp.
pub fn issue_token(
    secret: &[u8],
    username: &str,
    role: &str,
    now: i64,
) -> anyhow::Result<String> {
    let claims = Claims {
        sub: username.to_string(),
        role: role.to_string(),
        iat: now,
        exp: now + TOKEN_TTL_SECS,
    };
    Ok(encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )?)
}

fn verify_token(secret: &[u8], token: &str) -> Option<Identity> {
    let validation = Validation::new(Algorithm::HS256);
    decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation)
        .ok()
        .map(|d| Identity {
            username: d.claims.sub,
            role: d.claims.role,
        })
}

/// Pull a named cookie value out of the request's `Cookie` header.
fn cookie_value(req: &Request<Body>, name: &str) -> Option<String> {
    let raw = req.headers().get(header::COOKIE)?.to_str().ok()?;
    raw.split(';').find_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        (k == name).then(|| v.to_string())
    })
}

/// `Set-Cookie` value that installs the session token.
pub fn session_cookie(token: &str) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={TOKEN_TTL_SECS}"
    )
}

/// `Set-Cookie` value that clears the session (logout).
pub fn clear_cookie() -> String {
    format!("{SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0")
}

/// Middleware: require a valid session cookie; inject `Identity`. State is the
/// signing secret (provided via `from_fn_with_state`).
///
/// Pure authentication: verifies the JWT and injects the authenticated `Identity`
/// into request extensions. Authorization is handled by fine-grained middleware
/// in perms.rs (e.g., `enforce_permissions`).
pub async fn require_auth(
    State(secret): State<SecretKey>,
    mut req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = cookie_value(&req, SESSION_COOKIE).ok_or(StatusCode::UNAUTHORIZED)?;
    let identity = verify_token(&secret, &token).ok_or(StatusCode::UNAUTHORIZED)?;
    req.extensions_mut().insert(identity);
    Ok(next.run(req).await)
}

/// Handler extractor: the authenticated `Identity` placed in extensions by
/// `require_auth`. Only usable on routes behind that middleware.
#[axum::async_trait]
impl<S> FromRequestParts<S> for Identity
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<Identity>()
            .cloned()
            .ok_or_else(|| ApiError::Forbidden("unauthenticated".into()))
    }
}

/// Handler extractor that additionally requires the `admin` role. Used by the
/// user-management routes, where even reads are admin-only.
pub struct AdminIdentity(pub Identity);

#[axum::async_trait]
impl<S> FromRequestParts<S> for AdminIdentity
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let identity = Identity::from_request_parts(parts, state).await?;
        if identity.role != "admin" && identity.role != "super_admin" {
            return Err(ApiError::Forbidden("admin or super_admin role required".into()));
        }
        Ok(AdminIdentity(identity))
    }
}
