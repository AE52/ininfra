//! Console user management (admin only).
//!
//!   GET    /api/users?cursor=&limit=   -> Page<User>
//!   POST   /api/users                  body NewUserRequest  -> User
//!   PATCH  /api/users/:id              body UpdateUserRequest -> User
//!   DELETE /api/users/:id              -> MutationAck
//!
//! Every route requires a privileged role — `admin` or `super_admin`
//! (enforced by the `AdminIdentity` extractor — even reads). Mutations are
//! audited. Safety guards prevent lock-out and privilege escalation: you
//! cannot delete your own account, you cannot remove or demote the last
//! remaining privileged account, and only a `super_admin` may create, modify,
//! or delete a `super_admin` account.

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::auth::{self, AdminIdentity};
use crate::db::{self, NewAudit};
use crate::dto::{AuditAction, MutationAck, NewUserRequest, Page, UpdateUserRequest, User};
use crate::error::{ApiError, ApiResult};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/users", get(list).post(create))
        .route("/api/users/:id", axum::routing::patch(update).delete(remove))
}

#[derive(Debug, Deserialize)]
struct PageQuery {
    cursor: Option<String>,
    limit: Option<i64>,
}

const VALID_ROLES: [&str; 3] = ["developer", "admin", "super_admin"];

fn validate_role(role: &str) -> ApiResult<()> {
    if VALID_ROLES.contains(&role) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(format!(
            "invalid role '{role}'; expected one of developer, admin, super_admin"
        )))
    }
}

fn validate_password(pw: &str) -> ApiResult<()> {
    if pw.len() < 8 {
        Err(ApiError::BadRequest("password must be at least 8 characters".into()))
    } else {
        Ok(())
    }
}

fn parse_id(id: &str) -> ApiResult<uuid::Uuid> {
    uuid::Uuid::parse_str(id).map_err(|_| ApiError::BadRequest("malformed user id".into()))
}

async fn list(
    _admin: AdminIdentity,
    State(st): State<AppState>,
    Query(q): Query<PageQuery>,
) -> ApiResult<Json<Page<User>>> {
    let page = db::list_users(&st.db, q.cursor.as_deref(), q.limit.unwrap_or(50)).await?;
    Ok(Json(page))
}

async fn create(
    AdminIdentity(actor): AdminIdentity,
    State(st): State<AppState>,
    Json(body): Json<NewUserRequest>,
) -> ApiResult<Json<User>> {
    let username = body.username.trim();
    if username.is_empty() {
        return Err(ApiError::BadRequest("username is required".into()));
    }
    validate_role(&body.role)?;
    // Only super_admin may create a super_admin account.
    if body.role == "super_admin" && actor.role != "super_admin" {
        return Err(ApiError::Forbidden(
            "only super_admin can create super_admin accounts".into(),
        ));
    }
    validate_password(&body.password)?;

    let hash = auth::hash_password(&body.password).map_err(ApiError::Internal)?;
    let user = db::create_user(&st.db, username, &hash, &body.role).await?;

    insert_user_audit(&st, &actor.username, AuditAction::CreateUser, &user, None).await?;
    Ok(Json(user))
}

async fn update(
    AdminIdentity(actor): AdminIdentity,
    State(st): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateUserRequest>,
) -> ApiResult<Json<User>> {
    let id = parse_id(&id)?;
    let target = db::get_user_by_id(&st.db, &id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("user {id}")))?;

    // A plain admin must not touch a super_admin account at all — not even a
    // password reset (which would otherwise be a privilege-escalation path:
    // reset the super_admin's password, then log in as super_admin).
    if target.role == "super_admin" && actor.role != "super_admin" {
        return Err(ApiError::Forbidden(
            "only super_admin can modify a super_admin account".into(),
        ));
    }

    if let Some(role) = &body.role {
        validate_role(role)?;
        // Only super_admin can assign the super_admin role.
        if role == "super_admin" && actor.role != "super_admin" {
            return Err(ApiError::Forbidden(
                "only super_admin can manage super_admin accounts".into(),
            ));
        }
        // Don't demote the last privileged account (admin or super_admin).
        let is_downgrade = (target.role == "admin" || target.role == "super_admin")
            && role == "developer";
        if is_downgrade && db::count_privileged(&st.db).await? <= 1 {
            return Err(ApiError::Conflict(
                "cannot demote the last remaining privileged account".into(),
            ));
        }
    }
    let new_hash = match &body.password {
        Some(pw) => {
            validate_password(pw)?;
            Some(auth::hash_password(pw).map_err(ApiError::Internal)?)
        }
        None => None,
    };

    let user = db::update_user(&st.db, &id, body.role.as_deref(), new_hash.as_deref())
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("user {id}")))?;

    let changed = serde_json::json!({
        "roleChanged": body.role.is_some(),
        "passwordReset": body.password.is_some(),
    });
    insert_user_audit(&st, &actor.username, AuditAction::UpdateUser, &user, Some(changed)).await?;
    Ok(Json(user))
}

async fn remove(
    AdminIdentity(actor): AdminIdentity,
    State(st): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<MutationAck>> {
    let id = parse_id(&id)?;
    let target = db::get_user_by_id(&st.db, &id)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("user {id}")))?;

    if target.username.eq_ignore_ascii_case(&actor.username) {
        return Err(ApiError::Conflict("you cannot delete your own account".into()));
    }
    // Only super_admin may delete a super_admin account.
    if target.role == "super_admin" && actor.role != "super_admin" {
        return Err(ApiError::Forbidden(
            "only super_admin can delete super_admin accounts".into(),
        ));
    }
    if (target.role == "admin" || target.role == "super_admin")
        && db::count_privileged(&st.db).await? <= 1
    {
        return Err(ApiError::Conflict(
            "cannot delete the last remaining privileged account".into(),
        ));
    }

    db::delete_user(&st.db, &id).await?;
    let audit_id = insert_user_audit(&st, &actor.username, AuditAction::DeleteUser, &target, None).await?;
    Ok(Json(MutationAck::ok(Some(audit_id))))
}

/// Shared audit write for user mutations. Never records passwords.
async fn insert_user_audit(
    st: &AppState,
    actor: &str,
    action: AuditAction,
    user: &User,
    extra: Option<serde_json::Value>,
) -> ApiResult<String> {
    let mut detail = serde_json::json!({ "username": user.username, "role": user.role });
    if let (Some(obj), Some(extra)) = (detail.as_object_mut(), extra) {
        if let Some(extra_obj) = extra.as_object() {
            for (k, v) in extra_obj {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    db::insert_audit(
        &st.db,
        NewAudit {
            actor,
            action,
            target_ns: None,
            target_kind: Some("User"),
            target_name: Some(&user.username),
            detail,
        },
    )
    .await
}
