//! RBAC management (super_admin only).
//!
//!   GET   /api/rbac/permissions -> Vec<RbacMatrixRow>
//!   PATCH /api/rbac/permissions -> MutationAck
//!
//! Both routes require the `super_admin` role. The `AdminIdentity` extractor
//! lets admin OR super_admin past the gate, so each handler additionally
//! rejects a plain admin with 403 — RBAC management is super_admin-only.
//!
//! Two invariants preserve the no-lockout guarantee:
//!   * The `super_admin` role is never overridable (PATCH rejects it with 400).
//!   * super_admin is always all-true with no overrides in the matrix view.

use std::collections::HashMap;

use axum::{extract::State, routing::get, Json, Router};

use crate::auth::AdminIdentity;
use crate::db::{self, NewAudit};
use crate::dto::{AuditAction, MutationAck, RbacCell, RbacMatrixRow, RbacPatch};
use crate::error::{ApiError, ApiResult};
use crate::perms::{default_allowed, find, PERMS};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/api/rbac/permissions",
        get(list_permissions).patch(patch_permission),
    )
}

/// Reject any caller that is not specifically a `super_admin`. The
/// `AdminIdentity` extractor already passed (admin or super_admin), so a plain
/// admin reaches here and must be turned away with 403.
fn require_super_admin(actor: &crate::auth::Identity) -> ApiResult<()> {
    if actor.role != "super_admin" {
        return Err(ApiError::Forbidden(
            "RBAC management requires the super_admin role".into(),
        ));
    }
    Ok(())
}

async fn list_permissions(
    AdminIdentity(actor): AdminIdentity,
    State(st): State<AppState>,
) -> ApiResult<Json<Vec<RbacMatrixRow>>> {
    require_super_admin(&actor)?;

    let overrides = db::list_permission_overrides(&st.db).await?;

    // (role, key) -> stored override value.
    let mut override_map: HashMap<(String, String), bool> = HashMap::new();
    for (role, key, allowed) in overrides {
        override_map.insert((role, key), allowed);
    }

    let rows: Vec<RbacMatrixRow> = PERMS
        .iter()
        .map(|p| {
            let cell = |role: &str| {
                let ov = override_map
                    .get(&(role.to_string(), p.key.to_string()))
                    .copied();
                let effective = ov.unwrap_or_else(|| default_allowed(role, p.key, p.mutating));
                RbacCell {
                    effective,
                    override_val: ov,
                }
            };
            RbacMatrixRow {
                key: p.key.to_string(),
                category: p.category.to_string(),
                label: p.label.to_string(),
                mutating: p.mutating,
                developer: cell("developer"),
                admin: cell("admin"),
                // super_admin is non-overridable: always effective, never an override.
                super_admin: RbacCell {
                    effective: true,
                    override_val: None,
                },
            }
        })
        .collect();

    Ok(Json(rows))
}

async fn patch_permission(
    AdminIdentity(actor): AdminIdentity,
    State(st): State<AppState>,
    Json(body): Json<RbacPatch>,
) -> ApiResult<Json<MutationAck>> {
    require_super_admin(&actor)?;

    // super_admin permissions can never be overridden (no-lockout guarantee).
    if body.role == "super_admin" {
        return Err(ApiError::BadRequest(
            "super_admin permissions cannot be overridden".into(),
        ));
    }
    // Only developer/admin overrides are editable.
    if body.role != "developer" && body.role != "admin" {
        return Err(ApiError::BadRequest(format!(
            "invalid role '{}'; expected developer or admin",
            body.role
        )));
    }
    // The permission key must exist in the registry.
    if find(&body.key).is_none() {
        return Err(ApiError::BadRequest(format!(
            "unknown permission key '{}'",
            body.key
        )));
    }

    match body.allowed {
        Some(v) => {
            db::upsert_permission_override(&st.db, &body.role, &body.key, v, &actor.username)
                .await?;
        }
        None => {
            db::delete_permission_override(&st.db, &body.role, &body.key).await?;
        }
    }

    let audit_id = db::insert_audit(
        &st.db,
        NewAudit {
            actor: &actor.username,
            action: AuditAction::EditRbac,
            target_ns: None,
            target_kind: Some("Rbac"),
            target_name: Some(&body.role),
            detail: serde_json::json!({
                "role": body.role,
                "key": body.key,
                "allowed": body.allowed,
            }),
        },
    )
    .await?;

    Ok(Json(MutationAck::ok(Some(audit_id))))
}
