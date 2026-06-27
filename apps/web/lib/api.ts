/**
 * Typed fetch client for the inInfra console API (apps/api, Rust/axum).
 *
 * This file is the CONTRACT surface for the web app. Every endpoint the Rust
 * handlers expose has a one-to-one method here, typed against
 * `@ininfra/shared-types`. Build-phase frontend agents call these methods;
 * Build-phase Rust agents implement the matching routes. Neither side should
 * change a path/shape without updating BOTH this file and the README contract.
 *
 * Base path: all endpoints live under `/api`. In the browser, requests hit the
 * same origin and are proxied to the Rust API by the Next.js rewrite (see
 * next.config.ts). On the server you may pass an absolute base.
 */
import type {
  ApiError,
  AppConfig,
  AuditEntry,
  BranchChange,
  BuildConfigService,
  BuildJob,
  BuildSubmit,
  CapacityResponse,
  CertHealth,
  ClientErrorReport,
  CordonRequest,
  CronJobSummary,
  DeployInfo,
  Deployment,
  DescribeResponse,
  EcrImage,
  EnvBundle,
  EnvPatch,
  ErrorEvent,
  EventInfo,
  Favorite,
  GatewayConfig,
  GatewayConfigPatch,
  GatewayError,
  GatewayLogEntry,
  GatewayRequest,
  JobSummary,
  ManifestResponse,
  NamespaceQuota,
  NewFavorite,
  SearchResult,
  Hpa,
  HpaPatch,
  FileContent,
  MutationAck,
  Namespace,
  NewUserRequest,
  NodeDetail,
  NodeInfo,
  Page,
  PodLog,
  PodSummary,
  Pvc,
  PvcFile,
  RbacMatrixRow,
  RbacPatch,
  RightsizingRow,
  ScaleRequest,
  Service,
  SetupCompleteRequest,
  SetupNamespacesResponse,
  SetupStatus,
  StatefulSetSummary,
  StatusSummary,
  TopologyResponse,
  TriggerJobAck,
  UpdateUserRequest,
  User,
  WriteFileRequest,
} from "@ininfra/shared-types";

/** Kinds the read-only manifest viewer (`GET /api/manifest/...`) supports. */
export type ManifestKind =
  | "deployment"
  | "statefulset"
  | "pod"
  | "service"
  | "configmap";

/** Kinds the read-only describe panel (`GET /api/describe/...`) supports. */
export type DescribeKind = "deployment" | "statefulset" | "pod";

/** Kinds the read-only topology view (`GET /api/topology/...`) supports. */
export type TopologyKind = "deployment" | "statefulset";

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface ApiClientOptions {
  /** Base URL. Defaults to "" (same-origin, proxied via /api rewrite). */
  baseUrl?: string;
  /** Extra headers (e.g. auth) merged into every request. */
  headers?: Record<string, string>;
  /** Custom fetch (tests / server components). */
  fetch?: typeof fetch;
}

async function request<T>(
  opts: Required<Pick<ApiClientOptions, "baseUrl" | "headers" | "fetch">>,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await opts.fetch(`${opts.baseUrl}${path}`, {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...opts.headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // Session expired/invalid during a browser interaction → bounce to login.
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    let code = "unknown";
    let message = res.statusText;
    let details: Record<string, unknown> | null = null;
    try {
      const parsed = (await res.json()) as ApiError;
      code = parsed.error?.code ?? code;
      message = parsed.error?.message ?? message;
      details = parsed.error?.details ?? null;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiClientError(res.status, code, message, details);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Like `request`, but returns the response body as plain text (e.g. logs). */
async function requestText(
  opts: Required<Pick<ApiClientOptions, "baseUrl" | "headers" | "fetch">>,
  method: string,
  path: string,
): Promise<string> {
  const res = await opts.fetch(`${opts.baseUrl}${path}`, {
    method,
    headers: { ...opts.headers },
  });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    throw new ApiClientError(res.status, "unknown", res.statusText, null);
  }
  return res.text();
}

export function createApiClient(options: ApiClientOptions = {}) {
  const cfg = {
    baseUrl: options.baseUrl ?? "",
    headers: options.headers ?? {},
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
  };
  const q = (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `?${s}` : "";
  };

  return {
    /* ---- health + public config ---- */
    health: () => request<{ status: string }>(cfg, "GET", "/healthz"),
    /** Public runtime config (no auth) — cluster name, managed namespaces, features. */
    getConfig: () => request<AppConfig>(cfg, "GET", "/api/config"),

    /* ---- first-run setup wizard (all public/pre-auth) ---- */
    /** Public setup status — drives the first-run funnel and the wizard. */
    getSetupStatus: () =>
      request<SetupStatus>(cfg, "GET", "/api/setup/status"),
    /** Cluster namespaces for the wizard (409 once setup is complete). */
    getSetupNamespaces: () =>
      request<SetupNamespacesResponse>(cfg, "GET", "/api/setup/namespaces"),
    /** Finalize first-run setup (409 if already complete, 400 on validation). */
    completeSetup: (body: SetupCompleteRequest) =>
      request<{ ok: boolean }>(cfg, "POST", "/api/setup/complete", body),

    /* ---- services ---- */
    listServices: (
      ns?: Namespace,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<Service>>(
        cfg,
        "GET",
        `/api/services${q({ ns, cursor: opts.cursor, limit: opts.limit })}`,
      ),

    /* ---- deployments ---- */
    listDeployments: (
      ns?: Namespace,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<Deployment>>(
        cfg,
        "GET",
        `/api/deployments${q({ ns, cursor: opts.cursor, limit: opts.limit })}`,
      ),
    getDeployment: (ns: Namespace, name: string) =>
      request<Deployment>(cfg, "GET", `/api/deployments/${ns}/${name}`),
    scaleDeployment: (ns: Namespace, name: string, body: ScaleRequest) =>
      request<MutationAck>(
        cfg,
        "PATCH",
        `/api/deployments/${ns}/${name}/scale`,
        body,
      ),
    restartDeployment: (ns: Namespace, name: string) =>
      request<MutationAck>(
        cfg,
        "POST",
        `/api/deployments/${ns}/${name}/restart`,
      ),

    /* ---- env (configmaps + secrets) ---- */
    getEnv: (ns: Namespace, workload: string, reveal = false) =>
      request<EnvBundle>(
        cfg,
        "GET",
        `/api/env/${ns}/${workload}${q({ reveal: reveal ? 1 : undefined })}`,
      ),
    patchEnv: (ns: Namespace, workload: string, body: EnvPatch) =>
      request<MutationAck>(cfg, "PATCH", `/api/env/${ns}/${workload}`, body),

    /* ---- pods ---- */
    listPods: (
      ns: Namespace,
      selector?: string,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<PodSummary>>(
        cfg,
        "GET",
        `/api/pods/${ns}${q({ selector, cursor: opts.cursor, limit: opts.limit })}`,
      ),
    deletePod: (ns: Namespace, name: string) =>
      request<MutationAck>(cfg, "DELETE", `/api/pods/${ns}/${name}`),

    /* ---- raw manifest (read-only YAML) ---- */
    /**
     * Fetch the live object's sanitized manifest as a YAML string. Read-only;
     * the server strips `metadata.managedFields` and the kubectl
     * last-applied-configuration annotation. Supported `kind` values:
     * "deployment" | "statefulset" | "pod" | "service" | "configmap".
     */
    getManifest: (kind: ManifestKind, ns: Namespace, name: string) =>
      request<ManifestResponse>(
        cfg,
        "GET",
        `/api/manifest/${kind}/${ns}/${name}`,
      ),

    /* ---- describe (read-only events + status summary) ---- */
    /**
     * Per-object "describe" panel: the object's `status.conditions`, (pods only)
     * per-container status, and its recent k8s events (from the persisted event
     * store, newest first). Supported `kind`: "deployment" | "statefulset" | "pod".
     */
    describe: (kind: DescribeKind, ns: Namespace, name: string) =>
      request<DescribeResponse>(
        cfg,
        "GET",
        `/api/describe/${kind}/${ns}/${name}`,
      ),

    /* ---- topology (read-only pod topology + PDB safety view) ---- */
    /**
     * Pod topology + PodDisruptionBudget safety view for one workload: where the
     * replicas run (per-node and per-zone distribution), single-node/single-zone
     * SPOF flags, and the matching PDB's budget/status (or null). Supported
     * `kind`: "deployment" | "statefulset".
     */
    topology: (kind: TopologyKind, ns: Namespace, name: string) =>
      request<TopologyResponse>(
        cfg,
        "GET",
        `/api/topology/${kind}/${ns}/${name}`,
      ),

    /* ---- logs ---- */
    /** Snapshot of recent log lines (Loki-backed). For live streaming use streamLogsUrl(). */
    getLogs: (
      ns: Namespace,
      pod: string,
      opts: {
        container?: string;
        /** Legacy: max lines. Forwarded as `limit` to Loki. */
        tail?: number;
        /** Search pattern — substring by default, regex when `regex: true`. */
        q?: string;
        /** When true, `q` is treated as a regex (LogQL `|~ "..."`). */
        regex?: boolean;
        /** Shorthand time window: "5m" | "15m" | "1h" | "6h" | "24h" | "3d" | "7d". */
        since?: string;
        /** RFC3339 start of range (overrides `since`). */
        from?: string;
        /** RFC3339 end of range (overrides `since`). */
        to?: string;
        /** Max lines 1..5000. */
        limit?: number;
      } = {},
    ) =>
      request<PodLog[]>(
        cfg,
        "GET",
        `/api/logs/${ns}/${pod}${q({
          container: opts.container,
          tail: opts.tail,
          q: opts.q,
          regex: opts.regex ? "true" : undefined,
          since: opts.since,
          from: opts.from,
          to: opts.to,
          limit: opts.limit,
        })}`,
      ),
    /**
     * URL for a live log stream (SSE: `text/event-stream`, each event data is
     * a JSON `PodLog`). Open with EventSource on the client.
     */
    streamLogsUrl: (ns: Namespace, pod: string, container?: string) =>
      `${cfg.baseUrl}/api/logs/${ns}/${pod}/stream${q({ container })}`,
    /**
     * Snapshot of recent log lines aggregated across MULTIPLE pods (Loki-backed).
     * Lines from all `pods` are interleaved by timestamp. For a single pod use
     * getLogs(). For live multi-pod streaming use streamMultiLogsUrl().
     */
    getMultiLogs: (
      ns: Namespace,
      pods: string[],
      opts: {
        /** Search pattern — substring by default, regex when `regex: true`. */
        q?: string;
        /** When true, `q` is treated as a regex (LogQL `|~ "..."`). */
        regex?: boolean;
        /** Shorthand time window: "5m" | "15m" | "1h" | "6h" | "24h" | "3d" | "7d". */
        since?: string;
        /** RFC3339 start of range (overrides `since`). */
        from?: string;
        /** RFC3339 end of range (overrides `since`). */
        to?: string;
        /** Max lines 1..5000 (across all pods). */
        limit?: number;
      } = {},
    ) =>
      request<PodLog[]>(
        cfg,
        "GET",
        `/api/logs-multi/${ns}${q({
          pods: pods.join(","),
          q: opts.q,
          regex: opts.regex ? 1 : undefined,
          since: opts.since,
          from: opts.from,
          to: opts.to,
          limit: opts.limit,
        })}`,
      ),
    /**
     * URL for a live aggregated multi-pod log stream (SSE: `text/event-stream`,
     * each event data is a JSON `PodLog`). Open with EventSource on the client.
     */
    streamMultiLogsUrl: (ns: Namespace, pods: string[]) =>
      `${cfg.baseUrl}/api/logs-multi/${ns}/stream${q({ pods: pods.join(",") })}`,

    /* ---- builds (Argo Workflows) ---- */
    listBuilds: (opts: { cursor?: string; limit?: number } = {}) =>
      request<Page<BuildJob>>(
        cfg,
        "GET",
        `/api/builds${q({ cursor: opts.cursor, limit: opts.limit })}`,
      ),
    getBuild: (id: string) =>
      request<BuildJob>(cfg, "GET", `/api/builds/${id}`),
    buildLogs: (id: string) =>
      requestText(cfg, "GET", `/api/builds/${id}/logs`),
    submitBuild: (body: BuildSubmit) =>
      request<BuildJob>(cfg, "POST", "/api/builds", body),

    /* ---- nodes ---- */
    listNodes: (opts: { cursor?: string; limit?: number } = {}) =>
      request<Page<NodeInfo>>(
        cfg,
        "GET",
        `/api/nodes${q({ cursor: opts.cursor, limit: opts.limit })}`,
      ),
    getNode: (name: string) =>
      request<NodeDetail>(cfg, "GET", `/api/nodes/${name}`),
    /**
     * Cordon (unschedulable: true) or uncordon (false) a node. Admin only —
     * the API rejects non-admin callers. Returns a MutationAck.
     */
    setNodeCordon: (name: string, unschedulable: boolean) =>
      request<MutationAck>(cfg, "POST", `/api/nodes/${name}/cordon`, {
        unschedulable,
      } satisfies CordonRequest),

    /* ---- right-sizing (read-only advisory) ---- */
    /**
     * List resource right-sizing recommendations for every Deployment and
     * StatefulSet in scope (all managed namespaces when `ns` is omitted).
     * Read-only — never applies anything.
     */
    listRightsizing: (
      ns?: Namespace,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<RightsizingRow>>(
        cfg,
        "GET",
        `/api/rightsizing${q({ ns, cursor: opts.cursor, limit: opts.limit })}`,
      ),

    /* ---- capacity & quotas (read-only) ---- */
    /**
     * Cluster capacity rollup: per-node allocatable vs requested vs live-used
     * CPU/memory with schedulable headroom, plus a cluster total. Usage degrades
     * to null when metrics-server is absent. Read-only.
     */
    getCapacity: () => request<CapacityResponse>(cfg, "GET", "/api/capacity"),
    /**
     * Per-namespace ResourceQuota usage (used/hard) and LimitRange defaults.
     * Pass `ns` for a single managed namespace, or omit to scan all managed
     * namespaces. Read-only.
     */
    listQuotas: (ns?: Namespace) =>
      request<NamespaceQuota[]>(cfg, "GET", `/api/quotas${q({ ns })}`),

    /* ---- audit ---- */
    listAudit: (
      opts: {
        cursor?: string;
        limit?: number;
        actor?: string;
        action?: string;
        ns?: string;
        role?: string;
        /** Full-text search term. Substring by default; regex when `regex: true`. */
        q?: string;
        /** When true, `q` is treated as a Postgres case-insensitive regex (`~*`). */
        regex?: boolean;
        /** RFC3339 lower bound on `ts` (inclusive). Overridden by `since`. */
        from?: string;
        /** RFC3339 upper bound on `ts` (inclusive). */
        to?: string;
        /** Shorthand preset resolved server-side: "1h" | "24h" | "7d" | "30d". */
        since?: string;
      } = {},
    ) =>
      request<Page<AuditEntry>>(
        cfg,
        "GET",
        `/api/audit${q({
          cursor: opts.cursor,
          limit: opts.limit,
          actor: opts.actor,
          action: opts.action,
          ns: opts.ns,
          role: opts.role,
          q: opts.q,
          regex: opts.regex ? "true" : undefined,
          from: opts.from,
          to: opts.to,
          since: opts.since,
        })}`,
      ),

    /* ---- build catalog (deploy branch) ---- */
    listBuildConfig: (ns: Namespace) =>
      request<BuildConfigService[]>(cfg, "GET", `/api/build-config/${ns}`),
    changeBranch: (ns: Namespace, service: string, body: BranchChange) =>
      request<MutationAck>(
        cfg,
        "PATCH",
        `/api/build-config/${ns}/${service}`,
        body,
      ),

    /* ---- HPA ---- */
    listHpas: (ns: Namespace, opts: { cursor?: string; limit?: number } = {}) =>
      request<Page<Hpa>>(
        cfg,
        "GET",
        `/api/hpa/${ns}${q({ cursor: opts.cursor, limit: opts.limit })}`,
      ),
    getHpa: (ns: Namespace, name: string) =>
      request<Hpa>(cfg, "GET", `/api/hpa/${ns}/${name}`),
    patchHpa: (ns: Namespace, name: string, body: HpaPatch) =>
      request<MutationAck>(cfg, "PATCH", `/api/hpa/${ns}/${name}`, body),

    /* ---- statefulsets ---- */
    listStatefulSets: (
      ns: Namespace,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<StatefulSetSummary>>(
        cfg,
        "GET",
        `/api/statefulsets/${ns}${q({ cursor: opts.cursor, limit: opts.limit })}`,
      ),
    getStatefulSet: (ns: Namespace, name: string) =>
      request<StatefulSetSummary>(cfg, "GET", `/api/statefulsets/${ns}/${name}`),
    scaleStatefulSet: (ns: Namespace, name: string, body: ScaleRequest) =>
      request<MutationAck>(
        cfg,
        "PATCH",
        `/api/statefulsets/${ns}/${name}/scale`,
        body,
      ),
    restartStatefulSet: (ns: Namespace, name: string) =>
      request<MutationAck>(
        cfg,
        "POST",
        `/api/statefulsets/${ns}/${name}/restart`,
      ),

    /* ---- jobs & cronjobs (batch/v1) ---- */
    /** List CronJobs across the namespace (or all managed namespaces when omitted). */
    listCronjobs: (
      ns?: Namespace,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<CronJobSummary>>(
        cfg,
        "GET",
        `/api/cronjobs${q({ ns, cursor: opts.cursor, limit: opts.limit })}`,
      ),
    /** List recent Jobs (newest-first, capped) across the ns (or all managed). */
    listJobs: (ns?: Namespace, opts: { cursor?: string; limit?: number } = {}) =>
      request<Page<JobSummary>>(
        cfg,
        "GET",
        `/api/jobs${q({ ns, cursor: opts.cursor, limit: opts.limit })}`,
      ),
    /** Suspend (true) or resume (false) a CronJob. Audited. */
    suspendCronjob: (ns: Namespace, name: string, suspend: boolean) =>
      request<MutationAck>(cfg, "PATCH", `/api/cronjobs/${ns}/${name}/suspend`, {
        suspend,
      }),
    /** Trigger a CronJob now: create a Job from its template. Returns the Job name. */
    triggerCronjob: (ns: Namespace, name: string) =>
      request<TriggerJobAck>(cfg, "POST", `/api/cronjobs/${ns}/${name}/trigger`),

    /* ---- events ---- */
    listEvents: (
      ns: Namespace,
      opts: {
        involvedKind?: string;
        involvedName?: string;
        /** Full-text search: ILIKE over reason / message / involvedName. */
        q?: string;
        /** Shorthand time window: "1h" | "6h" | "24h" | "48h" | "7d". */
        since?: string;
        /** RFC3339 lower bound on lastSeen. */
        from?: string;
        /** RFC3339 upper bound on lastSeen. */
        to?: string;
        cursor?: string;
        limit?: number;
      } = {},
    ) =>
      request<Page<EventInfo>>(
        cfg,
        "GET",
        `/api/events/${ns}${q({
          involvedKind: opts.involvedKind,
          involvedName: opts.involvedName,
          q: opts.q,
          since: opts.since,
          from: opts.from,
          to: opts.to,
          cursor: opts.cursor,
          limit: opts.limit,
        })}`,
      ),

    /* ---- storage (PVC) ---- */
    listPvcs: (ns: Namespace) => request<Pvc[]>(cfg, "GET", `/api/pvc/${ns}`),

    /* ---- secrets health (read-only TLS cert expiry; never values) ---- */
    /**
     * TLS certificate expiry scan across `kubernetes.io/tls` secrets. Pass `ns`
     * to scan a single managed namespace, or omit it to scan all managed
     * namespaces. The API returns metadata only (subject/issuer/validity), sorted
     * soonest-to-expire (and already-expired) first — never any secret value.
     */
    secretsHealth: (ns?: Namespace) =>
      request<CertHealth[]>(cfg, "GET", `/api/secrets/health${q({ ns })}`),

    /* ---- PVC file browser (exec into the mounting pod) ---- */
    listPvcFiles: (
      ns: Namespace,
      name: string,
      opts: { path?: string; cursor?: string; limit?: number } = {},
    ) =>
      request<Page<PvcFile>>(
        cfg,
        "GET",
        `/api/pvc/${ns}/${name}/files${q({
          path: opts.path,
          cursor: opts.cursor,
          limit: opts.limit,
        })}`,
      ),
    readPvcFile: (ns: Namespace, name: string, path: string) =>
      request<FileContent>(
        cfg,
        "GET",
        `/api/pvc/${ns}/${name}/file${q({ path })}`,
      ),
    writePvcFile: (
      ns: Namespace,
      name: string,
      path: string,
      body: WriteFileRequest,
    ) =>
      request<MutationAck>(
        cfg,
        "PUT",
        `/api/pvc/${ns}/${name}/file${q({ path })}`,
        body,
      ),
    deletePvcFile: (ns: Namespace, name: string, path: string) =>
      request<MutationAck>(
        cfg,
        "DELETE",
        `/api/pvc/${ns}/${name}/file${q({ path })}`,
      ),

    /* ---- users (admin only) ---- */
    listUsers: (opts: { cursor?: string; limit?: number } = {}) =>
      request<Page<User>>(
        cfg,
        "GET",
        `/api/users${q({ cursor: opts.cursor, limit: opts.limit })}`,
      ),
    createUser: (body: NewUserRequest) =>
      request<User>(cfg, "POST", "/api/users", body),
    updateUser: (id: string, body: UpdateUserRequest) =>
      request<User>(cfg, "PATCH", `/api/users/${id}`, body),
    deleteUser: (id: string) =>
      request<MutationAck>(cfg, "DELETE", `/api/users/${id}`),

    /* ---- deploy / release management (per service) ---- */
    getDeploy: (ns: Namespace, name: string) =>
      request<DeployInfo>(cfg, "GET", `/api/deploy/${ns}/${name}`),
    triggerDeployBuild: (ns: Namespace, name: string) =>
      request<MutationAck>(cfg, "POST", `/api/deploy/${ns}/${name}/build`),
    rollbackDeploy: (ns: Namespace, name: string, revision: number) =>
      request<MutationAck>(cfg, "POST", `/api/deploy/${ns}/${name}/rollback`, {
        revision,
      }),
    listDeployImages: (
      ns: Namespace,
      name: string,
      opts: { cursor?: string; limit?: number } = {},
    ) =>
      request<Page<EcrImage>>(
        cfg,
        "GET",
        `/api/deploy/${ns}/${name}/images${q({ cursor: opts.cursor, limit: opts.limit })}`,
      ),
    deleteDeployImage: (ns: Namespace, name: string, digest: string) =>
      request<MutationAck>(
        cfg,
        "DELETE",
        `/api/deploy/${ns}/${name}/images/${encodeURIComponent(digest)}`,
      ),

    /* ---- search ---- */
    search: (
      query: string,
      opts: { kind?: string; namespace?: string } = {},
    ) =>
      request<SearchResult[]>(
        cfg,
        "GET",
        `/api/search${q({ q: query, kind: opts.kind, namespace: opts.namespace })}`,
      ),

    /* ---- favorites (per-user) ---- */
    listFavorites: () => request<Favorite[]>(cfg, "GET", "/api/favorites"),
    addFavorite: (body: NewFavorite) =>
      request<Favorite>(cfg, "POST", "/api/favorites", body),
    removeFavorite: (sel: { kind: string; namespace?: string; name: string }) =>
      request<MutationAck>(
        cfg,
        "DELETE",
        `/api/favorites${q({ kind: sel.kind, namespace: sel.namespace ?? "", name: sel.name })}`,
      ),

    /* ---- API gateway ---- */
    gatewayLogs: (
      opts: {
        tail?: number;
        only5xx?: boolean;
        status?: number;
        method?: string;
        path?: string;
      } = {},
    ) =>
      request<GatewayLogEntry[]>(
        cfg,
        "GET",
        `/api/gateway/logs${q({
          tail: opts.tail,
          only5xx: opts.only5xx ? 1 : undefined,
          status: opts.status,
          method: opts.method,
          path: opts.path,
        })}`,
      ),
    listGatewayErrors: (
      opts: {
        cursor?: string;
        limit?: number;
        status?: number;
        method?: string;
        path?: string;
      } = {},
    ) =>
      request<Page<GatewayError>>(
        cfg,
        "GET",
        `/api/gateway/errors${q({
          cursor: opts.cursor,
          limit: opts.limit,
          status: opts.status,
          method: opts.method,
          path: opts.path,
        })}`,
      ),
    listGatewayRequests: (
      opts: {
        cursor?: string;
        limit?: number;
        ip?: string;
        status?: number;
        method?: string;
        path?: string;
        hasAuth?: boolean;
        userId?: string;
        roleId?: string;
        isAdmin?: boolean;
      } = {},
    ) =>
      request<Page<GatewayRequest>>(
        cfg,
        "GET",
        `/api/gateway/requests${q({
          cursor: opts.cursor,
          limit: opts.limit,
          ip: opts.ip,
          status: opts.status,
          method: opts.method,
          path: opts.path,
          has_auth: opts.hasAuth === undefined ? undefined : opts.hasAuth ? "true" : "false",
          user_id: opts.userId,
          role_id: opts.roleId,
          is_admin: opts.isAdmin === undefined ? undefined : opts.isAdmin ? "true" : "false",
        })}`,
      ),
    getGatewayConfig: () => request<GatewayConfig>(cfg, "GET", "/api/gateway/config"),
    patchGatewayConfig: (body: GatewayConfigPatch) =>
      request<MutationAck>(cfg, "PATCH", "/api/gateway/config", body),
    restartGateway: () => request<MutationAck>(cfg, "POST", "/api/gateway/restart"),

    /* ---- status page ---- */
    getStatus: () => request<StatusSummary>(cfg, "GET", "/api/status"),

    /* ---- error tracking (Sentry-style) ---- */
    listErrors: (
      opts: {
        cursor?: string;
        limit?: number;
        username?: string;
        status?: number;
        source?: string;
        role?: string;
      } = {},
    ) =>
      request<Page<ErrorEvent>>(
        cfg,
        "GET",
        `/api/errors${q({
          cursor: opts.cursor,
          limit: opts.limit,
          username: opts.username,
          status: opts.status,
          source: opts.source,
          role: opts.role,
        })}`,
      ),
    reportError: (body: ClientErrorReport) =>
      request<MutationAck>(cfg, "POST", "/api/errors", body),

    /* ---- current identity (role-aware UI) ---- */
    me: () => request<{ username: string; role: string }>(cfg, "GET", "/api/auth/me"),

    /* ---- RBAC (super_admin only) ---- */
    getRbacPermissions: () =>
      request<RbacMatrixRow[]>(cfg, "GET", "/api/rbac/permissions"),
    setRbacPermission: (body: RbacPatch) =>
      request<MutationAck>(cfg, "PATCH", "/api/rbac/permissions", body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Default same-origin client for use in browser components. */
export const api = createApiClient();
