//! Per-endpoint RBAC: permission registry, path→key resolver, code defaults,
//! and the enforce_permissions axum middleware.
//!
//! Enforcement model (outermost → innermost on request):
//!   require_auth → capture_errors → enforce_permissions → handler
//!
//! super_admin is NEVER denied. On DB errors, fall back to default_allowed.

use axum::{
    body::Body,
    extract::State,
    http::{Method, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::auth::Identity;
use crate::error::ApiError;
use crate::AppState;

// ─────────────────────────────────────────────────────────────────────────────
// Permission registry
// ─────────────────────────────────────────────────────────────────────────────

/// One permission entry in the static registry.
pub struct Perm {
    pub key: &'static str,
    pub category: &'static str,
    pub label: &'static str,
    pub mutating: bool,
}

/// The canonical permission registry. Every protected route must resolve to
/// one of these keys via `resolve()`.
pub static PERMS: &[Perm] = &[
    // ── Reads ──────────────────────────────────────────────────────────────
    Perm { key: "services.read",      category: "workloads",       label: "View services",          mutating: false },
    Perm { key: "pods.read",          category: "workloads",       label: "View pods",              mutating: false },
    Perm { key: "logs.read",          category: "workloads",       label: "View logs",              mutating: false },
    Perm { key: "env.read",           category: "workloads",       label: "View env",               mutating: false },
    Perm { key: "nodes.read",         category: "infrastructure",  label: "View nodes",             mutating: false },
    Perm { key: "rightsizing.read",   category: "infrastructure",  label: "View right-sizing",      mutating: false },
    Perm { key: "events.read",        category: "infrastructure",  label: "View events",            mutating: false },
    Perm { key: "audit.read",         category: "administration",  label: "View audit log",         mutating: false },
    Perm { key: "builds.read",        category: "ci_cd",           label: "View builds",            mutating: false },
    Perm { key: "gateway.read",       category: "infrastructure",  label: "View gateway",           mutating: false },
    Perm { key: "hpa.read",           category: "workloads",       label: "View HPA",               mutating: false },
    Perm { key: "statefulsets.read",  category: "workloads",       label: "View statefulsets",      mutating: false },
    Perm { key: "cronjobs.read",      category: "workloads",       label: "View cronjobs",          mutating: false },
    Perm { key: "jobs.read",          category: "workloads",       label: "View jobs",              mutating: false },
    Perm { key: "pvc.read",           category: "storage",         label: "View PVCs",              mutating: false },
    Perm { key: "secrets.read",       category: "storage",         label: "View secrets health",    mutating: false },
    Perm { key: "branches.read",      category: "ci_cd",           label: "View branches",          mutating: false },
    Perm { key: "status.read",        category: "infrastructure",  label: "View status",            mutating: false },
    Perm { key: "errors.read",        category: "administration",  label: "View errors",            mutating: false },
    Perm { key: "users.read",         category: "administration",  label: "View users",             mutating: false },
    // ── Mutations ──────────────────────────────────────────────────────────
    Perm { key: "deployments.scale",     category: "workloads",      label: "Scale deployments",      mutating: true },
    Perm { key: "deployments.restart",   category: "workloads",      label: "Restart deployments",    mutating: true },
    Perm { key: "env.edit",              category: "workloads",      label: "Edit env",               mutating: true },
    Perm { key: "pods.delete",           category: "workloads",      label: "Delete pods",            mutating: true },
    Perm { key: "builds.trigger",        category: "ci_cd",          label: "Trigger builds",         mutating: true },
    Perm { key: "branches.edit",         category: "ci_cd",          label: "Edit branches",          mutating: true },
    Perm { key: "hpa.edit",              category: "workloads",      label: "Edit HPA",               mutating: true },
    Perm { key: "statefulsets.scale",    category: "workloads",      label: "Scale statefulsets",     mutating: true },
    Perm { key: "statefulsets.restart",  category: "workloads",      label: "Restart statefulsets",   mutating: true },
    Perm { key: "cronjobs.suspend",      category: "workloads",      label: "Suspend/resume cronjobs", mutating: true },
    Perm { key: "cronjobs.trigger",      category: "workloads",      label: "Trigger cronjobs now",   mutating: true },
    Perm { key: "gateway.edit",          category: "infrastructure", label: "Edit gateway config",    mutating: true },
    Perm { key: "gateway.restart",       category: "infrastructure", label: "Restart gateway",        mutating: true },
    Perm { key: "pvc.write",             category: "storage",        label: "Write/delete PVC files", mutating: true },
    Perm { key: "nodes.cordon",          category: "infrastructure", label: "Cordon/uncordon nodes",  mutating: true },
    Perm { key: "users.manage",          category: "administration", label: "Manage users",           mutating: true },
    Perm { key: "rbac.manage",           category: "administration", label: "Manage RBAC",            mutating: true },
];

/// Look up a `Perm` by its key.
pub fn find(key: &str) -> Option<&'static Perm> {
    PERMS.iter().find(|p| p.key == key)
}

// ─────────────────────────────────────────────────────────────────────────────
// Path → permission key resolver
// ─────────────────────────────────────────────────────────────────────────────

/// Map a live HTTP request to its permission key.
/// Returns `None` for unrecognised paths (callers treat GET→allow, mutating→deny).
pub fn resolve(method: &Method, path: &str) -> Option<&'static str> {
    // Strip query string
    let path = path.split('?').next().unwrap_or(path);
    // Normalise to segments
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Match by first segment(s) then method.
    match segs.as_slice() {
        // ── services ───────────────────────────────────────────────────────
        ["api", "services", ..] => Some("services.read"),

        // ── deployments ────────────────────────────────────────────────────
        ["api", "deployments", _ns, _name, "scale"] if *method == Method::PATCH
            => Some("deployments.scale"),
        ["api", "deployments", _ns, _name, "restart"] if *method == Method::POST
            => Some("deployments.restart"),
        ["api", "deployments", ..] => Some("services.read"),

        // ── env ────────────────────────────────────────────────────────────
        ["api", "env", _ns, _workload] if *method == Method::PATCH
            => Some("env.edit"),
        ["api", "env", ..] => Some("env.read"),

        // ── pods ───────────────────────────────────────────────────────────
        ["api", "pods", _ns, _name] if *method == Method::DELETE
            => Some("pods.delete"),
        ["api", "pods", ..] => Some("pods.read"),

        // ── logs ───────────────────────────────────────────────────────────
        ["api", "logs", ..] => Some("logs.read"),

        // ── builds ─────────────────────────────────────────────────────────
        ["api", "builds"] if *method == Method::POST => Some("builds.trigger"),
        ["api", "builds", ..] => Some("builds.read"),

        // ── nodes ──────────────────────────────────────────────────────────
        ["api", "nodes", _name, "cordon"] if *method == Method::POST
            => Some("nodes.cordon"),
        ["api", "nodes", ..] => Some("nodes.read"),

        // ── right-sizing (read-only advisory) ────────────────────────────────
        ["api", "rightsizing", ..] => Some("rightsizing.read"),

        // ── audit ──────────────────────────────────────────────────────────
        ["api", "audit", ..] => Some("audit.read"),

        // ── build-config / branches ────────────────────────────────────────
        ["api", "build-config", _ns, _service] if *method == Method::PATCH
            => Some("branches.edit"),
        ["api", "build-config", ..] => Some("branches.read"),

        // ── HPA ────────────────────────────────────────────────────────────
        ["api", "hpa", _ns, _name] if *method == Method::PATCH => Some("hpa.edit"),
        ["api", "hpa", ..] => Some("hpa.read"),

        // ── statefulsets ───────────────────────────────────────────────────
        ["api", "statefulsets", _ns, _name, "scale"] if *method == Method::PATCH
            => Some("statefulsets.scale"),
        ["api", "statefulsets", _ns, _name, "restart"] if *method == Method::POST
            => Some("statefulsets.restart"),
        ["api", "statefulsets", ..] => Some("statefulsets.read"),

        // ── cronjobs ───────────────────────────────────────────────────────
        ["api", "cronjobs", _ns, _name, "suspend"] if *method == Method::PATCH
            => Some("cronjobs.suspend"),
        ["api", "cronjobs", _ns, _name, "trigger"] if *method == Method::POST
            => Some("cronjobs.trigger"),
        ["api", "cronjobs", ..] => Some("cronjobs.read"),

        // ── jobs ───────────────────────────────────────────────────────────
        ["api", "jobs", ..] => Some("jobs.read"),

        // ── events ─────────────────────────────────────────────────────────
        ["api", "events", ..] => Some("events.read"),

        // ── PVC ────────────────────────────────────────────────────────────
        ["api", "pvc", _ns, _name, "file"] if matches!(method, &Method::PUT | &Method::DELETE)
            => Some("pvc.write"), // writing/deleting files on a persistent volume is a mutation
        ["api", "pvc", ..] => Some("pvc.read"),

        // ── secrets health (read-only TLS cert metadata; never values) ───────
        ["api", "secrets", ..] => Some("secrets.read"),

        // ── users ──────────────────────────────────────────────────────────
        ["api", "users"] | ["api", "users", _] => {
            if *method == Method::GET {
                Some("users.read")
            } else {
                Some("users.manage")
            }
        }

        // ── deploy ─────────────────────────────────────────────────────────
        ["api", "deploy", _ns, _name, "build"] if *method == Method::POST
            => Some("builds.trigger"),
        ["api", "deploy", _ns, _name, "rollback"] if *method == Method::POST
            => Some("deployments.restart"), // rollback = a restart-class mutation
        ["api", "deploy", _ns, _name, "images", _] if *method == Method::DELETE
            => Some("deployments.restart"), // image delete: same gate as restart
        ["api", "deploy", ..] => Some("services.read"),

        // ── status ─────────────────────────────────────────────────────────
        ["api", "status", ..] => Some("status.read"),

        // ── gateway ────────────────────────────────────────────────────────
        ["api", "gateway", "config"] if *method == Method::PATCH => Some("gateway.edit"),
        ["api", "gateway", "restart"] if *method == Method::POST => Some("gateway.restart"),
        ["api", "gateway", ..] => Some("gateway.read"),

        // ── search ─────────────────────────────────────────────────────────
        ["api", "search", ..] => Some("services.read"),

        // ── manifest (read-only raw YAML) ───────────────────────────────────
        ["api", "manifest", ..] => Some("services.read"),

        // ── describe (read-only events + status summary) ────────────────────
        ["api", "describe", ..] => Some("services.read"),

        // ── RBAC ───────────────────────────────────────────────────────────
        ["api", "rbac", ..] => Some("rbac.manage"),

        // ── auth / favorites / errors / config ─────────────────────────────
        // These are exempted in enforce_permissions; resolver returns None
        // so the exemption check fires first.
        _ => None,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Code-default permission matrix
// ─────────────────────────────────────────────────────────────────────────────

/// Return the code-default allowed value for a (role, permission key, mutating) triple.
/// This is the fail-safe baseline; DB overrides layer on top.
pub fn default_allowed(role: &str, key: &str, mutating: bool) -> bool {
    // Admin-class-only reads: gated by the `AdminIdentity` extractor at the
    // handler (audit + error feeds), so the matrix must mirror that — these are
    // never allowed for developer/unknown roles even though they are non-mutating.
    const ADMIN_ONLY_READS: &[&str] = &["audit.read"];

    match role {
        "super_admin" => true,
        "admin" => {
            if !mutating {
                true
            } else {
                // admin may do everything mutating EXCEPT manage RBAC
                key != "rbac.manage"
            }
        }
        "developer" => {
            if ADMIN_ONLY_READS.contains(&key) {
                false
            } else if !mutating {
                true
            } else {
                // developer may only do these specific mutations by default
                matches!(
                    key,
                    "deployments.scale"
                        | "deployments.restart"
                        | "builds.trigger"
                        | "branches.edit"
                        | "cronjobs.suspend"
                        | "cronjobs.trigger"
                )
            }
        }
        // Unknown role: reads only, no mutations, minus the admin-only reads.
        _ => !mutating && !ADMIN_ONLY_READS.contains(&key),
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enforcement middleware
// ─────────────────────────────────────────────────────────────────────────────

/// Paths that any authenticated user may access without a perm check.
fn is_exempt(method: &Method, path: &str) -> bool {
    let path = path.split('?').next().unwrap_or(path);
    // Auth + logout + client error reporting + favorites + config
    if path == "/api/auth/me"
        || path == "/api/auth/logout"
        || path == "/api/config"
        || path.starts_with("/api/favorites")
    {
        return true;
    }
    // POST /api/errors — client-side error reporting (was writer_exempt)
    if method == Method::POST && path == "/api/errors" {
        return true;
    }
    // Any non-mutating auth/* route
    if path.starts_with("/api/auth/") && !is_mutating(method) {
        return true;
    }
    false
}

fn is_mutating(method: &Method) -> bool {
    matches!(*method, Method::POST | Method::PUT | Method::PATCH | Method::DELETE)
}

/// Axum middleware: enforce per-endpoint RBAC.
///
/// Layer order (request direction: outer → inner):
///   require_auth → capture_errors → enforce_permissions → handler
///
/// require_auth runs FIRST (outermost) and injects Identity. By the time
/// enforce_permissions runs, Identity is always present.
pub async fn enforce_permissions(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let identity = match req.extensions().get::<Identity>().cloned() {
        Some(id) => id,
        None => return Err(StatusCode::UNAUTHORIZED),
    };

    // super_admin is never locked out.
    if identity.role == "super_admin" {
        return Ok(next.run(req).await);
    }

    let method = req.method().clone();
    let path = req.uri().path().to_string();

    // Exempt routes bypass the perm check entirely.
    if is_exempt(&method, &path) {
        return Ok(next.run(req).await);
    }

    let mutating = is_mutating(&method);

    // Resolve to a permission key.
    let key = match resolve(&method, &path) {
        Some(k) => k,
        None => {
            if !mutating {
                // Unknown GET path → allow (safe default).
                return Ok(next.run(req).await);
            } else {
                // Unknown mutating path → warn + deny for non-super_admin.
                tracing::warn!(
                    method = %method,
                    path = %path,
                    role = %identity.role,
                    "enforce_permissions: unmatched mutating path — denying"
                );
                return Err(StatusCode::FORBIDDEN);
            }
        }
    };

    // Try DB override; on error fall back to code default (fail-safe).
    let effective = match crate::db::get_permission_override(&state.db, &identity.role, key).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            let perm = find(key);
            let m = perm.map(|p| p.mutating).unwrap_or(mutating);
            default_allowed(&identity.role, key, m)
        }
        Err(e) => {
            tracing::error!(
                error = %e,
                role = %identity.role,
                key,
                "enforce_permissions: DB lookup failed, falling back to code default"
            );
            let perm = find(key);
            let m = perm.map(|p| p.mutating).unwrap_or(mutating);
            default_allowed(&identity.role, key, m)
        }
    };

    if effective {
        Ok(next.run(req).await)
    } else {
        // Return a proper ApiError 403 response so capture_errors logs it.
        let err = ApiError::Forbidden(format!("permission denied: {key}"));
        Ok(err.into_response())
    }
}
