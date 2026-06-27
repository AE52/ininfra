//! Wire DTOs.
//!
//! These structs are the Rust side of the `@ininfra/shared-types` contract.
//! They MUST serialize to exactly the shapes in
//! `packages/shared-types/src/index.ts` (camelCase JSON, `T | null` for
//! optionals, RFC3339 timestamps, k8s quantities as strings).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// RFC3339 / ISO-8601 UTC timestamp (rendered as a string on the wire).
pub type Timestamp = chrono::DateTime<chrono::Utc>;

/* ------------------------------------------------------------------ */
/* Public runtime config (GET /api/config)                             */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub ecr: bool,
    pub jenkins: bool,
    pub gateway: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub product_name: String,
    pub cluster_name: String,
    pub managed_namespaces: Vec<String>,
    pub features: Features,
}

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HealthStatus {
    Healthy,
    Progressing,
    Degraded,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EnvSource {
    Configmap,
    Secret,
    Inline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BuildStatus {
    Queued,
    Running,
    Success,
    Failure,
    Aborted,
    Unknown,
}

/// Audited action verbs. Serializes to the `AuditAction` union in shared-types
/// and is stored verbatim in `audit_log.action`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditAction {
    View,
    Scale,
    Restart,
    EditEnv,
    TriggerBuild,
    DeletePod,
    Rollback,
    Login,
    ChangeBranch,
    EditHpa,
    CreateUser,
    UpdateUser,
    DeleteUser,
    WriteFile,
    DeleteFile,
    DeleteImage,
    EditGateway,
    EditRbac,
    CordonNode,
    RevealSecret,
    SuspendCronJob,
    TriggerJob,
}

impl AuditAction {
    /// The exact string stored in the DB / emitted on the wire.
    pub fn as_str(&self) -> &'static str {
        match self {
            AuditAction::View => "view",
            AuditAction::Scale => "scale",
            AuditAction::Restart => "restart",
            AuditAction::EditEnv => "edit_env",
            AuditAction::TriggerBuild => "trigger_build",
            AuditAction::DeletePod => "delete_pod",
            AuditAction::Rollback => "rollback",
            AuditAction::Login => "login",
            AuditAction::ChangeBranch => "change_branch",
            AuditAction::EditHpa => "edit_hpa",
            AuditAction::CreateUser => "create_user",
            AuditAction::UpdateUser => "update_user",
            AuditAction::DeleteUser => "delete_user",
            AuditAction::WriteFile => "write_file",
            AuditAction::DeleteFile => "delete_file",
            AuditAction::DeleteImage => "delete_image",
            AuditAction::EditGateway => "edit_gateway",
            AuditAction::EditRbac => "edit_rbac",
            AuditAction::CordonNode => "cordon_node",
            AuditAction::RevealSecret => "reveal_secret",
            AuditAction::SuspendCronJob => "suspend_cronjob",
            AuditAction::TriggerJob => "trigger_job",
        }
    }
}

/* ------------------------------------------------------------------ */
/* Workloads                                                           */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub name: String,
    pub namespace: String,
    pub image: String,
    pub health: HealthStatus,
    pub replicas_desired: i32,
    pub replicas_ready: i32,
    pub ports: Vec<ServicePort>,
    pub url: Option<String>,
    pub created_at: Timestamp,
    pub labels: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePort {
    pub name: Option<String>,
    pub port: i32,
    /// `number | string` on the wire — k8s targetPort may be a named port.
    pub target_port: serde_json::Value,
    pub protocol: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub name: String,
    pub namespace: String,
    pub image: String,
    pub health: HealthStatus,
    pub replicas_desired: i32,
    pub replicas_ready: i32,
    pub replicas_updated: i32,
    pub replicas_available: i32,
    pub strategy: String,
    pub resources: ResourceRequirements,
    pub containers: Vec<ContainerSpec>,
    pub conditions: Vec<DeploymentCondition>,
    pub config_map_refs: Vec<String>,
    pub secret_refs: Vec<String>,
    pub created_at: Timestamp,
    pub annotations: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerSpec {
    pub name: String,
    pub image: String,
    pub resources: ResourceRequirements,
    pub ports: Vec<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRequirements {
    pub requests_cpu: Option<String>,
    pub requests_memory: Option<String>,
    pub limits_cpu: Option<String>,
    pub limits_memory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentCondition {
    #[serde(rename = "type")]
    pub type_: String,
    pub status: String,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub last_transition_time: Option<Timestamp>,
}

/* ------------------------------------------------------------------ */
/* Pods & logs                                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodSummary {
    pub name: String,
    pub namespace: String,
    pub phase: String,
    pub ready: bool,
    pub container_ready: String,
    pub restarts: i32,
    pub node: Option<String>,
    pub pod_ip: Option<String>,
    pub owner_ref: Option<String>,
    pub started_at: Option<Timestamp>,
    pub containers: Vec<String>,
    /// Live CPU usage summed across containers (metrics-server). `None` when
    /// metrics are unavailable. Format: millicores string, e.g. "42m".
    pub usage_cpu: Option<String>,
    /// Live memory usage summed across containers (metrics-server). `None` when
    /// metrics are unavailable. Format: kibibytes string, e.g. "65536Ki".
    pub usage_memory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PodLog {
    pub pod: String,
    pub namespace: String,
    pub container: String,
    pub timestamp: Option<Timestamp>,
    pub message: String,
}

/* ------------------------------------------------------------------ */
/* Environment                                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    pub source: EnvSource,
    pub source_name: Option<String>,
    pub masked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvBundle {
    pub namespace: String,
    pub workload: String,
    pub config_maps: Vec<EnvObject>,
    pub secrets: Vec<EnvObject>,
    /// Inline literal `env:` entries (read-only).
    pub inline: Vec<EnvVar>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvObject {
    pub name: String,
    pub source: EnvSource,
    pub data: Vec<EnvVar>,
    pub resource_version: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvPatch {
    pub source: EnvSource,
    pub name: String,
    pub resource_version: String,
    pub data: BTreeMap<String, String>,
}

/* ------------------------------------------------------------------ */
/* Builds                                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildJob {
    pub job: String,
    pub number: Option<i64>,
    pub status: BuildStatus,
    #[serde(rename = "ref")]
    pub ref_: Option<String>,
    /// Commit SHA the run built (the Argo workflow's `sha` parameter), so the UI
    /// can show/link which commit a build came from. `None` if not resolvable.
    pub sha: Option<String>,
    pub triggered_by: String,
    pub started_at: Option<Timestamp>,
    pub finished_at: Option<Timestamp>,
    pub duration_ms: Option<i64>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildTrigger {
    pub job: String,
    #[serde(rename = "ref", default)]
    pub ref_: Option<String>,
    #[serde(default)]
    pub params: BTreeMap<String, String>,
}

/// Request body for submitting an Argo `cicd` build run.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildSubmit {
    /// GitHub repo in `owner/name` form.
    pub repo: String,
    /// Branch to build (must be the service's active catalog branch to deploy).
    pub branch: String,
    /// Commit SHA to build.
    pub sha: String,
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub name: String,
    pub ready: bool,
    pub instance_type: Option<String>,
    pub kubelet_version: String,
    pub zone: Option<String>,
    pub capacity_cpu: String,
    pub capacity_memory: String,
    pub allocatable_cpu: String,
    pub allocatable_memory: String,
    /// Live usage from metrics-server (metrics.k8s.io). `None` when metrics are
    /// unavailable (e.g. metrics-server down or not yet scraped).
    pub usage_cpu: Option<String>,
    pub usage_memory: Option<String>,
    pub pod_count: i32,
    pub taints: Vec<String>,
    pub created_at: Timestamp,
    /// True when this node was provisioned as a spot/preemptible instance.
    pub spot: bool,
    /// Provisioning capacity type: "spot" | "on-demand" | "unknown".
    pub capacity_type: String,
    /// True when the node is cordoned (`spec.unschedulable`): the scheduler will
    /// not place new pods on it. Operators toggle this via the cordon endpoint.
    pub unschedulable: bool,
}

/// Detail view for a single node: the node itself plus every pod currently
/// scheduled on it (across all namespaces), enriched with system info,
/// conditions, addresses, AMI/nodegroup, structured taints, and the sum of
/// resource requests/limits of all scheduled pods.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDetail {
    pub node: NodeInfo,
    pub pods: Vec<PodSummary>,
    pub conditions: Vec<NodeCondition>,
    pub system_info: NodeSystemInfo,
    pub internal_ip: Option<String>,
    pub external_ip: Option<String>,
    pub provider_id: Option<String>,
    pub ami: Option<String>,
    pub nodegroup: Option<String>,
    pub taints_detail: Vec<NodeTaint>,
    pub allocated: ResourceAllocation,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeCondition {
    #[serde(rename = "type")]
    pub type_: String,
    pub status: String,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub last_transition_time: Option<Timestamp>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeTaint {
    pub key: String,
    pub value: Option<String>,
    pub effect: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeSystemInfo {
    pub os_image: String,
    pub kernel_version: String,
    pub container_runtime: String,
    pub architecture: String,
    pub operating_system: String,
    pub kube_proxy_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceAllocation {
    pub requests_cpu: String,
    pub requests_memory: String,
    pub limits_cpu: String,
    pub limits_memory: String,
}

/* ------------------------------------------------------------------ */
/* Right-sizing (advisory; read-only)                                  */
/* ------------------------------------------------------------------ */

/// Advisory verdict for one workload, derived conservatively from configured
/// requests/limits vs. live per-replica usage. Never auto-applied.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RightsizingRecommendation {
    /// Live usage well below requests — requests can likely be lowered.
    OverProvisioned,
    /// Live usage near/over limits — throttle/OOM risk; consider raising.
    UnderProvisioned,
    /// No CPU/memory requests set at all — the scheduler is flying blind.
    NoRequests,
    /// Requests look appropriate for current usage.
    Ok,
    /// Metrics unavailable, so no recommendation could be computed.
    Unknown,
}

/// One row of the right-sizing advisory: a Deployment or StatefulSet with its
/// configured requests/limits (summed per replica across containers) next to
/// live aggregate usage from metrics-server, plus an advisory flag.
///
/// All CPU figures are millicores; all memory figures are MiB. Request/limit
/// fields are `None` when that resource is unset on every container. Usage
/// fields are `None` when metrics-server is absent (`metrics_available=false`),
/// in which case the row degrades to a requests/limits-only view with no flag.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RightsizingRow {
    pub namespace: String,
    pub name: String,
    /// "Deployment" | "StatefulSet".
    pub kind: String,
    pub replicas: i32,
    /// Per-replica CPU requests (millicores), summed across containers.
    pub requests_cpu_m: Option<i64>,
    /// Per-replica CPU limits (millicores), summed across containers.
    pub limits_cpu_m: Option<i64>,
    /// Per-replica memory requests (MiB), summed across containers.
    pub requests_mem_mi: Option<i64>,
    /// Per-replica memory limits (MiB), summed across containers.
    pub limits_mem_mi: Option<i64>,
    /// Total live CPU usage (millicores) across the workload's pods; `None`
    /// when metrics are unavailable.
    pub usage_cpu_m: Option<i64>,
    /// Total live memory usage (MiB) across the workload's pods; `None` when
    /// metrics are unavailable.
    pub usage_mem_mi: Option<i64>,
    /// Per-replica live CPU usage (millicores): total usage / running pods.
    pub usage_cpu_m_per_replica: Option<i64>,
    /// Per-replica live memory usage (MiB): total usage / running pods.
    pub usage_mem_mi_per_replica: Option<i64>,
    /// True when at least one matching PodMetrics object was found for this
    /// workload (i.e. metrics-server is present and has scraped the pods).
    pub metrics_available: bool,
    pub recommendation: RightsizingRecommendation,
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub id: String,
    pub ts: Timestamp,
    pub actor: String,
    pub action: String,
    pub target_ns: Option<String>,
    pub target_kind: Option<String>,
    pub target_name: Option<String>,
    pub detail: serde_json::Value,
}

/* ------------------------------------------------------------------ */
/* Mutation bodies & envelopes                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleRequest {
    pub replicas: i32,
}

/// POST body for cordoning/uncordoning a node. `true` cordons (marks the node
/// unschedulable), `false` uncordons it. One endpoint covers both directions.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CordonRequest {
    pub unschedulable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationAck {
    pub ok: bool,
    pub audit_id: Option<String>,
    pub message: Option<String>,
}

impl MutationAck {
    pub fn ok(audit_id: Option<String>) -> Self {
        Self {
            ok: true,
            audit_id,
            message: None,
        }
    }
}

/// Read-only raw manifest of a live cluster object, rendered as a YAML string.
/// Server strips `metadata.managedFields` and the kubectl last-applied
/// annotation before rendering. Served by `GET /api/manifest/:kind/:ns/:name`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestResponse {
    pub yaml: String,
    pub kind: String,
    pub name: String,
    pub namespace: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<i64>,
}

impl<T> Page<T> {
    /// Page with no total count populated.
    pub fn new(items: Vec<T>, next_cursor: Option<String>) -> Self {
        Self { items, next_cursor, total: None }
    }

    /// Slice an already-materialized list into a page using a simple opaque
    /// offset cursor. Suitable for k8s-backed lists (bounded sizes). `limit`
    /// defaults to 50, clamped to [1, 500]. The cursor is the next offset as a
    /// decimal string; `total` is always populated.
    pub fn offset(items: Vec<T>, cursor: Option<&str>, limit: Option<i64>) -> Self {
        let total = items.len() as i64;
        let offset = cursor.and_then(|c| c.parse::<usize>().ok()).unwrap_or(0);
        let limit = limit.unwrap_or(50).clamp(1, 500) as usize;
        let page: Vec<T> = items.into_iter().skip(offset).take(limit).collect();
        let next_cursor = if (offset + page.len() as usize) < total as usize {
            Some((offset + limit).to_string())
        } else {
            None
        };
        Self { items: page, next_cursor, total: Some(total) }
    }
}

/// Shared `?cursor=&limit=` query for paginated list endpoints.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct PageQuery {
    pub cursor: Option<String>,
    pub limit: Option<i64>,
}

/* ------------------------------------------------------------------ */
/* Users (console accounts)                                            */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub username: String,
    pub role: String,
    pub created_at: Timestamp,
    pub last_login: Option<Timestamp>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewUserRequest {
    pub username: String,
    pub password: String,
    pub role: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUserRequest {
    pub role: Option<String>,
    pub password: Option<String>,
}

/* ------------------------------------------------------------------ */
/* PVC file browser                                                    */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PvcFile {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: Option<i64>,
    pub mode: String,
    pub modified_at: Option<String>,
    pub link_target: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub size: i64,
    pub content: String,
    pub truncated: bool,
    pub binary: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileRequest {
    pub content: String,
}

/* ------------------------------------------------------------------ */
/* Deploy / release management                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionInfo {
    pub revision: i64,
    pub image_digest: Option<String>,
    pub image_tag: Option<String>,
    pub commit: Option<String>,
    pub created_at: Timestamp,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployInfo {
    pub namespace: String,
    pub workload: String,
    pub registry: Option<String>,
    pub repo: Option<String>,
    pub image_digest: Option<String>,
    pub image_tag: Option<String>,
    pub commit: Option<String>,
    pub repo_url: Option<String>,
    pub revision: Option<i64>,
    pub jenkins_job: String,
    pub revisions: Vec<RevisionInfo>,
    pub ecr_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EcrImage {
    pub digest: String,
    pub tags: Vec<String>,
    pub commit: Option<String>,
    pub pushed_at: Option<Timestamp>,
    pub size_bytes: Option<i64>,
    pub deployed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackRequest {
    pub revision: i64,
}

/* ------------------------------------------------------------------ */
/* Error tracking (Sentry-style)                                       */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub id: String,
    pub ts: Timestamp,
    pub username: Option<String>,
    pub source: String,
    pub method: Option<String>,
    pub path: Option<String>,
    pub status: Option<i32>,
    pub code: Option<String>,
    pub message: String,
    pub detail: serde_json::Value,
}

/* ------------------------------------------------------------------ */
/* Status page                                                         */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusComponent {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub status: HealthStatus,
    pub replicas_ready: i32,
    pub replicas_desired: i32,
    /// When the component entered its current status (last transition).
    pub since: Option<Timestamp>,
    /// Uptime fraction over the summary window (0..1).
    pub uptime: f64,
    /// True when the component is currently in an incident (degraded).
    pub ongoing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub status: String,
    pub started_at: Timestamp,
    pub ended_at: Option<Timestamp>,
    pub duration_ms: Option<i64>,
    pub ongoing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSummary {
    /// "operational" | "degraded" | "major_outage".
    pub overall: String,
    pub updated_at: Timestamp,
    /// Window (hours) the uptime/incidents cover.
    pub window_hours: i64,
    pub total: i32,
    pub healthy: i32,
    pub degraded: i32,
    pub components: Vec<StatusComponent>,
    pub incidents: Vec<Incident>,
}

/* ------------------------------------------------------------------ */
/* Search + favorites                                                  */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// "deployment" | "statefulset" | "pod" | "service" | "namespace" |
    /// "node" | "build" | "user".
    pub kind: String,
    pub namespace: Option<String>,
    pub name: String,
    /// Optional health/status verb for a badge.
    pub status: Option<String>,
    /// In-app link to open the resource.
    pub href: String,
    /// Optional secondary line (image, role, etc.).
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Favorite {
    pub id: String,
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub href: String,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewFavorite {
    pub kind: String,
    #[serde(default)]
    pub namespace: String,
    pub name: String,
    pub href: String,
}

/* ------------------------------------------------------------------ */
/* API gateway                                                         */
/* ------------------------------------------------------------------ */

/// One parsed gateway access-log line.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayLogEntry {
    pub ts: Option<Timestamp>,
    pub method: String,
    pub path: String,
    pub status: i32,
    pub upstream_status: Option<i32>,
    pub host: Option<String>,
    /// Real client IP (after the gateway resolves X-Forwarded-For via real_ip).
    pub client_ip: Option<String>,
    /// Raw X-Forwarded-For chain, for transparency / multi-hop debugging.
    pub xff: Option<String>,
    pub latency_ms: Option<i64>,
    pub upstream_addr: Option<String>,
    pub user_agent: Option<String>,
    pub bytes: Option<i64>,
    /// Correlation id assigned by the gateway (`$request_id`).
    pub request_id: Option<String>,
    /// Whether the request carried an Authorization header (value never logged).
    pub has_auth: Option<bool>,
    /// Resolved caller identity, decoded by the gateway from the JWT (never the
    /// token): user id, role id, and admin flag.
    pub x_user_id: Option<String>,
    pub x_role_id: Option<String>,
    pub is_admin: Option<bool>,
}

/// A persisted gateway error (5xx), for history.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayError {
    pub id: String,
    pub ts: Timestamp,
    pub method: String,
    pub path: String,
    pub status: i32,
    pub upstream_status: Option<i32>,
    pub host: Option<String>,
    pub client_ip: Option<String>,
    pub latency_ms: Option<i64>,
    pub upstream_addr: Option<String>,
    pub user_agent: Option<String>,
}

/// A persisted gateway access-log row (the sampled all-requests feed).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRequest {
    pub id: String,
    pub ts: Timestamp,
    pub method: String,
    pub path: String,
    pub status: i32,
    pub upstream_status: Option<i32>,
    pub host: Option<String>,
    pub client_ip: Option<String>,
    pub xff: Option<String>,
    pub latency_ms: Option<i64>,
    pub upstream_addr: Option<String>,
    pub user_agent: Option<String>,
    pub bytes: Option<i64>,
    pub request_id: Option<String>,
    pub has_auth: Option<bool>,
    pub x_user_id: Option<String>,
    pub x_role_id: Option<String>,
    pub is_admin: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigKey {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfig {
    pub namespace: String,
    pub deployment: String,
    pub config_map: String,
    pub resource_version: String,
    pub keys: Vec<GatewayConfigKey>,
}

/// PATCH body for the gateway config (optimistic concurrency).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigPatch {
    pub resource_version: String,
    pub data: BTreeMap<String, String>,
}

/// Browser-reported client error (`POST /api/errors`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientErrorReport {
    pub message: String,
    pub code: Option<String>,
    pub path: Option<String>,
    #[serde(default)]
    pub detail: serde_json::Value,
}

/* ------------------------------------------------------------------ */
/* Build catalog (deploy branch per service)                           */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildConfigService {
    pub name: String,
    pub repo: String,
    pub branch: String,
    pub enabled: bool,
    pub dockerfile_path: String,
    pub context_dir: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchChange {
    pub branch: String,
}

/* ------------------------------------------------------------------ */
/* HorizontalPodAutoscaler (autoscaling/v2)                            */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hpa {
    pub name: String,
    pub namespace: String,
    pub target_kind: String,
    pub target_name: String,
    pub min_replicas: i32,
    pub max_replicas: i32,
    pub current_replicas: i32,
    pub desired_replicas: i32,
    /// Target CPU utilization % (the first CPU Resource metric), if any.
    pub target_cpu: Option<i32>,
    /// Current CPU utilization % reported in status, if any.
    pub current_cpu: Option<i32>,
    pub created_at: Timestamp,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HpaPatch {
    pub min_replicas: Option<i32>,
    pub max_replicas: Option<i32>,
    pub target_cpu: Option<i32>,
}

/* ------------------------------------------------------------------ */
/* StatefulSets                                                        */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatefulSetSummary {
    pub name: String,
    pub namespace: String,
    pub image: String,
    pub health: HealthStatus,
    pub replicas_desired: i32,
    pub replicas_ready: i32,
    pub service_name: Option<String>,
    pub update_strategy: Option<String>,
    pub created_at: Timestamp,
}

/* ------------------------------------------------------------------ */
/* Jobs & CronJobs (batch/v1)                                          */
/* ------------------------------------------------------------------ */

/// Summary of a `batch/v1` CronJob.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CronJobSummary {
    pub namespace: String,
    pub name: String,
    /// Cron schedule expression, e.g. "*/5 * * * *".
    pub schedule: String,
    /// True when `spec.suspend` is set (the controller will not start new jobs).
    pub suspended: bool,
    pub last_schedule_time: Option<Timestamp>,
    pub last_successful_time: Option<Timestamp>,
    /// Number of currently active (running) Jobs owned by this CronJob.
    pub active_count: i32,
    /// Primary container image of the job template, when present.
    pub image: Option<String>,
}

/// Summary of a `batch/v1` Job. `status` is a rollup verb derived from the
/// Job's conditions/counts: "Complete" | "Failed" | "Running" | "Unknown".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub namespace: String,
    pub name: String,
    /// Owning CronJob name, when this Job was created by a CronJob.
    pub owner: Option<String>,
    /// Desired completions (`spec.completions`); null when unset (run-once).
    pub completions: Option<i32>,
    pub succeeded: i32,
    pub failed: i32,
    pub active: i32,
    pub start_time: Option<Timestamp>,
    pub completion_time: Option<Timestamp>,
    /// Wall-clock seconds from start to completion (completed jobs only).
    pub duration_seconds: Option<i64>,
    /// "Complete" | "Failed" | "Running" | "Unknown".
    pub status: String,
}

/// PATCH body for suspending/resuming a CronJob. `true` suspends (the controller
/// stops scheduling new Jobs), `false` resumes. One endpoint covers both.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuspendRequest {
    pub suspend: bool,
}

/// Response of `POST /api/cronjobs/:ns/:name/trigger` — the name of the Job that
/// was created from the CronJob's job template.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerJobAck {
    pub ok: bool,
    /// Name (`metadata.name`) of the newly created Job.
    pub job_name: String,
    pub audit_id: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventInfo {
    #[serde(rename = "type")]
    pub type_: String,
    pub reason: String,
    pub message: String,
    pub involved_kind: String,
    pub involved_name: String,
    pub count: i32,
    pub first_seen: Option<Timestamp>,
    pub last_seen: Option<Timestamp>,
    pub source: Option<String>,
}

/* ------------------------------------------------------------------ */
/* Describe (per-object events + status summary)                       */
/* ------------------------------------------------------------------ */

/// One status condition off a live object (`status.conditions[*]`).
/// Shared shape across deployment / statefulset / pod conditions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeCondition {
    #[serde(rename = "type")]
    pub type_: String,
    pub status: String,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub last_transition: Option<Timestamp>,
}

/// Per-container status (pods only) distilled from `status.containerStatuses[*]`.
/// `state` is a short verb ("running" / "waiting" / "terminated"); `reason`
/// carries the meaningful detail (e.g. "CrashLoopBackOff", "OOMKilled").
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeContainer {
    pub name: String,
    pub ready: bool,
    pub restart_count: i32,
    /// "running" | "waiting" | "terminated" | "unknown".
    pub state: String,
    pub reason: Option<String>,
    pub message: Option<String>,
}

/// Read-only "describe"-style summary for one object plus its recent events.
/// Served by `GET /api/describe/:kind/:ns/:name`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DescribeResponse {
    pub kind: String,
    pub namespace: String,
    pub name: String,
    pub conditions: Vec<DescribeCondition>,
    /// Populated for pods only; empty for deployments / statefulsets.
    pub containers: Vec<DescribeContainer>,
    pub events: Vec<EventInfo>,
}

/* ------------------------------------------------------------------ */
/* PersistentVolumeClaims                                              */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pvc {
    pub name: String,
    pub namespace: String,
    pub phase: String,
    pub capacity: Option<String>,
    pub storage_class: Option<String>,
    pub access_modes: Vec<String>,
    pub volume_name: Option<String>,
    pub used_by_pods: Vec<String>,
    pub created_at: Timestamp,
}

/* ------------------------------------------------------------------ */
/* Secrets health (TLS certificate expiry scanner)                      */
/* ------------------------------------------------------------------ */

/// Certificate metadata extracted from one `kubernetes.io/tls` Secret's
/// `tls.crt` (the leaf certificate). Served by `GET /api/secrets/health`.
///
/// SECURITY: this carries ONLY non-sensitive certificate metadata. The private
/// key (`tls.key`) is never read, and no raw certificate bytes are ever placed
/// on the wire — only the parsed subject/issuer/validity fields below.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertHealth {
    pub namespace: String,
    pub secret_name: String,
    /// Subject Common Name (CN), when present in the certificate subject.
    pub common_name: Option<String>,
    /// Issuer, rendered as the issuer DN string.
    pub issuer: Option<String>,
    /// Validity window start (notBefore). `None` when the cert could not be parsed.
    pub not_before: Option<Timestamp>,
    /// Validity window end (notAfter). `None` when the cert could not be parsed.
    pub not_after: Option<Timestamp>,
    /// Whole days until `notAfter` relative to now. Negative when already expired.
    /// `None` when the cert could not be parsed.
    pub days_remaining: Option<i64>,
    /// True when `notAfter` is in the past.
    pub expired: bool,
    /// Set when the `tls.crt` data was missing or could not be parsed; the row is
    /// still returned (degrade gracefully) so operators can spot the broken secret.
    pub parse_error: Option<String>,
}

/* ------------------------------------------------------------------ */
/* RBAC (role_permissions matrix)                                      */
/* ------------------------------------------------------------------ */

/// One cell in the permission matrix.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RbacCell {
    /// Effective value for this (role, key) combination.
    pub effective: bool,
    /// The override value stored in DB, or null if using the code default.
    pub override_val: Option<bool>,
}

/// One row in GET /api/rbac/permissions response.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RbacMatrixRow {
    pub key: String,
    pub category: String,
    pub label: String,
    pub mutating: bool,
    pub developer: RbacCell,
    pub admin: RbacCell,
    /// Super admin is always all-true and has no overrides.
    pub super_admin: RbacCell,
}

/// PATCH /api/rbac/permissions body.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RbacPatch {
    pub role: String,
    pub key: String,
    /// null = revert to code default (delete the override row).
    pub allowed: Option<bool>,
}
