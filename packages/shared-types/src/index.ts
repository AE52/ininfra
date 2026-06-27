/**
 * @ininfra/shared-types
 *
 * Canonical DTO contract shared between apps/api (Rust, via serde) and
 * apps/web (Next.js). These types are the SINGLE SOURCE OF TRUTH for the
 * wire format. The Rust structs in apps/api MUST serialize to exactly these
 * shapes (camelCase JSON). Build-phase agents must not diverge from this file
 * without updating the README contract and notifying the other apps.
 *
 * JSON conventions:
 *  - All field names are camelCase on the wire.
 *  - Timestamps are RFC3339 / ISO-8601 strings (UTC), e.g. "2026-06-21T10:30:00Z".
 *  - Kubernetes resource quantities are strings ("500m", "1Gi") to avoid
 *    float precision loss.
 *  - Optional fields are `T | null` (serde `Option<T>`), never omitted.
 */

/* ------------------------------------------------------------------ */
/* Primitives & enums                                                  */
/* ------------------------------------------------------------------ */

/** ISO-8601 / RFC3339 UTC timestamp string. */
export type Timestamp = string;

/**
 * A Kubernetes namespace the console operates on. The concrete set is runtime
 * configuration (see `AppConfig.managedNamespaces`), so this is just a string.
 */
export type Namespace = string;

/**
 * Public runtime configuration, served by `GET /api/config` (no auth required)
 * so the UI can render the cluster name, the managed-namespace list, and which
 * optional integrations are enabled — nothing here is deployment-specific in code.
 */
export interface AppConfig {
  /** Product/brand name shown in the UI (default "inInfra"). */
  productName: string;
  /** Human-friendly cluster name shown in the masthead/login. */
  clusterName: string;
  /** Namespaces the console may read/operate on. */
  managedNamespaces: string[];
  /** Optional integrations the backend has configured. */
  features: {
    /** ECR image inventory/delete + commit resolution (AWS creds present). */
    ecr: boolean;
    /** Jenkins build trigger/track. */
    jenkins: boolean;
    /** API-gateway logs + config editor (gateway target configured). */
    gateway: boolean;
  };
}

/** Rollout / workload health rollup. */
export type HealthStatus = "healthy" | "progressing" | "degraded" | "unknown";

/** Source of an env value. */
export type EnvSource = "configmap" | "secret" | "inline";

/** Lifecycle phase of a Jenkins-triggered build. */
export type BuildStatus =
  | "queued"
  | "running"
  | "success"
  | "failure"
  | "aborted"
  | "unknown";

/** Pod lifecycle phase (mirrors k8s Pod.status.phase plus our rollups). */
export type PodPhase =
  | "Pending"
  | "Running"
  | "Succeeded"
  | "Failed"
  | "Unknown";

/** Audited action verbs. Keep in sync with the Rust `Action` enum and DB. */
export type AuditAction =
  | "view"
  | "scale"
  | "restart"
  | "edit_env"
  | "trigger_build"
  | "delete_pod"
  | "rollback"
  | "login"
  | "change_branch"
  | "edit_hpa"
  | "create_user"
  | "update_user"
  | "delete_user"
  | "write_file"
  | "delete_file"
  | "delete_image"
  | "edit_gateway"
  | "edit_rbac"
  | "cordon_node"
  | "reveal_secret"
  | "suspend_cronjob"
  | "trigger_job";

/** Console access role. */
export type Role = "developer" | "admin" | "super_admin";

/* ------------------------------------------------------------------ */
/* First-run setup wizard                                              */
/* ------------------------------------------------------------------ */

/**
 * Public status of the first-run setup, served by `GET /api/setup/status`
 * (always available, no auth). The web app polls this on the login page to
 * funnel a fresh install to `/setup`, and the wizard reads it on mount.
 */
export interface SetupStatus {
  /** True when (!setupComplete || !hasAdmin) — the wizard must run. */
  needsSetup: boolean;
  /** True when any user with an admin-class role already exists. */
  hasAdmin: boolean;
  /** True once `POST /api/setup/complete` has succeeded. */
  setupComplete: boolean;
  /** Database reachability/migration state, surfaced for diagnostics. */
  db: {
    connected: boolean;
    migrated: boolean;
  };
  /** How the API connected to the cluster, detected at boot. */
  detectedClusterMode: "in-cluster" | "kubeconfig" | "unknown";
  /** Current effective product/brand name. */
  productName: string;
  /** Current effective cluster display name. */
  clusterName: string;
}

/** Response of `GET /api/setup/namespaces` — the cluster's namespaces. */
export interface SetupNamespacesResponse {
  namespaces: string[];
}

/** The optional integrations selected during setup. */
export interface SetupFeatures {
  jenkins: boolean;
  gateway: boolean;
  ecr: boolean;
}

/** The first admin account created during setup. */
export interface SetupAdmin {
  username: string;
  /** Plaintext on the wire (TLS only); hashed argon2id server-side. >= 8 chars. */
  password: string;
}

/** Body of `POST /api/setup/complete`. */
export interface SetupCompleteRequest {
  productName: string;
  clusterName: string;
  /** Namespaces the console will operate on. At least one is required. */
  managedNamespaces: string[];
  /** Namespace that runs CI/CD (Argo); null when not applicable. */
  cicdNamespace?: string | null;
  features: SetupFeatures;
  admin: SetupAdmin;
}

/* ------------------------------------------------------------------ */
/* Workloads                                                           */
/* ------------------------------------------------------------------ */

/** A logical service = a Deployment + its Service + summary health. */
export interface Service {
  name: string;
  namespace: Namespace;
  /** Image of the primary container, e.g. "registry/my-service:sha-abc123". */
  image: string;
  health: HealthStatus;
  replicasDesired: number;
  replicasReady: number;
  /** ClusterIP Service ports exposed, if any. */
  ports: ServicePort[];
  /** External URL if exposed via Ingress, else null. */
  url: string | null;
  createdAt: Timestamp;
  labels: Record<string, string>;
}

export interface ServicePort {
  name: string | null;
  port: number;
  targetPort: number | string;
  protocol: "TCP" | "UDP";
}

/** Detailed view of a single Deployment. */
export interface Deployment {
  name: string;
  namespace: Namespace;
  image: string;
  health: HealthStatus;
  replicasDesired: number;
  replicasReady: number;
  replicasUpdated: number;
  replicasAvailable: number;
  strategy: "RollingUpdate" | "Recreate";
  /** Current resource requests/limits of the primary container. */
  resources: ResourceRequirements;
  containers: ContainerSpec[];
  conditions: DeploymentCondition[];
  /** Names of the env-bearing ConfigMaps/Secrets referenced by this workload. */
  configMapRefs: string[];
  secretRefs: string[];
  createdAt: Timestamp;
  annotations: Record<string, string>;
}

export interface ContainerSpec {
  name: string;
  image: string;
  resources: ResourceRequirements;
  ports: number[];
}

export interface ResourceRequirements {
  requestsCpu: string | null;
  requestsMemory: string | null;
  limitsCpu: string | null;
  limitsMemory: string | null;
}

export interface DeploymentCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason: string | null;
  message: string | null;
  lastTransitionTime: Timestamp | null;
}

/* ------------------------------------------------------------------ */
/* Pods & logs                                                         */
/* ------------------------------------------------------------------ */

export interface PodSummary {
  name: string;
  namespace: Namespace;
  phase: PodPhase;
  ready: boolean;
  /** "2/2" style ready-containers indicator. */
  containerReady: string;
  restarts: number;
  node: string | null;
  podIp: string | null;
  /** Owning workload, e.g. "deployment/my-service". */
  ownerRef: string | null;
  startedAt: Timestamp | null;
  containers: string[];
  /** Live CPU usage summed across all containers (metrics-server). Null when
   *  metrics-server is unavailable. Format: millicores string e.g. "42m". */
  usageCpu: string | null;
  /** Live memory usage summed across all containers (metrics-server). Null when
   *  metrics-server is unavailable. Format: kibibytes string e.g. "65536Ki". */
  usageMemory: string | null;
}

/**
 * Read-only raw manifest of a live cluster object, served by
 * `GET /api/manifest/:kind/:ns/:name`. The server fetches the typed object,
 * strips `metadata.managedFields` and the kubectl last-applied-configuration
 * annotation, and renders it to a YAML string. `status` is kept (useful for
 * inspecting a live object). Supported kinds: deployment, statefulset, pod,
 * service, configmap.
 */
export interface ManifestResponse {
  /** The sanitized object rendered as YAML. */
  yaml: string;
  /** Lowercased kind that was fetched, e.g. "deployment". */
  kind: string;
  name: string;
  namespace: string;
}

/** A single streamed/queried log line for a pod container. */
export interface PodLog {
  pod: string;
  namespace: Namespace;
  container: string;
  /** Line timestamp if the source emitted one (k8s `timestamps=true`). */
  timestamp: Timestamp | null;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Environment (ConfigMaps + Secrets)                                  */
/* ------------------------------------------------------------------ */

/**
 * A single environment entry surfaced in the editor. For secrets the `value`
 * is masked unless the caller has reveal permission AND requested reveal.
 */
export interface EnvVar {
  key: string;
  value: string;
  source: EnvSource;
  /** Name of the backing ConfigMap/Secret, or null for inline. */
  sourceName: string | null;
  /** True when this is a Secret value and `value` is masked ("••••••"). */
  masked: boolean;
}

/** Editable bundle of env for a workload, grouped by backing object. */
export interface EnvBundle {
  namespace: Namespace;
  /** Workload these envs belong to (deployment name). */
  workload: string;
  configMaps: EnvObject[];
  secrets: EnvObject[];
  /**
   * Literal `env:` entries declared inline on the container (no ConfigMap/Secret
   * backing). Read-only — surfaced so the env view is complete.
   */
  inline: EnvVar[];
}

export interface EnvObject {
  name: string;
  source: Extract<EnvSource, "configmap" | "secret">;
  data: EnvVar[];
  resourceVersion: string;
}

/** PATCH body for an env edit (optimistic concurrency via resourceVersion). */
export interface EnvPatch {
  source: Extract<EnvSource, "configmap" | "secret">;
  name: string;
  resourceVersion: string;
  /** Full desired data map; server diffs against current. */
  data: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Builds (Jenkins)                                                    */
/* ------------------------------------------------------------------ */

export interface BuildJob {
  /** Repo built, owner/name form (carried in the workflow's `repo` param). */
  job: string;
  /** Unused for Argo runs (Workflows are identified by name, see `url`). */
  number: number | null;
  status: BuildStatus;
  /** Git branch built. */
  ref: string | null;
  /** Commit SHA the run built (Argo `sha` param); null if not resolvable. */
  sha: string | null;
  triggeredBy: string;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
  /** Duration in milliseconds, null while running/queued. */
  durationMs: number | null;
  /** Argo Workflow name — the build id used by getBuild/buildLogs. */
  url: string | null;
}

/** POST body to submit an Argo `cicd` build run. */
export interface BuildSubmit {
  /** GitHub repo in owner/name form. */
  repo: string;
  /** Branch to build (must be the service's active catalog branch to deploy). */
  branch: string;
  /** Commit SHA to build. */
  sha: string;
}

/* ------------------------------------------------------------------ */
/* Nodes                                                               */
/* ------------------------------------------------------------------ */

/** Node provisioning capacity type (EKS spot vs on-demand). */
export type CapacityType = "spot" | "on-demand" | "unknown";

export interface NodeInfo {
  name: string;
  ready: boolean;
  /** e.g. "m6i.xlarge". */
  instanceType: string | null;
  /** EKS / k8s version, e.g. "v1.30.2". */
  kubeletVersion: string;
  /** AZ, e.g. "eu-central-1a". */
  zone: string | null;
  /** Allocatable vs capacity for the headline resources. */
  capacityCpu: string;
  capacityMemory: string;
  allocatableCpu: string;
  allocatableMemory: string;
  /** Live usage from metrics-server; null when metrics are unavailable. */
  usageCpu: string | null;
  usageMemory: string | null;
  /** Pods currently scheduled on the node. */
  podCount: number;
  /** Taints summarized as "key=value:Effect". */
  taints: string[];
  createdAt: Timestamp;
  /** True when provisioned as a spot/preemptible instance. */
  spot: boolean;
  /** Provisioning capacity type derived from labels/taints. */
  capacityType: CapacityType;
  /** True when the node is cordoned (`spec.unschedulable`): the scheduler will
   *  not place new pods on it. Toggled via the cordon endpoint (admin only). */
  unschedulable: boolean;
}

/** One node status condition (mirrors k8s NodeCondition). */
export interface NodeCondition {
  type: string;
  status: string;
  reason: string | null;
  message: string | null;
  lastTransitionTime: Timestamp | null;
}

/** A structured node taint. */
export interface NodeTaint {
  key: string;
  value: string | null;
  effect: string;
}

/** Node OS / runtime info (mirrors k8s NodeSystemInfo subset). */
export interface NodeSystemInfo {
  osImage: string;
  kernelVersion: string;
  containerRuntime: string;
  architecture: string;
  operatingSystem: string;
  kubeProxyVersion: string;
}

/** Sum of resource requests/limits across all pods scheduled on a node. */
export interface ResourceAllocation {
  requestsCpu: string;
  requestsMemory: string;
  limitsCpu: string;
  limitsMemory: string;
}

/** Detail view for one node: the node plus every pod scheduled on it (all namespaces). */
export interface NodeDetail {
  node: NodeInfo;
  pods: PodSummary[];
  conditions: NodeCondition[];
  systemInfo: NodeSystemInfo;
  internalIp: string | null;
  externalIp: string | null;
  providerId: string | null;
  ami: string | null;
  nodegroup: string | null;
  taintsDetail: NodeTaint[];
  allocated: ResourceAllocation;
}

/* ------------------------------------------------------------------ */
/* Right-sizing (advisory; read-only)                                  */
/* ------------------------------------------------------------------ */

/**
 * Advisory verdict for one workload's resourcing, derived conservatively from
 * configured requests/limits vs. live per-replica usage. Never auto-applied.
 *
 * - `over_provisioned`  — usage well below requests (room to shrink).
 * - `under_provisioned` — usage near/over limits (throttle / OOM risk).
 * - `no_requests`       — no CPU/memory requests set at all.
 * - `ok`                — requests look appropriate.
 * - `unknown`           — metrics unavailable, so no verdict could be computed.
 */
export type RightsizingRecommendation =
  | "over_provisioned"
  | "under_provisioned"
  | "no_requests"
  | "ok"
  | "unknown";

/**
 * One row of the right-sizing advisory, served by `GET /api/rightsizing?ns=`.
 * A Deployment or StatefulSet with its configured requests/limits (summed per
 * replica across the pod template's containers) next to live aggregate usage
 * from metrics-server, plus an advisory flag.
 *
 * All CPU figures are millicores; all memory figures are MiB. Request/limit
 * fields are `null` when that resource is unset on every container. Usage
 * fields are `null` when metrics-server is absent (`metricsAvailable=false`),
 * in which case the row degrades to a requests/limits-only view with no flag.
 */
export interface RightsizingRow {
  namespace: Namespace;
  name: string;
  /** "Deployment" | "StatefulSet". */
  kind: string;
  replicas: number;
  /** Per-replica CPU requests (millicores), summed across containers. */
  requestsCpuM: number | null;
  /** Per-replica CPU limits (millicores), summed across containers. */
  limitsCpuM: number | null;
  /** Per-replica memory requests (MiB), summed across containers. */
  requestsMemMi: number | null;
  /** Per-replica memory limits (MiB), summed across containers. */
  limitsMemMi: number | null;
  /** Total live CPU usage (millicores) across the workload's pods; null when unavailable. */
  usageCpuM: number | null;
  /** Total live memory usage (MiB) across the workload's pods; null when unavailable. */
  usageMemMi: number | null;
  /** Per-replica live CPU usage (millicores): total / running pods. */
  usageCpuMPerReplica: number | null;
  /** Per-replica live memory usage (MiB): total / running pods. */
  usageMemMiPerReplica: number | null;
  /** True when metrics-server is present and has at least one sample for this workload's pods. */
  metricsAvailable: boolean;
  recommendation: RightsizingRecommendation;
}

/* ------------------------------------------------------------------ */
/* Cluster capacity & namespace quotas (read-only)                     */
/* ------------------------------------------------------------------ */

/**
 * Per-node capacity row, served as part of `GET /api/capacity`. Schedulable
 * `allocatable` next to the sum of pod container requests scheduled on the node,
 * plus live usage from metrics-server.
 *
 * All CPU figures are millicores; all memory figures are MiB. `usedCpuM`/
 * `usedMemMi` are `null` (and `metricsAvailable=false`) when this node has no
 * metrics-server sample.
 */
export interface CapacityNode {
  name: string;
  /** Schedulable CPU from `status.allocatable.cpu` (millicores). */
  allocatableCpuM: number;
  /** Schedulable memory from `status.allocatable.memory` (MiB). */
  allocatableMemMi: number;
  /** Sum of pod container CPU requests scheduled on this node (millicores). */
  requestedCpuM: number;
  /** Sum of pod container memory requests scheduled on this node (MiB). */
  requestedMemMi: number;
  /** Live CPU usage from metrics-server (millicores); null when unavailable. */
  usedCpuM: number | null;
  /** Live memory usage from metrics-server (MiB); null when unavailable. */
  usedMemMi: number | null;
  /** True when a metrics-server sample was found for this node. */
  metricsAvailable: boolean;
}

/**
 * Cluster-wide rollup summing every node, with schedulable headroom
 * (allocatable − requested). `usedCpuM`/`usedMemMi` are `null` when no node had
 * a metrics sample; `metricsAvailable` is true when at least one node reported.
 */
export interface CapacityCluster {
  allocatableCpuM: number;
  allocatableMemMi: number;
  requestedCpuM: number;
  requestedMemMi: number;
  usedCpuM: number | null;
  usedMemMi: number | null;
  /** Schedulable headroom: allocatable − requested (millicores). */
  headroomCpuM: number;
  /** Schedulable headroom: allocatable − requested (MiB). */
  headroomMemMi: number;
  metricsAvailable: boolean;
}

/** Response of `GET /api/capacity`. */
export interface CapacityResponse {
  nodes: CapacityNode[];
  cluster: CapacityCluster;
}

/**
 * One `(resource, used, hard)` triple off a ResourceQuota's status/spec. `used`
 * and `hard` are raw k8s quantity strings (e.g. "4", "8Gi"), parse with
 * cpuToCores / memToBytes / a plain number as appropriate.
 */
export interface QuotaResource {
  resource: string;
  used: string;
  hard: string;
}

/** One ResourceQuota in a namespace, with its per-resource used/hard rows. */
export interface QuotaInfo {
  namespace: Namespace;
  name: string;
  hard: QuotaResource[];
}

/**
 * One per-resource line of a LimitRange limit: the default request/limit a
 * container inherits, plus min/max bounds. All bounds are raw k8s quantity
 * strings; absent bounds are `null`.
 */
export interface LimitRangeItem {
  /** "Container" | "Pod" | "PersistentVolumeClaim". */
  type: string;
  /** Resource the bounds apply to (e.g. "cpu", "memory", "storage"). */
  resource: string;
  /** Default limit applied to a container that omits one. */
  default: string | null;
  /** Default request applied to a container that omits one. */
  defaultRequest: string | null;
  max: string | null;
  min: string | null;
}

/** One LimitRange in a namespace, flattened to per-(type, resource) rows. */
export interface LimitRangeInfo {
  name: string;
  limits: LimitRangeItem[];
}

/**
 * One namespace's quota/limit picture, served by `GET /api/quotas?ns=`. A
 * namespace with no ResourceQuota / LimitRange has empty vectors.
 */
export interface NamespaceQuota {
  namespace: Namespace;
  quotas: QuotaInfo[];
  limitRanges: LimitRangeInfo[];
}

/* ------------------------------------------------------------------ */
/* Audit                                                               */
/* ------------------------------------------------------------------ */

export interface AuditEntry {
  id: string;
  ts: Timestamp;
  actor: string;
  action: AuditAction;
  targetNs: Namespace | null;
  targetKind: string | null;
  targetName: string | null;
  /** Free-form structured context (diff, replica counts, build ref, ...). */
  detail: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Mutation request bodies                                             */
/* ------------------------------------------------------------------ */

/** PATCH body to scale a deployment. */
export interface ScaleRequest {
  replicas: number;
}

/**
 * POST body to cordon/uncordon a node (admin only). `true` cordons (marks the
 * node unschedulable), `false` uncordons. One endpoint covers both directions.
 */
export interface CordonRequest {
  unschedulable: boolean;
}

/** Generic accepted/queued ack returned by mutating endpoints. */
export interface MutationAck {
  ok: boolean;
  /** Correlated audit entry id, for client-side linking. */
  auditId: string | null;
  message: string | null;
}

/* ------------------------------------------------------------------ */
/* Transport envelopes                                                 */
/* ------------------------------------------------------------------ */

/** Standard error envelope returned for any non-2xx (see README contract). */
export interface ApiError {
  error: {
    code: string;
    message: string;
    /** Optional machine-readable details. */
    details: Record<string, unknown> | null;
  };
}

/** Cursor-paginated list envelope. */
export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page, null when exhausted. */
  nextCursor: string | null;
  /** Total number of items across all pages, when cheaply known (else null). */
  total?: number | null;
}

/* ------------------------------------------------------------------ */
/* Users (console accounts)                                            */
/* ------------------------------------------------------------------ */

/** A console user account. Never carries the password hash. */
export interface User {
  id: string;
  username: string;
  role: Role;
  createdAt: string;
  lastLogin: string | null;
}

/** Create-user body (admin only). */
export interface NewUserRequest {
  username: string;
  password: string;
  role: Role;
}

/** Patch-user body (admin only): change role and/or reset password. */
export interface UpdateUserRequest {
  role?: Role;
  password?: string;
}

/* ------------------------------------------------------------------ */
/* PVC file browser                                                    */
/* ------------------------------------------------------------------ */

export type FileKind = "file" | "dir" | "symlink" | "other";

/** One entry in a PVC directory listing. */
export interface PvcFile {
  name: string;
  /** Path relative to the volume mount root, always starting with "/". */
  path: string;
  kind: FileKind;
  /** Size in bytes (files only; null for dirs). */
  size: number | null;
  /** Octal-ish mode string from `ls -l`, e.g. "-rw-r--r--". */
  mode: string;
  modifiedAt: string | null;
  /** Symlink target, when kind === "symlink". */
  linkTarget: string | null;
}

/** Contents of a single text file inside a PVC. */
export interface FileContent {
  path: string;
  size: number;
  content: string;
  /** True when the file exceeded the read cap and `content` is partial. */
  truncated: boolean;
  /** True when the file looked binary and was not returned as text. */
  binary: boolean;
}

/** Write-file body (admin only). */
export interface WriteFileRequest {
  content: string;
}

/* ------------------------------------------------------------------ */
/* Deploy / release management (per service)                           */
/* ------------------------------------------------------------------ */

/** One rollout revision of a Deployment (from its ReplicaSet history). */
export interface RevisionInfo {
  revision: number;
  imageDigest: string | null;
  imageTag: string | null;
  /** Git short SHA parsed from the image tag, when present. */
  commit: string | null;
  createdAt: string;
  /** True for the revision currently serving. */
  current: boolean;
}

/** Deploy/release state for a workload. */
export interface DeployInfo {
  namespace: Namespace;
  workload: string;
  /** ECR registry host, e.g. <acct>.dkr.ecr.<region>.amazonaws.com. */
  registry: string | null;
  /** ECR repository name parsed from the running image. */
  repo: string | null;
  imageDigest: string | null;
  imageTag: string | null;
  commit: string | null;
  /** GitHub repo URL from the build catalog, if known. */
  repoUrl: string | null;
  /** Deployment revision number currently serving. */
  revision: number | null;
  /** Jenkins job used to (re)build this service. */
  jenkinsJob: string;
  revisions: RevisionInfo[];
  /** Whether the API has ECR access configured (enables commit + images). */
  ecrEnabled: boolean;
}

/** One image in an ECR repository. */
export interface EcrImage {
  digest: string;
  tags: string[];
  /** Git short SHA parsed from a tag, when present. */
  commit: string | null;
  pushedAt: string | null;
  sizeBytes: number | null;
  /** True when this digest is currently deployed (delete is blocked). */
  deployed: boolean;
}

/** Rollback body — target a prior Deployment revision. */
export interface RollbackRequest {
  revision: number;
}

/* ------------------------------------------------------------------ */
/* Error tracking (Sentry-style)                                       */
/* ------------------------------------------------------------------ */

export type ErrorSource = "server" | "client";

/** A captured error: a failed request or a browser-reported JS error. */
export interface ErrorEvent {
  id: string;
  ts: string;
  /** The user who hit it, or null if unauthenticated. */
  username: string | null;
  source: ErrorSource;
  method: string | null;
  path: string | null;
  status: number | null;
  code: string | null;
  message: string;
  detail: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Status page                                                         */
/* ------------------------------------------------------------------ */

export type OverallStatus = "operational" | "degraded" | "major_outage";

export interface StatusComponent {
  kind: string;
  namespace: string;
  name: string;
  status: HealthStatus;
  replicasReady: number;
  replicasDesired: number;
  /** When the component entered its current status. */
  since: string | null;
  /** Uptime fraction over the window (0..1). */
  uptime: number;
  /** Currently in an incident (degraded). */
  ongoing: boolean;
}

export interface Incident {
  kind: string;
  namespace: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  ongoing: boolean;
}

export interface StatusSummary {
  overall: OverallStatus;
  updatedAt: string;
  windowHours: number;
  total: number;
  healthy: number;
  degraded: number;
  components: StatusComponent[];
  incidents: Incident[];
}

/* ------------------------------------------------------------------ */
/* Search + favorites                                                  */
/* ------------------------------------------------------------------ */

export type SearchKind =
  | "deployment"
  | "statefulset"
  | "pod"
  | "service"
  | "namespace"
  | "node"
  | "build"
  | "user";

export interface SearchResult {
  kind: SearchKind;
  namespace: string | null;
  name: string;
  status: string | null;
  href: string;
  detail: string | null;
}

export interface Favorite {
  id: string;
  kind: string;
  namespace: string;
  name: string;
  href: string;
  createdAt: string;
}

/** Add-favorite body. */
export interface NewFavorite {
  kind: string;
  namespace?: string;
  name: string;
  href: string;
}

/* ------------------------------------------------------------------ */
/* API gateway                                                         */
/* ------------------------------------------------------------------ */

/** A parsed gateway access-log line. */
export interface GatewayLogEntry {
  ts: string | null;
  method: string;
  path: string;
  status: number;
  upstreamStatus: number | null;
  host: string | null;
  /** Real client IP (after the gateway resolves X-Forwarded-For). */
  clientIp: string | null;
  /** Raw X-Forwarded-For chain. */
  xff: string | null;
  latencyMs: number | null;
  upstreamAddr: string | null;
  userAgent: string | null;
  bytes: number | null;
  /** Correlation id assigned by the gateway. */
  requestId: string | null;
  /** Whether the request carried an Authorization header (value never logged). */
  hasAuth: boolean | null;
  /** Caller identity decoded by the gateway from the JWT (never the token). */
  xUserId: string | null;
  xRoleId: string | null;
  isAdmin: boolean | null;
}

/** A persisted gateway 5xx error. */
export interface GatewayError {
  id: string;
  ts: string;
  method: string;
  path: string;
  status: number;
  upstreamStatus: number | null;
  host: string | null;
  clientIp: string | null;
  latencyMs: number | null;
  upstreamAddr: string | null;
  userAgent: string | null;
}

/** A persisted, sampled gateway access-log row (the all-requests feed). */
export interface GatewayRequest {
  id: string;
  ts: string;
  method: string;
  path: string;
  status: number;
  upstreamStatus: number | null;
  host: string | null;
  clientIp: string | null;
  xff: string | null;
  latencyMs: number | null;
  upstreamAddr: string | null;
  userAgent: string | null;
  bytes: number | null;
  requestId: string | null;
  hasAuth: boolean | null;
  xUserId: string | null;
  xRoleId: string | null;
  isAdmin: boolean | null;
}

export interface GatewayConfigKey {
  key: string;
  value: string;
}

export interface GatewayConfig {
  namespace: string;
  deployment: string;
  configMap: string;
  resourceVersion: string;
  keys: GatewayConfigKey[];
}

/** PATCH body for the gateway config (optimistic concurrency). */
export interface GatewayConfigPatch {
  resourceVersion: string;
  data: Record<string, string>;
}

/** Browser-reported client error (POST /api/errors). */
export interface ClientErrorReport {
  message: string;
  code?: string;
  path?: string;
  detail?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Build catalog (deploy branch per service)                          */
/* ------------------------------------------------------------------ */

export interface BuildConfigService {
  name: string;
  repo: string;
  branch: string;
  enabled: boolean;
  dockerfilePath: string;
  contextDir: string;
}

/** PATCH body to change a service's deploy branch. */
export interface BranchChange {
  branch: string;
}

/* ------------------------------------------------------------------ */
/* HorizontalPodAutoscaler                                            */
/* ------------------------------------------------------------------ */

export interface Hpa {
  name: string;
  namespace: string;
  targetKind: string;
  targetName: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  desiredReplicas: number;
  /** Target CPU utilization %, if a CPU metric is configured. */
  targetCpu: number | null;
  /** Current CPU utilization % from status, if reported. */
  currentCpu: number | null;
  createdAt: Timestamp;
}

/** PATCH body for an HPA — any subset. */
export interface HpaPatch {
  minReplicas?: number;
  maxReplicas?: number;
  targetCpu?: number;
}

/* ------------------------------------------------------------------ */
/* StatefulSets                                                       */
/* ------------------------------------------------------------------ */

export interface StatefulSetSummary {
  name: string;
  namespace: string;
  image: string;
  health: HealthStatus;
  replicasDesired: number;
  replicasReady: number;
  serviceName: string | null;
  updateStrategy: string | null;
  createdAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Jobs & CronJobs (batch/v1)                                         */
/* ------------------------------------------------------------------ */

/** Rollup status verb for a Job. */
export type JobStatus = "Complete" | "Failed" | "Running" | "Unknown";

/** Summary of a `batch/v1` CronJob. */
export interface CronJobSummary {
  namespace: string;
  name: string;
  /** Cron schedule expression, e.g. "*\/5 * * * *". */
  schedule: string;
  /** True when `spec.suspend` is set (the controller won't start new jobs). */
  suspended: boolean;
  lastScheduleTime: Timestamp | null;
  lastSuccessfulTime: Timestamp | null;
  /** Number of currently active (running) Jobs owned by this CronJob. */
  activeCount: number;
  /** Primary container image of the job template, when present. */
  image: string | null;
}

/** Summary of a `batch/v1` Job. */
export interface JobSummary {
  namespace: string;
  name: string;
  /** Owning CronJob name, when this Job was created by a CronJob. */
  owner: string | null;
  /** Desired completions (`spec.completions`); null when unset (run-once). */
  completions: number | null;
  succeeded: number;
  failed: number;
  active: number;
  startTime: Timestamp | null;
  completionTime: Timestamp | null;
  /** Wall-clock seconds from start to completion (completed jobs only). */
  durationSeconds: number | null;
  status: JobStatus;
}

/**
 * PATCH body for suspending/resuming a CronJob. `true` suspends (the controller
 * stops scheduling new Jobs), `false` resumes. One endpoint covers both.
 */
export interface SuspendRequest {
  suspend: boolean;
}

/** Response of `POST /api/cronjobs/:ns/:name/trigger` — the created Job's name. */
export interface TriggerJobAck {
  ok: boolean;
  /** Name (`metadata.name`) of the newly created Job. */
  jobName: string;
  auditId: string | null;
}

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

export interface EventInfo {
  type: string;
  reason: string;
  message: string;
  involvedKind: string;
  involvedName: string;
  count: number;
  firstSeen: Timestamp | null;
  lastSeen: Timestamp | null;
  source: string | null;
}

/* ------------------------------------------------------------------ */
/* Describe (per-object events + status summary)                      */
/* ------------------------------------------------------------------ */

/** One status condition off a live object (`status.conditions[*]`). */
export interface DescribeCondition {
  type: string;
  status: string;
  reason: string | null;
  message: string | null;
  lastTransition: Timestamp | null;
}

/**
 * Per-container status (pods only). `state` is a short verb
 * ("running" | "waiting" | "terminated" | "unknown"); `reason` carries the
 * meaningful detail (e.g. "CrashLoopBackOff", "OOMKilled").
 */
export interface DescribeContainer {
  name: string;
  ready: boolean;
  restartCount: number;
  state: string;
  reason: string | null;
  message: string | null;
}

/**
 * Read-only "describe"-style summary for one object plus its recent events.
 * Served by `GET /api/describe/:kind/:ns/:name` (kind ∈ deployment | statefulset | pod).
 */
export interface DescribeResponse {
  kind: string;
  namespace: string;
  name: string;
  conditions: DescribeCondition[];
  /** Populated for pods only; empty for deployments / statefulsets. */
  containers: DescribeContainer[];
  events: EventInfo[];
}

/* ------------------------------------------------------------------ */
/* PersistentVolumeClaims                                             */
/* ------------------------------------------------------------------ */

export interface Pvc {
  name: string;
  namespace: string;
  phase: string;
  capacity: string | null;
  storageClass: string | null;
  accessModes: string[];
  volumeName: string | null;
  usedByPods: string[];
  createdAt: Timestamp;
}

/* ------------------------------------------------------------------ */
/* Secrets health (TLS certificate expiry scanner)                     */
/* ------------------------------------------------------------------ */

/**
 * Certificate metadata for one `kubernetes.io/tls` Secret, served by
 * `GET /api/secrets/health?ns=`. Sorted soonest-to-expire (and already-expired)
 * first by the API.
 *
 * SECURITY: carries ONLY non-sensitive certificate metadata. The private key is
 * never read and no raw certificate bytes are ever sent — only the parsed
 * subject/issuer/validity fields below.
 */
export interface CertHealth {
  namespace: Namespace;
  secretName: string;
  /** Subject Common Name (CN), when present. */
  commonName: string | null;
  /** Issuer distinguished name. */
  issuer: string | null;
  /** Validity start (notBefore); null when the cert could not be parsed. */
  notBefore: Timestamp | null;
  /** Validity end (notAfter); null when the cert could not be parsed. */
  notAfter: Timestamp | null;
  /** Whole days until notAfter (negative if expired); null when unparseable. */
  daysRemaining: number | null;
  /** True when notAfter is in the past. */
  expired: boolean;
  /** Set when tls.crt was missing/unparseable; the row is still returned. */
  parseError: string | null;
}

/* ------------------------------------------------------------------ */
/* RBAC                                                                */
/* ------------------------------------------------------------------ */

export interface RbacCell {
  /** Effective allowed value for this (role, key). */
  effective: boolean;
  /** Explicit DB override, or null when using the code default. */
  overrideVal: boolean | null;
}

export interface RbacMatrixRow {
  key: string;
  category: string;
  label: string;
  mutating: boolean;
  developer: RbacCell;
  admin: RbacCell;
  superAdmin: RbacCell;
}

/** PATCH /api/rbac/permissions body. */
export interface RbacPatch {
  role: "developer" | "admin";
  key: string;
  /** null = revert to code default. */
  allowed: boolean | null;
}
