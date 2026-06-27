//! Per-object "describe" panel: status summary + recent Kubernetes events.
//!
//!   GET /api/describe/:kind/:ns/:name
//!
//! A read-only, `require_namespace`-gated view of one object that mirrors the
//! useful parts of `kubectl describe`:
//!
//!   * conditions — the object's `status.conditions` (type/status/reason/…).
//!   * containers — pods only: per-container ready / restartCount / current
//!     state + reason (CrashLoopBackOff, OOMKilled, …).
//!   * events     — that object's recent k8s events, pulled from the persisted
//!     Postgres event store (the same one that backs `GET /api/events/:ns`),
//!     filtered by involvedKind + involvedName, newest first.
//!
//! Supported kinds: deployment, statefulset, pod. Governed by the same
//! managed-namespace allowlist + read-permission gate as every other read.

use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};
use k8s_openapi::api::apps::v1::{Deployment as K8sDeployment, StatefulSet as K8sSts};
use k8s_openapi::api::core::v1::Pod as K8sPod;
use kube::Api;

use crate::conv::time;
use crate::db::{list_k8s_events, K8sEventFilter};
use crate::dto::{DescribeCondition, DescribeContainer, DescribeResponse};
use crate::error::{ApiError, ApiResult};
use crate::k8s::require_namespace;
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/describe/:kind/:ns/:name", get(describe))
}

/// Fetch one typed object or 404.
async fn get_obj<T>(kube: &kube::Client, ns: &str, name: &str, what: &str) -> ApiResult<T>
where
    T: kube::Resource<Scope = kube::core::NamespaceResourceScope>
        + Clone
        + std::fmt::Debug
        + serde::de::DeserializeOwned,
    <T as kube::Resource>::DynamicType: Default,
{
    let api: Api<T> = Api::namespaced(kube.clone(), ns);
    api.get_opt(name)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("{what} {ns}/{name}")))
}

/// k8s `metav1.Condition`-shaped tuple → our DTO. Deployment, StatefulSet and
/// Pod conditions all carry the same fields, so one mapper covers all three.
fn condition(
    type_: String,
    status: String,
    reason: Option<String>,
    message: Option<String>,
    last_transition: Option<chrono::DateTime<chrono::Utc>>,
) -> DescribeCondition {
    DescribeCondition {
        type_,
        status,
        reason,
        message,
        last_transition,
    }
}

fn deployment_conditions(d: &K8sDeployment) -> Vec<DescribeCondition> {
    d.status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .map(|c| {
                    condition(
                        c.type_.clone(),
                        c.status.clone(),
                        c.reason.clone(),
                        c.message.clone(),
                        c.last_transition_time.as_ref().map(time),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn statefulset_conditions(s: &K8sSts) -> Vec<DescribeCondition> {
    s.status
        .as_ref()
        .and_then(|st| st.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .map(|c| {
                    condition(
                        c.type_.clone(),
                        c.status.clone(),
                        c.reason.clone(),
                        c.message.clone(),
                        c.last_transition_time.as_ref().map(time),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

fn pod_conditions(p: &K8sPod) -> Vec<DescribeCondition> {
    p.status
        .as_ref()
        .and_then(|s| s.conditions.as_ref())
        .map(|cs| {
            cs.iter()
                .map(|c| {
                    condition(
                        c.type_.clone(),
                        c.status.clone(),
                        c.reason.clone(),
                        c.message.clone(),
                        c.last_transition_time.as_ref().map(time),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pod container statuses → DTO. The "current state" (running/waiting/
/// terminated) is read off `state`; its reason carries the meaningful detail
/// (e.g. CrashLoopBackOff while waiting, OOMKilled/Error while terminated). When
/// the container is currently fine but previously crashed, fall back to
/// `lastState` so the panel still shows *why* it restarted.
fn pod_containers(p: &K8sPod) -> Vec<DescribeContainer> {
    let statuses = p
        .status
        .as_ref()
        .and_then(|s| s.container_statuses.as_ref())
        .map(|v| v.as_slice())
        .unwrap_or(&[]);

    statuses
        .iter()
        .map(|cs| {
            let st = cs.state.as_ref();
            let (state, mut reason, mut message) = if let Some(w) =
                st.and_then(|s| s.waiting.as_ref())
            {
                ("waiting".to_string(), w.reason.clone(), w.message.clone())
            } else if let Some(t) = st.and_then(|s| s.terminated.as_ref()) {
                // Prefer the human reason (OOMKilled/Error/Completed); fall back
                // to the exit-code signal when no reason is set.
                let reason = t
                    .reason
                    .clone()
                    .or_else(|| Some(format!("ExitCode {}", t.exit_code)));
                ("terminated".to_string(), reason, t.message.clone())
            } else if st.and_then(|s| s.running.as_ref()).is_some() {
                ("running".to_string(), None, None)
            } else {
                ("unknown".to_string(), None, None)
            };

            // If currently running/ok but it restarted, surface the last crash
            // reason so CrashLoopBackOff / OOMKilled history is visible.
            if reason.is_none() && cs.restart_count > 0 {
                if let Some(last_term) = cs
                    .last_state
                    .as_ref()
                    .and_then(|ls| ls.terminated.as_ref())
                {
                    reason = last_term
                        .reason
                        .clone()
                        .or_else(|| Some(format!("ExitCode {}", last_term.exit_code)));
                    if message.is_none() {
                        message = last_term.message.clone();
                    }
                }
            }

            DescribeContainer {
                name: cs.name.clone(),
                ready: cs.ready,
                restart_count: cs.restart_count,
                state,
                reason,
                message,
            }
        })
        .collect()
}

/// Map our path `kind` to the capitalized k8s `involvedObject.kind` used in the
/// event store ("Deployment" / "StatefulSet" / "Pod").
fn involved_kind(kind: &str) -> &'static str {
    match kind {
        "deployment" => "Deployment",
        "statefulset" => "StatefulSet",
        "pod" => "Pod",
        _ => "",
    }
}

async fn describe(
    State(st): State<AppState>,
    Path((kind, ns, name)): Path<(String, String, String)>,
) -> ApiResult<Json<DescribeResponse>> {
    require_namespace(&ns)?;

    let kind = kind.to_ascii_lowercase();

    // Conditions + (pods only) container statuses off the live typed object.
    let (conditions, containers) = match kind.as_str() {
        "deployment" => {
            let d = get_obj::<K8sDeployment>(&st.kube, &ns, &name, "deployment").await?;
            (deployment_conditions(&d), Vec::new())
        }
        "statefulset" => {
            let s = get_obj::<K8sSts>(&st.kube, &ns, &name, "statefulset").await?;
            (statefulset_conditions(&s), Vec::new())
        }
        "pod" => {
            let p = get_obj::<K8sPod>(&st.kube, &ns, &name, "pod").await?;
            (pod_conditions(&p), pod_containers(&p))
        }
        other => {
            return Err(ApiError::BadRequest(format!(
                "unsupported kind {other:?} (expected one of: deployment, statefulset, pod)"
            )))
        }
    };

    // Recent events for THIS object from the persisted store (same source as
    // GET /api/events/:ns), filtered by involvedKind + involvedName, newest first.
    let filter = K8sEventFilter {
        q: None,
        from: None,
        to: None,
        involved_kind: Some(involved_kind(&kind).to_string()),
        involved_name: Some(name.clone()),
    };
    let events = list_k8s_events(&st.db, &ns, None, 50, &filter).await?.items;

    Ok(Json(DescribeResponse {
        kind,
        namespace: ns,
        name,
        conditions,
        containers,
        events,
    }))
}
