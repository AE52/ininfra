//! Per-user favorites.
//!
//!   GET    /api/favorites                      -> Favorite[]   (current user)
//!   POST   /api/favorites    body NewFavorite  -> Favorite     (idempotent)
//!   DELETE /api/favorites?kind=&namespace=&name= -> MutationAck
//!
//! Allowed for ANY authenticated user (viewers too) — the writer gate exempts
//! `/api/favorites`, since a user managing their own bookmarks is not a
//! cluster mutation.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::auth::Identity;
use crate::db;
use crate::dto::{Favorite, MutationAck, NewFavorite};
use crate::error::ApiResult;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/favorites", get(list).post(add).delete(remove))
}

async fn list(
    identity: Identity,
    State(st): State<AppState>,
) -> ApiResult<Json<Vec<Favorite>>> {
    Ok(Json(db::list_favorites(&st.db, &identity.username).await?))
}

async fn add(
    identity: Identity,
    State(st): State<AppState>,
    Json(body): Json<NewFavorite>,
) -> ApiResult<Json<Favorite>> {
    Ok(Json(db::add_favorite(&st.db, &identity.username, &body).await?))
}

#[derive(Debug, Deserialize)]
struct DelQuery {
    kind: String,
    #[serde(default)]
    namespace: String,
    name: String,
}

async fn remove(
    identity: Identity,
    State(st): State<AppState>,
    Query(q): Query<DelQuery>,
) -> ApiResult<Json<MutationAck>> {
    db::remove_favorite(&st.db, &identity.username, &q.kind, &q.namespace, &q.name).await?;
    Ok(Json(MutationAck::ok(None)))
}
