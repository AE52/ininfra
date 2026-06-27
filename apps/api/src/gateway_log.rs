//! Parser for the gateway's access log, in two shapes:
//!
//! 1. **JSON** (preferred): APISIX is configured with a JSON `access_log_format`
//!    (`escape=json`), one object per line. Robust to spaces/quotes in paths and
//!    carries the real client IP (`remote_addr` after `real_ip` resolves
//!    X-Forwarded-For), the XFF chain, request id, and an Authorization-present
//!    flag (never the token value).
//! 2. **Positional** (fallback): the older nginx-style line, kept so the view
//!    keeps working across the config switch and for any gateway not yet
//!    reconfigured:
//!      <remote> - - [<time>] <host> "<method> <path> <proto>" <status> <bytes>
//!      <req_time> "<referer>" "<user_agent>" <upstream_addr> <upstream_status>
//!      <upstream_time> "<upstream_url>"
//!
//! Lines that fit neither shape are skipped (returns `None`).

use crate::dto::GatewayLogEntry;
use serde::Deserialize;

/// Split a log line into fields, treating `[...]` and `"..."` as single fields
/// (with the delimiters stripped).
fn tokenize(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(&c) = chars.peek() {
        if c.is_whitespace() {
            chars.next();
            continue;
        }
        let (open, close) = match c {
            '[' => ('[', ']'),
            '"' => ('"', '"'),
            _ => ('\0', '\0'),
        };
        if open != '\0' {
            chars.next(); // consume opener
            let mut s = String::new();
            while let Some(&d) = chars.peek() {
                chars.next();
                if d == close {
                    break;
                }
                s.push(d);
            }
            out.push(s);
        } else {
            let mut s = String::new();
            while let Some(&d) = chars.peek() {
                if d.is_whitespace() {
                    break;
                }
                s.push(d);
                chars.next();
            }
            out.push(s);
        }
    }
    out
}

fn opt(s: &str) -> Option<String> {
    if s.is_empty() || s == "-" {
        None
    } else {
        Some(s.to_string())
    }
}

/// JSON access-log shape (every value is logged as a string via `escape=json`,
/// so numbers are parsed here rather than relying on the logger emitting valid
/// JSON numbers — empty/`-` values would otherwise break a numeric field).
#[derive(Deserialize)]
struct JsonLine {
    time: Option<String>,
    remote_addr: Option<String>,
    xff: Option<String>,
    host: Option<String>,
    method: Option<String>,
    path: Option<String>,
    status: Option<String>,
    bytes: Option<String>,
    rt: Option<String>,
    ua: Option<String>,
    ua_addr: Option<String>,
    ustatus: Option<String>,
    req_id: Option<String>,
    auth: Option<String>,
    uid: Option<String>,
    rid: Option<String>,
    adm: Option<String>,
}

/// First non-`-`/non-empty IP in an X-Forwarded-For chain (left-most = original
/// client). Used as a fallback when `remote_addr` wasn't resolved by `real_ip`.
fn first_xff(xff: &str) -> Option<String> {
    xff.split(',').map(str::trim).find_map(|p| opt(p))
}

fn parse_json_line(line: &str) -> Option<GatewayLogEntry> {
    let j: JsonLine = serde_json::from_str(line).ok()?;
    let method = j.method.as_deref().and_then(opt)?;
    let path = j.path.as_deref().and_then(opt)?;
    let status: i32 = j.status.as_deref()?.trim().parse().ok()?;

    let ts = j
        .time
        .as_deref()
        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok())
        .map(|d| d.with_timezone(&chrono::Utc));
    let xff = j.xff.as_deref().and_then(opt);
    // Prefer the real_ip-resolved remote_addr; fall back to the left-most XFF.
    let client_ip = j
        .remote_addr
        .as_deref()
        .and_then(opt)
        .or_else(|| xff.as_deref().and_then(first_xff));
    let has_auth = j
        .auth
        .as_deref()
        .map(|a| matches!(a.trim(), "yes" | "1" | "true"));
    let is_admin = j
        .adm
        .as_deref()
        .and_then(opt)
        .map(|a| matches!(a.trim(), "true" | "1" | "yes"));

    Some(GatewayLogEntry {
        ts,
        method,
        path,
        status,
        upstream_status: j.ustatus.as_deref().and_then(|s| s.trim().parse().ok()),
        host: j.host.as_deref().and_then(opt),
        client_ip,
        xff,
        latency_ms: j
            .rt
            .as_deref()
            .and_then(|t| t.trim().parse::<f64>().ok())
            .map(|t| (t * 1000.0) as i64),
        upstream_addr: j.ua_addr.as_deref().and_then(opt),
        user_agent: j.ua.as_deref().and_then(opt),
        bytes: j.bytes.as_deref().and_then(|s| s.trim().parse().ok()),
        request_id: j.req_id.as_deref().and_then(opt),
        has_auth,
        x_user_id: j.uid.as_deref().and_then(opt),
        x_role_id: j.rid.as_deref().and_then(opt),
        is_admin,
    })
}

/// Parse one access-log line. `None` if it isn't a recognizable access line.
/// JSON lines (new format) take priority; anything else falls back to the
/// positional nginx parser.
pub fn parse_line(line: &str) -> Option<GatewayLogEntry> {
    let trimmed = line.trim_start();
    if trimmed.starts_with('{') {
        if let Some(e) = parse_json_line(trimmed) {
            return Some(e);
        }
    }
    parse_positional(line)
}

/// Legacy positional nginx-style access line.
fn parse_positional(line: &str) -> Option<GatewayLogEntry> {
    let f = tokenize(line);
    if f.len() < 13 {
        return None;
    }
    // f[5] = "METHOD path PROTO"
    let mut req = f[5].split_whitespace();
    let method = req.next()?.to_string();
    let path = req.next()?.to_string();
    if !method.chars().all(|c| c.is_ascii_uppercase()) {
        return None; // not a request line
    }
    let status: i32 = f[6].parse().ok()?;

    let ts = chrono::DateTime::parse_from_str(&f[3], "%d/%b/%Y:%H:%M:%S %z")
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc));
    let bytes = f[7].parse::<i64>().ok();
    let latency_ms = f[8].parse::<f64>().ok().map(|t| (t * 1000.0) as i64);
    let user_agent = f.get(10).and_then(|s| opt(s));
    let upstream_addr = f.get(11).and_then(|s| opt(s));
    let upstream_status = f.get(12).and_then(|s| s.parse::<i32>().ok());

    Some(GatewayLogEntry {
        ts,
        method,
        path,
        status,
        upstream_status,
        host: opt(&f[4]),
        client_ip: opt(&f[0]),
        xff: None,
        latency_ms,
        upstream_addr,
        user_agent,
        bytes,
        request_id: None,
        has_auth: None,
        x_user_id: None,
        x_role_id: None,
        is_admin: None,
    })
}

/// A 5xx at the gateway or its upstream.
pub fn is_5xx(e: &GatewayLogEntry) -> bool {
    e.status >= 500 || e.upstream_status.map(|s| s >= 500).unwrap_or(false)
}

use crate::config::GatewayTarget;
use crate::AppState;
use k8s_openapi::api::apps::v1::Deployment;
use k8s_openapi::api::core::v1::Pod;
use kube::api::{ListParams, LogParams};
use kube::Api;

/// Names of the pods backing the gateway deployment (via its selector).
pub async fn gateway_pod_names(st: &AppState, g: &GatewayTarget) -> Vec<String> {
    let deps: Api<Deployment> = Api::namespaced(st.kube.clone(), &g.namespace);
    let labels = match deps.get_opt(&g.deployment).await {
        Ok(Some(d)) => d
            .spec
            .and_then(|s| s.selector.match_labels)
            .unwrap_or_default(),
        _ => return Vec::new(),
    };
    let sel = labels
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join(",");
    let pods: Api<Pod> = Api::namespaced(st.kube.clone(), &g.namespace);
    let lp = if sel.is_empty() {
        ListParams::default()
    } else {
        ListParams::default().labels(&sel)
    };
    match pods.list(&lp).await {
        Ok(list) => list.items.into_iter().filter_map(|p| p.metadata.name).collect(),
        Err(_) => Vec::new(),
    }
}

/// Fetch recent access-log lines from all gateway pods (best-effort).
pub async fn fetch_lines(
    st: &AppState,
    g: &GatewayTarget,
    tail: i64,
    since_seconds: Option<i64>,
) -> Vec<String> {
    let pods: Api<Pod> = Api::namespaced(st.kube.clone(), &g.namespace);
    let mut out = Vec::new();
    for pod in gateway_pod_names(st, g).await {
        let mut lp = LogParams::default();
        lp.tail_lines = Some(tail);
        lp.since_seconds = since_seconds;
        if let Ok(s) = pods.logs(&pod, &lp).await {
            for l in s.lines() {
                out.push(l.to_string());
            }
        }
    }
    out
}
