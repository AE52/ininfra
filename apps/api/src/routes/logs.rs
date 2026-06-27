//! Pod logs — historical snapshot (Loki) and live SSE stream (kube-rs).
//!
//!   GET /api/logs/:ns/:pod?container=&q=&regex=&since=&from=&to=&limit=
//!     Historical/searchable log lines sourced from Loki (~1 week retention).
//!     Query params:
//!       container  — which container (optional; defaults to first)
//!       q          — search pattern (substring by default, regex when `regex=true`)
//!       regex      — "true" | "1" → use LogQL `|~ "..."` instead of `|= "..."`
//!       since      — shorthand window: "5m" | "15m" | "1h" | "6h" | "24h" | "3d" | "7d" (default "1h")
//!       from       — RFC3339 start (overrides `since` when both provided)
//!       to         — RFC3339 end   (overrides `since` when both provided)
//!       limit      — max lines, 1..5000 (default 500)
//!
//!   GET /api/logs/:ns/:pod/stream?container=   (text/event-stream)
//!     Live tail via kube-rs pod log stream — unchanged.
//!
//!   GET /api/logs-multi/:ns?pods=p1,p2&q=&regex=&since=&from=&to=&limit=
//!     Historical snapshot aggregated across several pods (Loki, regex pod
//!     selector). Same q/regex/since/from/to/limit semantics as single-pod.
//!
//!   GET /api/logs-multi/:ns/stream?pods=p1,p2   (text/event-stream)
//!     Live tail of several pods merged via `select_all`; failed pods skipped.

use axum::{
    extract::{Path, Query, State},
    response::sse::{Event, KeepAlive, Sse},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures::{AsyncBufReadExt, StreamExt};
use k8s_openapi::api::core::v1::Pod as K8sPod;
use kube::api::LogParams;
use kube::Api;
use serde::Deserialize;
use std::convert::Infallible;

use crate::config;
use crate::dto::PodLog;
use crate::error::ApiResult;
use crate::error::ApiError;
use crate::k8s::require_namespace;
use crate::loki::{query_range, query_range_multi, SearchMode, TimeRange};
use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/logs/:ns/:pod", get(snapshot))
        .route("/api/logs/:ns/:pod/stream", get(stream))
        .route("/api/logs-multi/:ns", get(snapshot_multi))
        .route("/api/logs-multi/:ns/stream", get(stream_multi))
}

#[derive(Debug, Deserialize)]
struct LogQuery {
    container: Option<String>,
    /// Search pattern (substring by default, regex when `regex=true`).
    q: Option<String>,
    /// When "true" or "1", treat `q` as a regex (LogQL `|~ "..."`).
    regex: Option<String>,
    /// Shorthand time window: "5m" | "15m" | "1h" | "6h" | "24h" | "3d" | "7d".
    since: Option<String>,
    /// RFC3339 start of range.
    from: Option<String>,
    /// RFC3339 end of range.
    to: Option<String>,
    /// Max lines (1..5000), default 500.
    limit: Option<u32>,
    /// Legacy compat: behaves as `limit` when `limit` is absent.
    tail: Option<u32>,
}

/// Resolve which container to read: the requested one, else the first in the pod spec.
async fn resolve_container(
    api: &Api<K8sPod>,
    pod: &str,
    requested: Option<String>,
) -> ApiResult<String> {
    if let Some(c) = requested.filter(|c| !c.is_empty()) {
        return Ok(c);
    }
    let p = api
        .get_opt(pod)
        .await?
        .ok_or_else(|| ApiError::NotFound(format!("pod {pod}")))?;
    p.spec
        .and_then(|s| s.containers.first().map(|c| c.name.clone()))
        .ok_or_else(|| ApiError::BadRequest("pod has no containers".into()))
}

/// Historical snapshot via Loki.
async fn snapshot(
    State(st): State<AppState>,
    Path((ns, pod)): Path<(String, String)>,
    Query(q): Query<LogQuery>,
) -> ApiResult<Json<Vec<PodLog>>> {
    require_namespace(&ns)?;

    // Resolve container name (needed for both the Loki query and the fallback).
    let api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);
    let container = resolve_container(&api, &pod, q.container).await?;

    // Determine search mode and validate regex pattern when applicable.
    let use_regex = matches!(q.regex.as_deref(), Some("true") | Some("1"));
    let mode = if use_regex {
        SearchMode::Regex
    } else {
        SearchMode::Substring
    };

    // If regex mode is requested, validate the pattern before hitting Loki so we
    // can return an HTTP 400 with a clear message instead of a cryptic Loki error.
    if use_regex {
        if let Some(pattern) = q.q.as_deref().filter(|s| !s.is_empty()) {
            regex::Regex::new(pattern).map_err(|e| {
                ApiError::BadRequest(format!("invalid regex: {e}"))
            })?;
        }
    }

    // Determine time range: explicit from/to > shorthand since > default 1h.
    let range = match (q.from.as_deref(), q.to.as_deref()) {
        (Some(from), Some(to)) => TimeRange::from_rfc3339(from, to)
            .ok_or_else(|| ApiError::BadRequest("invalid from/to timestamps".into()))?,
        _ => q
            .since
            .as_deref()
            .and_then(TimeRange::from_since)
            .unwrap_or_else(TimeRange::last_hour),
    };

    // `limit` wins over legacy `tail` for backward compat.
    let limit = q.limit.or(q.tail);
    let want = limit.unwrap_or(500);

    // Loki is an OPTIONAL search/history backend. When it is configured and
    // reachable, use it. Otherwise (no LOKI_URL, or Loki down) fall back to the
    // pod log snapshot straight from the Kubernetes API — always available.
    let loki_url = config::get().loki_url.clone();
    if !loki_url.trim().is_empty() {
        if let Ok(logs) = query_range(
            &loki_url,
            &ns,
            &pod,
            Some(&container),
            q.q.as_deref(),
            mode,
            Some(range),
            limit,
        )
        .await
        {
            return Ok(Json(logs));
        }
    }

    let logs = kube_log_snapshot(&api, &ns, &pod, &container, want, q.q.as_deref(), use_regex).await?;
    Ok(Json(logs))
}

/// Fallback log snapshot read straight from the Kubernetes API (kubectl-logs
/// style), used when Loki is not configured or unreachable. Loki adds full-text
/// search and longer retention; the kube API is the always-available baseline.
/// Applies the same substring/regex search filter client-side.
async fn kube_log_snapshot(
    api: &Api<K8sPod>,
    ns: &str,
    pod: &str,
    container: &str,
    limit: u32,
    query: Option<&str>,
    use_regex: bool,
) -> ApiResult<Vec<PodLog>> {
    let lp = LogParams {
        container: Some(container.to_string()),
        timestamps: true,
        tail_lines: Some(limit.clamp(1, 5000) as i64),
        ..Default::default()
    };
    let raw = api.logs(pod, &lp).await?;

    let needle = query.filter(|s| !s.is_empty());
    let re = if use_regex {
        needle.and_then(|p| regex::Regex::new(p).ok())
    } else {
        None
    };
    let lower = (!use_regex).then(|| needle.map(|s| s.to_lowercase())).flatten();

    let mut out = Vec::new();
    for line in raw.lines() {
        if line.is_empty() {
            continue;
        }
        let log = parse_line(ns, pod, container, line);
        if let Some(re) = &re {
            if !re.is_match(&log.message) {
                continue;
            }
        } else if let Some(n) = &lower {
            if !log.message.to_lowercase().contains(n) {
                continue;
            }
        }
        out.push(log);
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct StreamQuery {
    container: Option<String>,
}

/// Live tail via kube-rs — unchanged.
async fn stream(
    State(st): State<AppState>,
    Path((ns, pod)): Path<(String, String)>,
    Query(q): Query<StreamQuery>,
) -> ApiResult<impl IntoResponse> {
    require_namespace(&ns)?;
    let api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);
    let container = resolve_container(&api, &pod, q.container).await?;

    let lp = LogParams {
        container: Some(container.clone()),
        follow: true,
        timestamps: true,
        tail_lines: Some(100),
        ..Default::default()
    };

    // kube-rs gives us an AsyncBufRead; `log_stream` yields line-delimited bytes.
    let line_stream = api.log_stream(&pod, &lp).await?.lines();

    let ns_c = ns.clone();
    let pod_c = pod.clone();
    let container_c = container.clone();

    let sse_stream = line_stream.map(move |item| -> Result<Event, Infallible> {
        let event = match item {
            Ok(line) => {
                let log = parse_line(&ns_c, &pod_c, &container_c, &line);
                match serde_json::to_string(&log) {
                    Ok(json) => Event::default().data(json),
                    Err(e) => Event::default()
                        .event("error")
                        .data(format!("serialize error: {e}")),
                }
            }
            Err(e) => Event::default()
                .event("error")
                .data(format!("log stream error: {e}")),
        };
        Ok(event)
    });

    Ok(Sse::new(sse_stream).keep_alive(KeepAlive::default()))
}

/// Split a `timestamps=true` log line into (timestamp, message). The k8s
/// format is `<RFC3339> <message>` with a single space separator.
fn parse_line(ns: &str, pod: &str, container: &str, line: &str) -> PodLog {
    let (timestamp, message) = match line.split_once(' ') {
        Some((ts, rest)) => match chrono::DateTime::parse_from_rfc3339(ts) {
            Ok(t) => (Some(t.with_timezone(&chrono::Utc)), rest.to_string()),
            Err(_) => (None, line.to_string()),
        },
        None => (None, line.to_string()),
    };
    PodLog {
        pod: pod.to_string(),
        namespace: ns.to_string(),
        container: container.to_string(),
        timestamp,
        message,
    }
}

// ---------------------------------------------------------------------------
// Multi-pod aggregation
//
//   GET /api/logs-multi/:ns?pods=p1,p2&q=&regex=&since=&from=&to=&limit=
//     Historical snapshot across several pods at once, sourced from Loki via a
//     regex pod selector (`pod=~"p1|p2|p3"`). Same q/regex/since/from/to/limit
//     semantics as the single-pod snapshot; lines sorted oldest-first.
//
//   GET /api/logs-multi/:ns/stream?pods=p1,p2   (text/event-stream)
//     Live tail of several pods at once — each pod's kube-rs log stream is
//     opened against its first container and the per-pod line streams are
//     merged with `select_all` so lines interleave. Pods that fail to open are
//     skipped, not fatal.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct MultiLogQuery {
    /// Comma-separated pod names (required, non-empty).
    pods: Option<String>,
    /// Search pattern (substring by default, regex when `regex=true`).
    q: Option<String>,
    /// When "true" or "1", treat `q` as a regex (LogQL `|~ "..."`).
    regex: Option<String>,
    /// Shorthand time window: "5m" | "15m" | "1h" | "6h" | "24h" | "3d" | "7d".
    since: Option<String>,
    /// RFC3339 start of range.
    from: Option<String>,
    /// RFC3339 end of range.
    to: Option<String>,
    /// Max lines (1..5000), default 500.
    limit: Option<u32>,
}

/// Parse the `pods` CSV into a de-duplicated, non-empty list of names.
fn parse_pods_csv(raw: Option<&str>) -> ApiResult<Vec<String>> {
    let pods: Vec<String> = raw
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if pods.is_empty() {
        return Err(ApiError::BadRequest("pods query param is required".into()));
    }
    Ok(pods)
}

/// Historical multi-pod snapshot via Loki.
async fn snapshot_multi(
    State(st): State<AppState>,
    Path(ns): Path<String>,
    Query(q): Query<MultiLogQuery>,
) -> ApiResult<Json<Vec<PodLog>>> {
    require_namespace(&ns)?;
    let pods = parse_pods_csv(q.pods.as_deref())?;

    // Determine search mode and validate regex pattern when applicable —
    // mirrors the single-pod snapshot.
    let use_regex = matches!(q.regex.as_deref(), Some("true") | Some("1"));
    let mode = if use_regex {
        SearchMode::Regex
    } else {
        SearchMode::Substring
    };
    if use_regex {
        if let Some(pattern) = q.q.as_deref().filter(|s| !s.is_empty()) {
            regex::Regex::new(pattern)
                .map_err(|e| ApiError::BadRequest(format!("invalid regex: {e}")))?;
        }
    }

    // Determine time range: explicit from/to > shorthand since > default 1h.
    let range = match (q.from.as_deref(), q.to.as_deref()) {
        (Some(from), Some(to)) => TimeRange::from_rfc3339(from, to)
            .ok_or_else(|| ApiError::BadRequest("invalid from/to timestamps".into()))?,
        _ => q
            .since
            .as_deref()
            .and_then(TimeRange::from_since)
            .unwrap_or_else(TimeRange::last_hour),
    };

    let want = q.limit.unwrap_or(500);

    // Loki when available; otherwise aggregate kube pod-log snapshots.
    let loki_url = config::get().loki_url.clone();
    if !loki_url.trim().is_empty() {
        if let Ok(logs) =
            query_range_multi(&loki_url, &ns, &pods, q.q.as_deref(), mode, Some(range), q.limit).await
        {
            return Ok(Json(logs));
        }
    }

    let api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);
    let mut all: Vec<PodLog> = Vec::new();
    for pod in &pods {
        // Skip pods whose container can't be resolved rather than failing all.
        let Ok(container) = resolve_container(&api, pod, None).await else {
            continue;
        };
        if let Ok(mut logs) =
            kube_log_snapshot(&api, &ns, pod, &container, want, q.q.as_deref(), use_regex).await
        {
            all.append(&mut logs);
        }
    }
    all.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    all.truncate(want as usize);
    Ok(Json(all))
}

#[derive(Debug, Deserialize)]
struct MultiStreamQuery {
    /// Comma-separated pod names (required, non-empty).
    pods: Option<String>,
}

/// Live multi-pod tail via kube-rs, merged with `select_all`.
async fn stream_multi(
    State(st): State<AppState>,
    Path(ns): Path<String>,
    Query(q): Query<MultiStreamQuery>,
) -> ApiResult<impl IntoResponse> {
    require_namespace(&ns)?;
    let pods = parse_pods_csv(q.pods.as_deref())?;

    let api: Api<K8sPod> = Api::namespaced(st.kube.clone(), &ns);

    // Open one live log stream per pod. Pods whose container can't be resolved
    // or whose stream fails to open are skipped (continue), not fatal.
    let mut per_pod_streams = Vec::new();
    for pod in pods {
        let container = match resolve_container(&api, &pod, None).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        let lp = LogParams {
            container: Some(container.clone()),
            follow: true,
            timestamps: true,
            tail_lines: Some(100),
            ..Default::default()
        };

        let line_stream = match api.log_stream(&pod, &lp).await {
            Ok(s) => s.lines(),
            Err(_) => continue,
        };

        let ns_c = ns.clone();
        let pod_c = pod.clone();
        let container_c = container.clone();

        let sse_stream = line_stream.map(move |item| -> Result<Event, Infallible> {
            let event = match item {
                Ok(line) => {
                    let log = parse_line(&ns_c, &pod_c, &container_c, &line);
                    match serde_json::to_string(&log) {
                        Ok(json) => Event::default().data(json),
                        Err(e) => Event::default()
                            .event("error")
                            .data(format!("serialize error: {e}")),
                    }
                }
                Err(e) => Event::default()
                    .event("error")
                    .data(format!("log stream error: {e}")),
            };
            Ok(event)
        });

        per_pod_streams.push(sse_stream.boxed());
    }

    if per_pod_streams.is_empty() {
        return Err(ApiError::BadRequest(
            "no requested pods could be streamed".into(),
        ));
    }

    // Merge per-pod line streams so lines interleave as they arrive.
    let merged = futures::stream::select_all(per_pod_streams);

    Ok(Sse::new(merged).keep_alive(KeepAlive::default()))
}
