//! Background status monitor.
//!
//! Polls the monitored components' health every [`INTERVAL`] and records a row
//! into `status_events` ONLY when a component's status changes. That transition
//! log powers the status page (incidents + uptime) and the in-console alerting
//! (a degraded transition is logged at WARN and surfaced as an incident).

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

use k8s_openapi::api::apps::v1::{Deployment, StatefulSet};
use k8s_openapi::api::core::v1::Event as K8sEvent;
use kube::api::ListParams;
use kube::Api;

use crate::conv;
use crate::db::{insert_status_event, upsert_k8s_event, K8sEventRow};
use crate::dto::HealthStatus;
use crate::AppState;

const INTERVAL: Duration = Duration::from_secs(30);

struct Observed {
    kind: &'static str,
    namespace: String,
    name: String,
    status: HealthStatus,
    ready: i32,
    desired: i32,
}

/// String form stored in the DB / wire (matches HealthStatus serde lowercase).
pub fn health_str(h: HealthStatus) -> &'static str {
    match h {
        HealthStatus::Healthy => "healthy",
        HealthStatus::Progressing => "progressing",
        HealthStatus::Degraded => "degraded",
        HealthStatus::Unknown => "unknown",
    }
}

/// Roll a StatefulSet's status up to a health verb.
pub fn sts_health(s: &StatefulSet) -> HealthStatus {
    let desired = s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0);
    let ready = s.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0);
    if desired == 0 {
        HealthStatus::Unknown
    } else if ready == desired {
        HealthStatus::Healthy
    } else if ready == 0 {
        HealthStatus::Degraded
    } else {
        HealthStatus::Progressing
    }
}

async fn observe(state: &AppState) -> Vec<Observed> {
    let mut out = Vec::new();

    for ns in &crate::k8s::managed_namespaces() {
        let deps: Api<Deployment> = Api::namespaced(state.kube.clone(), ns);
        if let Ok(list) = deps.list(&ListParams::default()).await {
            for d in list.items {
                out.push(Observed {
                    kind: "Deployment",
                    namespace: ns.clone(),
                    name: d.metadata.name.clone().unwrap_or_default(),
                    status: conv::deployment_health(&d),
                    ready: d.status.as_ref().and_then(|s| s.ready_replicas).unwrap_or(0),
                    desired: d.spec.as_ref().and_then(|s| s.replicas).unwrap_or(0),
                });
            }
        }

        let sts: Api<StatefulSet> = Api::namespaced(state.kube.clone(), ns);
        if let Ok(list) = sts.list(&ListParams::default()).await {
            for s in list.items {
                out.push(Observed {
                    kind: "StatefulSet",
                    namespace: ns.clone(),
                    name: s.metadata.name.clone().unwrap_or_default(),
                    status: sts_health(&s),
                    ready: s.status.as_ref().and_then(|st| st.ready_replicas).unwrap_or(0),
                    desired: s.spec.as_ref().and_then(|sp| sp.replicas).unwrap_or(0),
                });
            }
        }
    }
    out
}

/// Spawn the monitor loop. Cheap: one list per namespace every 30s.
pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        // Seed last-known from the DB so a restart doesn't re-log unchanged
        // components as fresh transitions.
        let mut last: HashMap<String, String> = HashMap::new();
        if let Ok(rows) = crate::db::latest_statuses(&state.db).await {
            for (ns, name, status) in rows {
                last.insert(format!("{ns}/{name}"), status);
            }
        }
        // Debounce: a state change is only committed (logged + recorded) once it
        // has been observed in TWO consecutive polls. This suppresses single-poll
        // blips (a one-cycle pod restart, a brief rolling-update window, or a scrape
        // glitch) so they never become false-positive incidents on the status page.
        let mut pending: HashMap<String, String> = HashMap::new();

        loop {
            for o in observe(&state).await {
                let key = format!("{}/{}", o.namespace, o.name);
                let cur = health_str(o.status).to_string();
                let prev = last.get(&key).cloned();
                if prev.as_deref() == Some(cur.as_str()) {
                    // Stable on the committed state; clear any half-seen flap.
                    pending.remove(&key);
                    continue;
                }
                // Differs from committed state — require a second consecutive
                // observation of the SAME new state before committing it.
                if pending.get(&key).map(String::as_str) != Some(cur.as_str()) {
                    pending.insert(key, cur);
                    continue;
                }
                pending.remove(&key);
                if cur == "degraded" {
                    tracing::warn!(component = %key, ready = o.ready, desired = o.desired, "status alert: component DEGRADED");
                } else if prev.as_deref() == Some("degraded") {
                    tracing::info!(component = %key, status = %cur, "status: component RECOVERED");
                }
                let _ = insert_status_event(
                    &state.db,
                    o.kind,
                    &o.namespace,
                    &o.name,
                    &cur,
                    prev.as_deref(),
                    serde_json::json!({ "ready": o.ready, "desired": o.desired }),
                )
                .await;
                last.insert(key, cur);
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

/// Spawn the log-retention pruner: deletes audit/error/gateway/status/k8s_events rows
/// older than the configured retention, at startup and every 12h. No-op when all
/// retentions are 0 (keep forever).
pub fn spawn_pruner(state: AppState) {
    let cfg = crate::config::get();
    let (audit_days, log_days, event_days) =
        (cfg.audit_retention_days, cfg.log_retention_days, cfg.event_retention_days);
    if audit_days == 0 && log_days == 0 && event_days == 0 {
        return;
    }
    tokio::spawn(async move {
        loop {
            match crate::db::prune_logs(&state.db, audit_days, log_days).await {
                Ok(n) if n > 0 => tracing::info!(pruned = n, "log retention: pruned old rows"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "log retention prune failed"),
            }
            match crate::db::prune_k8s_events(&state.db, event_days).await {
                Ok(n) if n > 0 => tracing::info!(pruned = n, "k8s events retention: pruned old rows"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "k8s events retention prune failed"),
            }
            tokio::time::sleep(Duration::from_secs(12 * 3600)).await;
        }
    });
}

/// Spawn the k8s event collector: every 45s list events in every managed namespace
/// and upsert them into `k8s_events` for long-term retention.
pub fn spawn_events(state: AppState) {
    const EVENTS_INTERVAL: Duration = Duration::from_secs(45);
    tokio::spawn(async move {
        loop {
            for ns in &crate::k8s::managed_namespaces() {
                let api: Api<K8sEvent> = Api::namespaced(state.kube.clone(), ns);
                match api.list(&ListParams::default()).await {
                    Ok(list) => {
                        for ev in &list.items {
                            let io = &ev.involved_object;
                            let first = ev.first_timestamp.as_ref().map(|t| t.0);
                            let last = ev
                                .last_timestamp
                                .as_ref()
                                .map(|t| t.0)
                                .or_else(|| ev.event_time.as_ref().map(|t| t.0));
                            let source = ev
                                .source
                                .as_ref()
                                .and_then(|s| s.component.as_deref());
                            let row = K8sEventRow {
                                namespace: ns.as_str(),
                                type_: ev.type_.as_deref().unwrap_or(""),
                                reason: ev.reason.as_deref().unwrap_or(""),
                                message: ev.message.as_deref().unwrap_or(""),
                                involved_kind: io.kind.as_deref().unwrap_or(""),
                                involved_name: io.name.as_deref().unwrap_or(""),
                                count: ev.count.unwrap_or(1),
                                first_seen: first,
                                last_seen: last,
                                source,
                            };
                            if let Err(e) = upsert_k8s_event(&state.db, &row).await {
                                tracing::warn!(
                                    namespace = %ns,
                                    error = %e,
                                    "k8s event upsert failed"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!(namespace = %ns, error = %e, "k8s event list failed");
                    }
                }
            }
            tokio::time::sleep(EVENTS_INTERVAL).await;
        }
    });
}

/// Spawn the gateway access-log tailer: every 30s, fetch recent gateway logs,
/// parse them, persist any 5xx (502/503/…) to `gateway_errors`, and persist a
/// sampled stream of all requests (every non-2xx + 1-in-N 2xx) to
/// `gateway_requests`. No-op when the gateway integration isn't configured.
pub fn spawn_gateway(state: AppState) {
    let g = match &crate::config::get().gateway {
        Some(g) => g.clone(),
        None => return,
    };
    let sample = crate::config::get().gateway_sample_2xx;
    tracing::info!(deployment = %g.deployment, sample_2xx = sample, "gateway tailer started");
    tokio::spawn(async move {
        // Rolling de-dup of processed lines (logs are fetched with overlap). The
        // window must comfortably exceed the per-poll overlap volume.
        let mut seen: VecDeque<String> = VecDeque::new();
        let mut seen_set: HashSet<String> = HashSet::new();
        // Counter driving 1-in-N 2xx sampling.
        let mut counter_2xx: u64 = 0;
        loop {
            let lines = crate::gateway_log::fetch_lines(&state, &g, 2000, Some(45)).await;
            for l in &lines {
                let e = match crate::gateway_log::parse_line(l) {
                    Some(e) => e,
                    None => continue,
                };
                let sig = format!(
                    "{}|{}|{}|{}|{}",
                    e.ts.map(|t| t.to_rfc3339()).unwrap_or_default(),
                    e.request_id.clone().unwrap_or_default(),
                    e.client_ip.clone().unwrap_or_default(),
                    e.path,
                    e.status
                );
                if seen_set.contains(&sig) {
                    continue;
                }

                let is_5xx = crate::gateway_log::is_5xx(&e);
                let is_2xx = (200..300).contains(&e.status) && !is_5xx;
                // Always keep non-2xx (errors/redirects); sample 2xx 1-in-N.
                let keep = if is_2xx {
                    if sample <= 0 {
                        false
                    } else {
                        counter_2xx = counter_2xx.wrapping_add(1);
                        counter_2xx % (sample as u64) == 0
                    }
                } else {
                    true
                };
                if keep {
                    let _ = crate::db::insert_gateway_request(&state.db, &e).await;
                }
                if is_5xx && crate::db::insert_gateway_error(&state.db, &e).await.is_ok() {
                    tracing::warn!(path = %e.path, status = e.status, "gateway 5xx");
                }

                seen_set.insert(sig.clone());
                seen.push_back(sig);
                if seen.len() > 20000 {
                    if let Some(old) = seen.pop_front() {
                        seen_set.remove(&old);
                    }
                }
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}
