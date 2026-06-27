//! Status page summary — live component health + uptime + recent incidents.
//!
//!   GET /api/status   -> StatusSummary
//!
//! Current status is read live from the cluster; uptime% and the incident
//! history come from the `status_events` transition log written by the monitor.

use std::collections::HashMap;

use axum::{extract::State, routing::get, Json, Router};
use k8s_openapi::api::apps::v1::{Deployment, StatefulSet};
use kube::api::ListParams;
use kube::Api;

use crate::conv;
use crate::db;
use crate::dto::{HealthStatus, Incident, StatusComponent, StatusSummary};
use crate::error::ApiResult;
use crate::monitor::{health_str, sts_health};
use crate::AppState;

const WINDOW_HOURS: i64 = 24;

pub fn routes() -> Router<AppState> {
    Router::new().route("/api/status", get(get_status))
}

struct Live {
    kind: &'static str,
    namespace: String,
    name: String,
    status: HealthStatus,
    ready: i32,
    desired: i32,
}

async fn get_status(State(st): State<AppState>) -> ApiResult<Json<StatusSummary>> {
    let now = chrono::Utc::now();
    let since = now - chrono::Duration::hours(WINDOW_HOURS);

    // 1. Live current state of every monitored component across managed namespaces.
    let mut live: Vec<Live> = Vec::new();
    for ns in &crate::k8s::managed_namespaces() {
        let deps: Api<Deployment> = Api::namespaced(st.kube.clone(), ns);
        for d in deps.list(&ListParams::default()).await?.items {
            live.push(Live {
                kind: "Deployment",
                namespace: ns.clone(),
                name: d.metadata.name.clone().unwrap_or_default(),
                status: conv::deployment_health(&d),
                ready: d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0),
                desired: d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0),
            });
        }
        let sts: Api<StatefulSet> = Api::namespaced(st.kube.clone(), ns);
        for s in sts.list(&ListParams::default()).await?.items {
            live.push(Live {
                kind: "StatefulSet",
                namespace: ns.clone(),
                name: s.metadata.name.clone().unwrap_or_default(),
                status: sts_health(&s),
                ready: s.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0),
                desired: s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0),
            });
        }
    }
    live.sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));

    // 2. Transition history within the window + entry state at the window start.
    let events = db::status_events_since(&st.db, since).await.unwrap_or_default();
    let entry: HashMap<String, String> = db::statuses_as_of(&st.db, since)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(ns, name, s)| (format!("{ns}/{name}"), s))
        .collect();
    let mut by_comp: HashMap<String, Vec<&db::StatusTransition>> = HashMap::new();
    for e in &events {
        by_comp
            .entry(format!("{}/{}", e.namespace, e.name))
            .or_default()
            .push(e);
    }

    // 3. Per-component uptime + incidents, integrating the degraded segments.
    let window_ms = (now - since).num_milliseconds().max(1) as f64;
    let mut components = Vec::new();
    let mut incidents: Vec<Incident> = Vec::new();

    for l in &live {
        let key = format!("{}/{}", l.namespace, l.name);
        let evs = by_comp.get(&key).cloned().unwrap_or_default();

        let mut seg_start = since;
        let mut seg_state = entry
            .get(&key)
            .cloned()
            .unwrap_or_else(|| health_str(l.status).to_string());
        let mut downtime_ms: i64 = 0;
        let mut since_change: Option<chrono::DateTime<chrono::Utc>> = None;

        let close = |state: &str, from: chrono::DateTime<chrono::Utc>, to: chrono::DateTime<chrono::Utc>, inc: &mut Vec<Incident>, dt: &mut i64| {
            if state == "degraded" {
                let ms = (to - from).num_milliseconds().max(0);
                *dt += ms;
                inc.push(Incident {
                    kind: l.kind.to_string(),
                    namespace: l.namespace.clone(),
                    name: l.name.clone(),
                    status: "degraded".to_string(),
                    started_at: from,
                    ended_at: Some(to),
                    duration_ms: Some(ms),
                    ongoing: false,
                });
            }
        };

        for e in &evs {
            close(&seg_state, seg_start, e.ts, &mut incidents, &mut downtime_ms);
            seg_start = e.ts;
            seg_state = e.status.clone();
            since_change = Some(e.ts);
        }

        // Final segment reflects LIVE truth (so an in-progress outage shows even
        // before the monitor has logged the transition).
        let live_state = health_str(l.status);
        if live_state == "degraded" {
            let ms = (now - seg_start).num_milliseconds().max(0);
            downtime_ms += ms;
            incidents.push(Incident {
                kind: l.kind.to_string(),
                namespace: l.namespace.clone(),
                name: l.name.clone(),
                status: "degraded".to_string(),
                started_at: seg_start,
                ended_at: None,
                duration_ms: None,
                ongoing: true,
            });
        } else if seg_state == "degraded" {
            // Last recorded segment was degraded but live recovered between ticks.
            close(&seg_state, seg_start, now, &mut incidents, &mut downtime_ms);
        }

        let uptime = (1.0 - downtime_ms as f64 / window_ms).clamp(0.0, 1.0);
        components.push(StatusComponent {
            kind: l.kind.to_string(),
            namespace: l.namespace.clone(),
            name: l.name.clone(),
            status: l.status,
            replicas_ready: l.ready,
            replicas_desired: l.desired,
            since: since_change,
            uptime,
            ongoing: l.status == HealthStatus::Degraded,
        });
    }

    incidents.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    incidents.truncate(25);

    let total = components.len() as i32;
    let degraded = components
        .iter()
        .filter(|c| c.status == HealthStatus::Degraded)
        .count() as i32;
    let healthy = components
        .iter()
        .filter(|c| c.status == HealthStatus::Healthy)
        .count() as i32;
    let overall = if degraded == 0 {
        "operational"
    } else if degraded >= 3 || (total > 0 && degraded * 100 / total >= 40) {
        "major_outage"
    } else {
        "degraded"
    };

    Ok(Json(StatusSummary {
        overall: overall.to_string(),
        updated_at: now,
        window_hours: WINDOW_HOURS,
        total,
        healthy,
        degraded,
        components,
        incidents,
    }))
}
