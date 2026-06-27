//! Secrets health — read-only TLS certificate expiry scanner.
//!
//!   GET /api/secrets/health?ns=<optional>
//!
//! Lists every `kubernetes.io/tls` Secret across the managed namespaces (or one
//! namespace when `ns` is given), parses the leaf certificate out of each
//! Secret's `tls.crt`, and reports subject CN / issuer / validity window /
//! days-remaining, sorted soonest-to-expire (and already-expired) first.
//!
//! SECURITY: this endpoint NEVER returns secret values. The private key
//! (`tls.key`) is not read at all, and no raw certificate bytes are placed on
//! the wire — only the parsed, non-sensitive metadata fields of `CertHealth`.
//! A Secret whose `tls.crt` is missing or unparseable still yields a row (with
//! `parseError` set) rather than failing the whole request, so one broken
//! secret can't hide the health of the rest.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::core::v1::Secret;
use kube::api::ListParams;
use kube::Api;
use serde::Deserialize;
use x509_parser::prelude::*;

use crate::dto::{CertHealth, Timestamp};
use crate::error::ApiResult;
use crate::k8s::{managed_namespaces, require_namespace};
use crate::AppState;

/// k8s built-in type for a TLS keypair Secret.
const TLS_SECRET_TYPE: &str = "kubernetes.io/tls";

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/secrets/health", get(secrets_health))
}

#[derive(Debug, Deserialize)]
struct NsQuery {
    ns: Option<String>,
}

async fn secrets_health(
    State(st): State<AppState>,
    Query(q): Query<NsQuery>,
) -> ApiResult<Json<Vec<CertHealth>>> {
    // Resolve which namespaces to scan. An explicit `ns` is guarded against the
    // managed-namespace allowlist (403 if out of scope); otherwise scan all.
    let namespaces: Vec<String> = match q.ns.as_deref() {
        Some(ns) => {
            require_namespace(ns)?;
            vec![ns.to_string()]
        }
        None => managed_namespaces(),
    };

    // Only list TLS secrets; the apiserver supports a fieldSelector on `type`.
    let lp = ListParams::default().fields(&format!("type={TLS_SECRET_TYPE}"));

    let now = chrono::Utc::now();
    let mut out: Vec<CertHealth> = Vec::new();

    for ns in &namespaces {
        let api: Api<Secret> = Api::namespaced(st.kube.clone(), ns);
        // Degrade gracefully: a namespace we can't list (e.g. transient error)
        // contributes nothing rather than failing the whole scan.
        let list = match api.list(&lp).await {
            Ok(l) => l,
            Err(e) => {
                tracing::warn!(namespace = %ns, error = %e, "secrets/health: list failed");
                continue;
            }
        };
        for s in list.items {
            // Defensive: the fieldSelector already filters, but double-check the
            // type so we never inspect a non-TLS secret's data.
            if s.type_.as_deref() != Some(TLS_SECRET_TYPE) {
                continue;
            }
            let secret_name = s.metadata.name.clone().unwrap_or_default();
            out.push(analyze(ns, &secret_name, &s, now));
        }
    }

    // Soonest-to-expire first. Unparseable rows (no daysRemaining) sort last.
    out.sort_by(|a, b| match (a.days_remaining, b.days_remaining) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => a
            .namespace
            .cmp(&b.namespace)
            .then_with(|| a.secret_name.cmp(&b.secret_name)),
    });

    Ok(Json(out))
}

/// Build a `CertHealth` row from one TLS Secret. Reads ONLY the `tls.crt`
/// member (the certificate chain); the `tls.key` private key is never touched.
fn analyze(
    namespace: &str,
    secret_name: &str,
    s: &Secret,
    now: chrono::DateTime<chrono::Utc>,
) -> CertHealth {
    let err = |msg: String| CertHealth {
        namespace: namespace.to_string(),
        secret_name: secret_name.to_string(),
        common_name: None,
        issuer: None,
        not_before: None,
        not_after: None,
        days_remaining: None,
        expired: false,
        parse_error: Some(msg),
    };

    // The typed Secret model stores `.data` as already-decoded raw bytes
    // (`ByteString`), so `tls.crt` is the certificate PEM/DER bytes directly.
    let crt = match s.data.as_ref().and_then(|d| d.get("tls.crt")) {
        Some(b) => &b.0,
        None => return err("no tls.crt in secret".to_string()),
    };
    if crt.is_empty() {
        return err("tls.crt is empty".to_string());
    }

    // Parse the leaf certificate. `tls.crt` is normally a PEM bundle (one or
    // more `-----BEGIN CERTIFICATE-----` blocks); fall back to raw DER if the
    // bytes aren't PEM. We only inspect the FIRST certificate (the leaf), which
    // is the one whose expiry matters for the served endpoint.
    let der: Vec<u8> = if looks_like_pem(crt) {
        match x509_parser::pem::parse_x509_pem(crt) {
            Ok((_, pem)) => pem.contents,
            Err(e) => return err(format!("PEM parse error: {e}")),
        }
    } else {
        crt.to_vec()
    };

    let cert = match X509Certificate::from_der(&der) {
        Ok((_, c)) => c,
        Err(e) => return err(format!("X.509 parse error: {e}")),
    };

    let common_name = cert
        .subject()
        .iter_common_name()
        .next()
        .and_then(|cn| cn.as_str().ok())
        .map(|s| s.to_string());
    let issuer = Some(cert.issuer().to_string());

    let not_before = to_timestamp(cert.validity().not_before.timestamp());
    let not_after_ts = cert.validity().not_after.timestamp();
    let not_after = to_timestamp(not_after_ts);

    // Days until notAfter (negative once expired). Compute from the raw unix
    // seconds so it's independent of timezone/rounding of the rendered string.
    let secs_remaining = not_after_ts - now.timestamp();
    let days_remaining = secs_remaining.div_euclid(86_400);
    let expired = secs_remaining < 0;

    CertHealth {
        namespace: namespace.to_string(),
        secret_name: secret_name.to_string(),
        common_name,
        issuer,
        not_before,
        not_after,
        days_remaining: Some(days_remaining),
        expired,
        parse_error: None,
    }
}

/// Heuristic: does the byte slice start with a PEM armor header? (Tolerates
/// leading whitespace.) Lets us accept both PEM bundles and raw DER `tls.crt`.
fn looks_like_pem(bytes: &[u8]) -> bool {
    let start = bytes.iter().position(|b| !b.is_ascii_whitespace()).unwrap_or(0);
    bytes[start..].starts_with(b"-----BEGIN")
}

/// Convert a unix-seconds timestamp (from the cert validity, ASN.1 time) into
/// our RFC3339 `Timestamp`. `None` if the value is out of range (shouldn't
/// happen for real certs).
fn to_timestamp(unix_secs: i64) -> Option<Timestamp> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(unix_secs, 0)
}
