//! Loki query client for historical pod log retrieval.
//!
//! Uses Loki's HTTP query API (`GET /loki/api/v1/query_range`).
//! Label scheme (confirmed via `/loki/api/v1/labels`):
//!   `{namespace="<ns>", pod="<pod>"}` — with optional `, container="<c>"`.
//! Timestamps in the Loki response are Unix nanosecond epoch strings.

use chrono::{DateTime, TimeZone, Utc};
use serde::Deserialize;

use crate::dto::PodLog;
use crate::error::ApiResult;

// ---------------------------------------------------------------------------
// Loki HTTP response shapes
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct LokiResponse {
    status: String,
    data: LokiData,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LokiData {
    result_type: String,
    result: Vec<LokiStream>,
}

#[derive(Debug, Deserialize)]
struct LokiStream {
    stream: std::collections::HashMap<String, String>,
    values: Vec<(String, String)>, // [ns_timestamp, line]
}

// ---------------------------------------------------------------------------
// Time-range helpers
// ---------------------------------------------------------------------------

/// A half-open time window `[start, end)` expressed as Unix nanoseconds.
#[derive(Debug, Clone, Copy)]
pub struct TimeRange {
    pub start_ns: i64,
    pub end_ns: i64,
}

impl TimeRange {
    /// Build from a shorthand like "15m", "1h", "24h", "7d".
    pub fn from_since(since: &str) -> Option<Self> {
        let now = Utc::now();
        let duration = parse_since(since)?;
        let start = now - duration;
        Some(Self {
            start_ns: start.timestamp_nanos_opt()?,
            end_ns: now.timestamp_nanos_opt()?,
        })
    }

    /// Build from explicit RFC3339 boundaries.
    pub fn from_rfc3339(from: &str, to: &str) -> Option<Self> {
        let start: DateTime<Utc> = from.parse().ok()?;
        let end: DateTime<Utc> = to.parse().ok()?;
        Some(Self {
            start_ns: start.timestamp_nanos_opt()?,
            end_ns: end.timestamp_nanos_opt()?,
        })
    }

    /// Default: last 1 hour.
    pub fn last_hour() -> Self {
        let now = Utc::now();
        let start = now - chrono::Duration::hours(1);
        Self {
            start_ns: start.timestamp_nanos_opt().unwrap_or(0),
            end_ns: now.timestamp_nanos_opt().unwrap_or(0),
        }
    }
}

fn parse_since(s: &str) -> Option<chrono::Duration> {
    let s = s.trim();
    if let Some(rest) = s.strip_suffix('d') {
        let n: i64 = rest.parse().ok()?;
        return Some(chrono::Duration::days(n));
    }
    if let Some(rest) = s.strip_suffix('h') {
        let n: i64 = rest.parse().ok()?;
        return Some(chrono::Duration::hours(n));
    }
    if let Some(rest) = s.strip_suffix('m') {
        let n: i64 = rest.parse().ok()?;
        return Some(chrono::Duration::minutes(n));
    }
    None
}

// ---------------------------------------------------------------------------
// Search mode
// ---------------------------------------------------------------------------

/// Whether the search pattern is a plain substring or a regex.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SearchMode {
    #[default]
    Substring,
    Regex,
}

// ---------------------------------------------------------------------------
// Public query function
// ---------------------------------------------------------------------------

/// Query Loki for historical log lines for a single pod over a time window.
///
/// * `namespace`, `pod` — exact Loki label values (used in stream selector).
/// * `container` — optional; added as a label filter when present.
/// * `search` — optional pattern; appended as a line filter.
/// * `mode` — `Substring` → `|= "..."`, `Regex` → `|~ "..."`.
/// * `range` — time window; defaults to last 1 hour.
/// * `limit` — max lines returned (capped at 5000), default 500.
///
/// Returns lines sorted oldest-first (direction=forward internally, then the
/// result is naturally ordered; Loki backward direction returns newest-first
/// per stream which is confusing across multiple streams, so we sort).
pub async fn query_range(
    loki_base: &str,
    namespace: &str,
    pod: &str,
    container: Option<&str>,
    search: Option<&str>,
    mode: SearchMode,
    range: Option<TimeRange>,
    limit: Option<u32>,
) -> ApiResult<Vec<PodLog>> {
    let range = range.unwrap_or_else(TimeRange::last_hour);
    let limit = limit.unwrap_or(500).min(5000);

    // Build LogQL stream selector. Escape backslashes / double-quotes in every
    // label value so they embed safely in the LogQL string literals (same
    // escaping applied to the line-filter `q` below).
    let ns_lit = namespace.replace('\\', "\\\\").replace('"', "\\\"");
    let pod_lit = pod.replace('\\', "\\\\").replace('"', "\\\"");
    let mut selector = format!(r#"{{namespace="{ns_lit}", pod="{pod_lit}""#);
    if let Some(c) = container.filter(|c| !c.is_empty()) {
        let c_lit = c.replace('\\', "\\\\").replace('"', "\\\"");
        selector.push_str(&format!(r#", container="{c_lit}""#));
    }
    selector.push('}');

    // Append line filter — substring uses `|=`, regex uses `|~`.
    let logql = if let Some(q) = search.filter(|s| !s.is_empty()) {
        // For both modes we escape backslashes and double-quotes so the
        // literal pattern is safely embedded in the LogQL string literal.
        let escaped = q.replace('\\', "\\\\").replace('"', "\\\"");
        match mode {
            SearchMode::Substring => format!(r#"{selector} |= "{escaped}""#),
            SearchMode::Regex    => format!(r#"{selector} |~ "{escaped}""#),
        }
    } else {
        selector
    };

    let url = format!("{loki_base}/loki/api/v1/query_range");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| anyhow::anyhow!("loki client build: {e}"))?;

    let resp = client
        .get(&url)
        .query(&[
            ("query", logql.as_str()),
            ("start", &range.start_ns.to_string()),
            ("end", &range.end_ns.to_string()),
            ("limit", &limit.to_string()),
            ("direction", "backward"),
        ])
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("loki unreachable: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("loki returned HTTP {status}: {body}").into());
    }

    let loki_resp: LokiResponse = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("loki parse error: {e}"))?;

    if loki_resp.status != "success" {
        let msg = loki_resp.message.unwrap_or_else(|| "unknown".to_string());
        return Err(anyhow::anyhow!("loki error: {msg}").into());
    }

    if loki_resp.data.result_type != "streams" {
        return Err(anyhow::anyhow!(
            "unexpected loki result type: {}",
            loki_resp.data.result_type
        )
        .into());
    }

    // Collect all (timestamp_ns, PodLog) pairs, then sort oldest-first.
    let mut entries: Vec<(i64, PodLog)> = Vec::new();

    for stream in loki_resp.data.result {
        // Extract stream labels
        let stream_container = stream
            .stream
            .get("container")
            .cloned()
            .unwrap_or_else(|| container.unwrap_or("").to_string());
        let stream_pod = stream
            .stream
            .get("pod")
            .cloned()
            .unwrap_or_else(|| pod.to_string());
        let stream_ns = stream
            .stream
            .get("namespace")
            .cloned()
            .unwrap_or_else(|| namespace.to_string());

        for (ns_str, line) in stream.values {
            let ts_ns: i64 = ns_str.parse().unwrap_or(0);
            let timestamp = if ts_ns > 0 {
                let secs = ts_ns / 1_000_000_000;
                let nanos = (ts_ns % 1_000_000_000) as u32;
                Utc.timestamp_opt(secs, nanos).single()
            } else {
                None
            };

            entries.push((
                ts_ns,
                PodLog {
                    pod: stream_pod.clone(),
                    namespace: stream_ns.clone(),
                    container: stream_container.clone(),
                    timestamp,
                    message: line,
                },
            ));
        }
    }

    // Sort oldest-first (ascending timestamp_ns)
    entries.sort_unstable_by_key(|(ts, _)| *ts);

    Ok(entries.into_iter().map(|(_, log)| log).collect())
}

/// Query Loki for historical log lines across MULTIPLE pods over a time window.
///
/// Identical semantics to [`query_range`] (same `search`/`mode`/`range`/`limit`
/// rules, same oldest-first sort) but the stream selector matches any of the
/// supplied pods via a regex label match: `pod=~"p1|p2|p3"`. No container
/// filter is applied — each line keeps the `container`/`pod` labels Loki
/// reports for it.
///
/// `pods` must be non-empty (callers validate). Pod names are DNS-1123 so a
/// bare `|` join is already safe; we still regex-escape each name defensively.
pub async fn query_range_multi(
    loki_base: &str,
    namespace: &str,
    pods: &[String],
    search: Option<&str>,
    mode: SearchMode,
    range: Option<TimeRange>,
    limit: Option<u32>,
) -> ApiResult<Vec<PodLog>> {
    let range = range.unwrap_or_else(TimeRange::last_hour);
    let limit = limit.unwrap_or(500).min(5000);

    // Build a regex alternation of escaped pod names: `p1|p2|p3`.
    let pod_alt = pods
        .iter()
        .map(|p| regex::escape(p))
        .collect::<Vec<_>>()
        .join("|");

    // Stream selector with a regex pod match. We escape backslashes / quotes
    // in both the namespace label value and the alternation produced by
    // regex::escape so they embed safely in the LogQL string literals.
    let ns_lit = namespace.replace('\\', "\\\\").replace('"', "\\\"");
    let pod_alt_lit = pod_alt.replace('\\', "\\\\").replace('"', "\\\"");
    let selector = format!(r#"{{namespace="{ns_lit}", pod=~"{pod_alt_lit}"}}"#);

    // Append line filter — substring uses `|=`, regex uses `|~`.
    let logql = if let Some(q) = search.filter(|s| !s.is_empty()) {
        let escaped = q.replace('\\', "\\\\").replace('"', "\\\"");
        match mode {
            SearchMode::Substring => format!(r#"{selector} |= "{escaped}""#),
            SearchMode::Regex    => format!(r#"{selector} |~ "{escaped}""#),
        }
    } else {
        selector
    };

    let url = format!("{loki_base}/loki/api/v1/query_range");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| anyhow::anyhow!("loki client build: {e}"))?;

    let resp = client
        .get(&url)
        .query(&[
            ("query", logql.as_str()),
            ("start", &range.start_ns.to_string()),
            ("end", &range.end_ns.to_string()),
            ("limit", &limit.to_string()),
            ("direction", "backward"),
        ])
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("loki unreachable: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!("loki returned HTTP {status}: {body}").into());
    }

    let loki_resp: LokiResponse = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("loki parse error: {e}"))?;

    if loki_resp.status != "success" {
        let msg = loki_resp.message.unwrap_or_else(|| "unknown".to_string());
        return Err(anyhow::anyhow!("loki error: {msg}").into());
    }

    if loki_resp.data.result_type != "streams" {
        return Err(anyhow::anyhow!(
            "unexpected loki result type: {}",
            loki_resp.data.result_type
        )
        .into());
    }

    // Collect all (timestamp_ns, PodLog) pairs, then sort oldest-first.
    let mut entries: Vec<(i64, PodLog)> = Vec::new();

    for stream in loki_resp.data.result {
        let stream_container = stream
            .stream
            .get("container")
            .cloned()
            .unwrap_or_default();
        let stream_pod = stream
            .stream
            .get("pod")
            .cloned()
            .unwrap_or_default();
        let stream_ns = stream
            .stream
            .get("namespace")
            .cloned()
            .unwrap_or_else(|| namespace.to_string());

        for (ns_str, line) in stream.values {
            let ts_ns: i64 = ns_str.parse().unwrap_or(0);
            let timestamp = if ts_ns > 0 {
                let secs = ts_ns / 1_000_000_000;
                let nanos = (ts_ns % 1_000_000_000) as u32;
                Utc.timestamp_opt(secs, nanos).single()
            } else {
                None
            };

            entries.push((
                ts_ns,
                PodLog {
                    pod: stream_pod.clone(),
                    namespace: stream_ns.clone(),
                    container: stream_container.clone(),
                    timestamp,
                    message: line,
                },
            ));
        }
    }

    // Sort oldest-first (ascending timestamp_ns)
    entries.sort_unstable_by_key(|(ts, _)| *ts);

    Ok(entries.into_iter().map(|(_, log)| log).collect())
}
