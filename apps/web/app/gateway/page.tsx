"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GatewayConfig,
  GatewayError,
  GatewayLogEntry,
  GatewayRequest,
  Page,
} from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { cx, fmtTime, timeAgo } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useConfig } from "@/components/ConfigProvider";
import { useToast } from "@/components/Toast";
import { PageHeader, EmptyState } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const LIVE_REFRESH_MS = 5_000;
const ERRORS_PAGE_SIZE = 25;
const DEFAULT_TAIL = 200;
const TAIL_OPTIONS = [100, 200, 500, 1000] as const;
const ALL = "all";
const METHOD_OPTIONS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const STATUS_OPTIONS = [200, 301, 400, 401, 403, 404, 429, 500, 502, 503] as const;

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : String(e);
}

/** Tailwind text-color class for an HTTP status code. */
function statusColor(status: number | null): string {
  if (status == null) return "text-ink-faint";
  if (status >= 500) return "text-pf-red";
  if (status >= 400) return "text-[#8a6d00]";
  if (status >= 300) return "text-pf-blue";
  return "text-pf-green";
}

function is5xx(n: number | null): boolean {
  return n != null && n >= 500;
}

/** Real client IP; the raw X-Forwarded-For chain shows on hover when it differs. */
function ClientCell({ ip, xff }: { ip: string | null; xff?: string | null }) {
  if (!ip && !xff) return <span className="text-ink-faint">—</span>;
  const title = xff && xff !== ip ? `X-Forwarded-For: ${xff}` : ip ?? undefined;
  return (
    <span className="font-mono text-[12px] text-ink-muted" title={title}>
      {ip ?? xff}
      {xff && xff !== ip && (
        <span className="ml-1 text-ink-faint" aria-hidden>
          ↳
        </span>
      )}
    </span>
  );
}

/** Authorization-header presence (the token value is never logged). */
function AuthBadge({ hasAuth }: { hasAuth: boolean | null }) {
  if (hasAuth == null) return <span className="text-ink-faint">—</span>;
  return hasAuth ? (
    <Badge
      variant="outline"
      className="border-transparent bg-pf-blue-50 text-[11px] font-medium text-pf-blue"
      title="Request carried an Authorization header"
    >
      auth
    </Badge>
  ) : (
    <span className="text-[12px] text-ink-faint" title="No Authorization header">
      anon
    </span>
  );
}

/** Resolved caller identity (user id + role; admin highlighted). */
function UserCell({
  userId,
  roleId,
  isAdmin,
}: {
  userId: string | null;
  roleId: string | null;
  isAdmin: boolean | null;
}) {
  if (!userId) return <span className="text-ink-faint">anon</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(userId)}
        className="font-mono text-[12px] text-ink-soft hover:text-pf-blue"
        title={`user ${userId}${roleId ? `\nrole ${roleId}` : ""}\n(click to copy)`}
      >
        {userId.length > 14 ? `${userId.slice(0, 14)}…` : userId}
      </button>
      {isAdmin && (
        <Badge
          variant="outline"
          className="border-transparent bg-pf-gold-50 text-[10px] font-semibold text-[#8a6d00]"
          title="Admin caller"
        >
          admin
        </Badge>
      )}
    </span>
  );
}

/** Truncated, click-to-copy request correlation id. */
function RequestIdCell({ id }: { id: string | null }) {
  if (!id) return <span className="text-ink-faint">—</span>;
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(id)}
      className="font-mono text-[11px] text-ink-muted hover:text-pf-blue"
      title={`${id}\n(click to copy — search the upstream service logs for this id)`}
    >
      {id.length > 12 ? `${id.slice(0, 12)}…` : id}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Page shell                                                          */
/* ------------------------------------------------------------------ */

export default function GatewayPage() {
  const { features } = useConfig();

  if (!features.gateway) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker="Workloads" title="API Gateway" />
        <EmptyState
          title="Gateway integration is not configured"
          body="Set the GATEWAY_* environment variables on the API to surface request logs, 5xx history, and the config editor."
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Workloads"
        title="API Gateway"
        subtitle="Live access logs, the sampled request feed with real client IPs, persisted 5xx history, and the live gateway configuration."
      />
      <Tabs defaultValue="live">
        <TabsList className="mb-4 rounded-pf border border-line bg-line-soft p-1">
          <TabsTrigger value="live">Live</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="history">5xx history</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>
        <TabsContent value="live">
          <LiveTab />
        </TabsContent>
        <TabsContent value="requests">
          <RequestsTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab />
        </TabsContent>
        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live tab                                                            */
/* ------------------------------------------------------------------ */

function LiveTab() {
  const [entries, setEntries] = useState<GatewayLogEntry[]>([]);
  const [only5xx, setOnly5xx] = useState(false);
  const [tail, setTail] = useState<number>(DEFAULT_TAIL);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<number | null>(null);

  // Server-side filters.
  const [method, setMethod] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [path, setPath] = useState("");
  const debouncedPath = useDebouncedValue(path, 300);

  const hasFilters =
    only5xx || method !== ALL || status !== ALL || debouncedPath.trim() !== "";

  // Re-render tick so relative times advance.
  const [, setTick] = useState(0);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const next = await api.gatewayLogs({
          tail,
          only5xx,
          status: status === ALL ? undefined : Number(status),
          method: method === ALL ? undefined : method,
          path: debouncedPath.trim() || undefined,
        });
        if (!aliveRef.current) return;
        setEntries(next);
        setError(null);
        setLastFetched(Date.now());
      } catch (e) {
        if (aliveRef.current) setError(errMsg(e));
      } finally {
        if (aliveRef.current && showSpinner) setLoading(false);
      }
    },
    [tail, only5xx, status, method, debouncedPath],
  );

  // Initial + dependency-driven reload (also fires when a filter changes).
  useEffect(() => {
    void load(true);
  }, [load]);

  // Auto-refresh polling.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => void load(false), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // 1s ticker so timeAgo stays fresh.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  function clearFilters() {
    setOnly5xx(false);
    setMethod(ALL);
    setStatus(ALL);
    setPath("");
  }

  const shown = entries;

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={only5xx ? "default" : "outline"}
          size="sm"
          onClick={() => setOnly5xx((v) => !v)}
          aria-pressed={only5xx}
        >
          {only5xx ? "5xx only · on" : "5xx only"}
        </Button>

        <Select
          value={String(tail)}
          onValueChange={(v) => setTail(Number(v))}
        >
          <SelectTrigger className="h-8 w-auto text-xs" aria-label="tail size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TAIL_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                tail {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="h-8 w-auto min-w-[6rem] text-xs" aria-label="filter by method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All methods</SelectItem>
            {METHOD_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs" aria-label="filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((c) => (
              <SelectItem key={c} value={String(c)}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="path…"
          className="h-8 w-44 text-xs"
          spellCheck={false}
          aria-label="filter by path"
        />

        <label className="flex items-center gap-1.5 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="accent-pf-blue"
          />
          auto-refresh (5s)
        </label>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </Button>

        {hasFilters && (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}

        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-faint">
          {autoRefresh && (
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pf-green/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-pf-green" />
            </span>
          )}
          {lastFetched != null && (
            <span
              className="tabular"
              title={fmtTime(new Date(lastFetched).toISOString())}
            >
              updated {timeAgo(new Date(lastFetched).toISOString())}
            </span>
          )}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {error}
        </div>
      )}

      {shown.length === 0 && !loading ? (
        <EmptyState
          title="No request logs"
          body={
            hasFilters
              ? "No log lines match the current filters."
              : "The gateway has not emitted any access logs in the current tail."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[940px] text-sm">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                  <TableHead className="px-4 py-2.5 font-medium">Time</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Method</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Path</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Status</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Upstream</TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">Latency</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Host</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Client</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((e, i) => (
                  <LiveRow key={`${e.ts ?? "null"}-${i}`} entry={e} />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="mt-3 text-xs text-ink-faint">
        <span className="tabular">{shown.length}</span> line
        {shown.length === 1 ? "" : "s"}
        {hasFilters && <> · filtered</>}
      </div>
    </div>
  );
}

function LiveRow({ entry }: { entry: GatewayLogEntry }) {
  const flagged = is5xx(entry.status) || is5xx(entry.upstreamStatus);
  return (
    <TableRow
      className={cx(
        "border-b border-line transition-colors last:border-0",
        flagged ? "bg-pf-red-50 hover:bg-pf-red-50/80" : "hover:bg-line-soft",
      )}
    >
      <TableCell
        className="px-4 py-3 text-[13px] text-ink-muted"
        title={fmtTime(entry.ts)}
      >
        {timeAgo(entry.ts)}
      </TableCell>
      <TableCell className="px-4 py-3">
        <Badge
          variant="outline"
          className="border-line bg-line-soft font-mono text-[11px] font-medium text-ink-soft"
        >
          {entry.method}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[24rem] px-4 py-3">
        <span
          className="block truncate font-mono text-[13px] text-ink"
          title={entry.path}
        >
          {entry.path}
        </span>
      </TableCell>
      <TableCell className={cx("px-4 py-3 tabular text-[13px] font-bold", statusColor(entry.status))}>
        {entry.status}
      </TableCell>
      <TableCell className={cx("px-4 py-3 tabular text-[13px] font-bold", statusColor(entry.upstreamStatus))}>
        {entry.upstreamStatus ?? <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3 text-right tabular text-[13px] text-ink-soft">
        {entry.latencyMs != null ? `${entry.latencyMs} ms` : <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3 text-[13px] text-ink-muted">
        {entry.host ?? <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3">
        <ClientCell ip={entry.clientIp} xff={entry.xff} />
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ */
/* Requests tab (sampled all-requests feed, with real client IP)       */
/* ------------------------------------------------------------------ */

function RequestsTab() {
  const [items, setItems] = useState<GatewayRequest[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stack, setStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters.
  const [ip, setIp] = useState("");
  const [method, setMethod] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [path, setPath] = useState("");
  const [auth, setAuth] = useState<string>(ALL);
  const [userId, setUserId] = useState("");
  const [admin, setAdmin] = useState<string>(ALL);
  const debouncedIp = useDebouncedValue(ip, 300);
  const debouncedPath = useDebouncedValue(path, 300);
  const debouncedUserId = useDebouncedValue(userId, 300);

  const hasFilters =
    debouncedIp.trim() !== "" ||
    method !== ALL ||
    status !== ALL ||
    debouncedPath.trim() !== "" ||
    auth !== ALL ||
    debouncedUserId.trim() !== "" ||
    admin !== ALL;

  const buildFilters = useCallback(
    () => ({
      ip: debouncedIp.trim() || undefined,
      status: status === ALL ? undefined : Number(status),
      method: method === ALL ? undefined : method,
      path: debouncedPath.trim() || undefined,
      hasAuth: auth === ALL ? undefined : auth === "auth",
      userId: debouncedUserId.trim() || undefined,
      isAdmin: admin === ALL ? undefined : admin === "admin",
    }),
    [debouncedIp, status, method, debouncedPath, auth, debouncedUserId, admin],
  );

  const seq = useRef(0);
  const load = useCallback(
    async (cursor: string | null) => {
      const mySeq = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const page: Page<GatewayRequest> = await api.listGatewayRequests({
          ...buildFilters(),
          cursor: cursor ?? undefined,
          limit: ERRORS_PAGE_SIZE,
        });
        if (mySeq !== seq.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total ?? null);
      } catch (e) {
        if (mySeq === seq.current) setError(errMsg(e));
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    },
    [buildFilters],
  );

  useEffect(() => {
    setStack([null]);
    void load(null);
  }, [load]);

  function goNext() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setStack((s) => [...s, cursor]);
    void load(cursor);
  }

  function goPrev() {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    void load(next[next.length - 1]);
  }

  function clearFilters() {
    setIp("");
    setMethod(ALL);
    setStatus(ALL);
    setPath("");
    setAuth(ALL);
    setUserId("");
    setAdmin(ALL);
  }

  const hasPrev = stack.length > 1;

  return (
    <div>
      <div className="mb-3 text-xs text-ink-faint">
        Sampled feed — every non-2xx request plus a sample of 2xx, with the real
        client IP. Searchable and retained per your log-retention policy.
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={ip}
          onChange={(e) => setIp(e.target.value)}
          placeholder="client IP…"
          className="h-8 w-36 text-xs"
          spellCheck={false}
          aria-label="filter by client IP"
        />
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="h-8 w-auto min-w-[6rem] text-xs" aria-label="filter by method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All methods</SelectItem>
            {METHOD_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs" aria-label="filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_OPTIONS.map((c) => (
              <SelectItem key={c} value={String(c)}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={auth} onValueChange={setAuth}>
          <SelectTrigger className="h-8 w-auto min-w-[6.5rem] text-xs" aria-label="filter by auth">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any auth</SelectItem>
            <SelectItem value="auth">Authenticated</SelectItem>
            <SelectItem value="anon">Anonymous</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="user id…"
          className="h-8 w-36 text-xs"
          spellCheck={false}
          aria-label="filter by user id"
        />
        <Select value={admin} onValueChange={setAdmin}>
          <SelectTrigger className="h-8 w-auto min-w-[6.5rem] text-xs" aria-label="filter by admin">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any role</SelectItem>
            <SelectItem value="admin">Admins</SelectItem>
            <SelectItem value="user">Non-admins</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="path…"
          className="h-8 w-44 text-xs"
          spellCheck={false}
          aria-label="filter by path"
        />
        {hasFilters && (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {error}
        </div>
      )}

      {items.length === 0 && !loading && !error ? (
        <EmptyState
          title={hasFilters ? "No matching requests" : "No requests captured yet"}
          body={
            hasFilters
              ? "No sampled requests match these filters."
              : "The gateway request feed is empty for the current retention window."
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[1180px] text-sm">
                <TableHeader>
                  <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                    <TableHead className="px-4 py-2.5 font-medium">Time</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Method</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Path</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Status</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">Latency</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Client</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">User</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Auth</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Request ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((e) => (
                    <RequestRow key={e.id} req={e} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-faint">
              {loading
                ? "Loading…"
                : total != null
                  ? `${total} request${total === 1 ? "" : "s"} captured`
                  : `${items.length} shown`}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={!hasPrev || loading}>
                Prev
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RequestRow({ req }: { req: GatewayRequest }) {
  const flagged = is5xx(req.status) || is5xx(req.upstreamStatus);
  return (
    <TableRow
      className={cx(
        "border-b border-line transition-colors last:border-0",
        flagged ? "bg-pf-red-50 hover:bg-pf-red-50/80" : "hover:bg-line-soft",
      )}
    >
      <TableCell className="px-4 py-3 text-[13px] text-ink-muted" title={fmtTime(req.ts)}>
        {timeAgo(req.ts)}
      </TableCell>
      <TableCell className="px-4 py-3">
        <Badge
          variant="outline"
          className="border-line bg-line-soft font-mono text-[11px] font-medium text-ink-soft"
        >
          {req.method}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[22rem] px-4 py-3">
        <span className="block truncate font-mono text-[13px] text-ink" title={req.path}>
          {req.path}
        </span>
      </TableCell>
      <TableCell className={cx("px-4 py-3 tabular text-[13px] font-bold", statusColor(req.status))}>
        {req.status}
        {req.upstreamStatus != null && req.upstreamStatus !== req.status && (
          <span className="ml-1 text-[11px] font-normal text-ink-faint">
            ↟{req.upstreamStatus}
          </span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3 text-right tabular text-[13px] text-ink-soft">
        {req.latencyMs != null ? `${req.latencyMs} ms` : <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3">
        <ClientCell ip={req.clientIp} xff={req.xff} />
      </TableCell>
      <TableCell className="px-4 py-3">
        <UserCell userId={req.xUserId} roleId={req.xRoleId} isAdmin={req.isAdmin} />
      </TableCell>
      <TableCell className="px-4 py-3">
        <AuthBadge hasAuth={req.hasAuth} />
      </TableCell>
      <TableCell className="px-4 py-3">
        <RequestIdCell id={req.requestId} />
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ */
/* 5xx history tab                                                     */
/* ------------------------------------------------------------------ */

function HistoryTab() {
  const [items, setItems] = useState<GatewayError[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Stack of cursors used to reach the current page (last = current).
  const [stack, setStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state.
  const [method, setMethod] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [path, setPath] = useState("");
  const debouncedPath = useDebouncedValue(path, 300);

  const hasFilters =
    method !== ALL || status !== ALL || debouncedPath.trim() !== "";

  const buildFilters = useCallback(
    () => ({
      status: status === ALL ? undefined : Number(status),
      method: method === ALL ? undefined : method,
      path: debouncedPath.trim() || undefined,
    }),
    [status, method, debouncedPath],
  );

  const seq = useRef(0);
  const load = useCallback(
    async (cursor: string | null) => {
      const mySeq = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const page: Page<GatewayError> = await api.listGatewayErrors({
          ...buildFilters(),
          cursor: cursor ?? undefined,
          limit: ERRORS_PAGE_SIZE,
        });
        if (mySeq !== seq.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total ?? null);
      } catch (e) {
        if (mySeq === seq.current) setError(errMsg(e));
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    },
    [buildFilters],
  );

  // Initial load + reset to page 1 whenever a filter changes.
  useEffect(() => {
    setStack([null]);
    void load(null);
  }, [load]);

  function goNext() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setStack((s) => [...s, cursor]);
    void load(cursor);
  }

  function goPrev() {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    void load(next[next.length - 1]);
  }

  function clearFilters() {
    setMethod(ALL);
    setStatus(ALL);
    setPath("");
  }

  const hasPrev = stack.length > 1;

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className="h-8 w-auto min-w-[6rem] text-xs" aria-label="filter by method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All methods</SelectItem>
            {METHOD_OPTIONS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs" aria-label="filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_OPTIONS.filter((c) => c >= 500).map((c) => (
              <SelectItem key={c} value={String(c)}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="path…"
          className="h-8 w-44 text-xs"
          spellCheck={false}
          aria-label="filter by path"
        />
        {hasFilters && (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {error}
        </div>
      )}

      {items.length === 0 && !loading && !error ? (
        <EmptyState
          title={hasFilters ? "No matching 5xx errors" : "No 5xx errors recorded."}
          body={
            hasFilters
              ? "No recorded 5xx errors match these filters."
              : "The durable error history is empty."
          }
        />
      ) : (
        <>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[860px] text-sm">
            <TableHeader>
              <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                <TableHead className="px-4 py-2.5 font-medium">Time</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">Method</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">Path</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">Status</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">Upstream</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">Host</TableHead>
                <TableHead className="px-4 py-2.5 font-medium">Client</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((e) => (
                <HistoryRow key={e.id} err={e} />
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {loading
            ? "Loading…"
            : total != null
              ? `${total} error${total === 1 ? "" : "s"} recorded`
              : `${items.length} shown`}
        </span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={!hasPrev || loading}>
            Prev
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={goNext} disabled={!nextCursor || loading}>
            Next
          </Button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function HistoryRow({ err }: { err: GatewayError }) {
  return (
    <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-pf-red-50/60">
      <TableCell className="px-4 py-3 text-[13px] text-ink-muted" title={fmtTime(err.ts)}>
        {timeAgo(err.ts)}
      </TableCell>
      <TableCell className="px-4 py-3">
        <Badge
          variant="outline"
          className="border-line bg-line-soft font-mono text-[11px] font-medium text-ink-soft"
        >
          {err.method}
        </Badge>
      </TableCell>
      <TableCell className="max-w-[24rem] px-4 py-3">
        <span className="block truncate font-mono text-[13px] text-ink" title={err.path}>
          {err.path}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3 tabular text-[13px] font-bold text-pf-red">
        {err.status}
      </TableCell>
      <TableCell className={cx("px-4 py-3 tabular text-[13px] font-bold", statusColor(err.upstreamStatus))}>
        {err.upstreamStatus ?? <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3 text-[13px] text-ink-muted">
        {err.host ?? <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3">
        <ClientCell ip={err.clientIp} />
      </TableCell>
    </TableRow>
  );
}

/* ------------------------------------------------------------------ */
/* Config tab                                                          */
/* ------------------------------------------------------------------ */

function ConfigTab() {
  const toast = useToast();

  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [canEdit, setCanEdit] = useState(false);
  const [roleResolved, setRoleResolved] = useState(false);

  const [selectedKey, setSelectedKey] = useState<string>("");
  // Edited value per key (only keys the user touched are present).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Resolve role.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((m) => {
        if (alive) setCanEdit(m.role === "admin");
      })
      .catch(() => {
        if (alive) setCanEdit(false);
      })
      .finally(() => {
        if (alive) setRoleResolved(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const cfg = await api.getGatewayConfig();
      setConfig(cfg);
      setEdits({});
      setSelectedKey((prev) =>
        prev && cfg.keys.some((k) => k.key === prev)
          ? prev
          : (cfg.keys[0]?.key ?? ""),
      );
    } catch (e) {
      setLoadErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const original = useMemo(() => {
    const map = new Map<string, string>();
    if (config) for (const k of config.keys) map.set(k.key, k.value);
    return map;
  }, [config]);

  const dirtyKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [key, value] of Object.entries(edits)) {
      if (original.get(key) !== value) set.add(key);
    }
    return set;
  }, [edits, original]);

  const valueFor = useCallback(
    (key: string): string => edits[key] ?? original.get(key) ?? "",
    [edits, original],
  );

  const currentDirty = selectedKey !== "" && dirtyKeys.has(selectedKey);

  function selectKey(key: string) {
    if (key === selectedKey) return;
    if (currentDirty) {
      const ok = window.confirm(
        `You have unsaved edits to "${selectedKey}". Discard them and switch keys?`,
      );
      if (!ok) return;
      setEdits((prev) => {
        const next = { ...prev };
        delete next[selectedKey];
        return next;
      });
    }
    setSelectedKey(key);
  }

  async function save() {
    if (!config || !canEdit || !selectedKey) return;
    setSaving(true);
    try {
      await api.patchGatewayConfig({
        resourceVersion: config.resourceVersion,
        data: { [selectedKey]: valueFor(selectedKey) },
      });
      toast("success", `Saved ${selectedKey}`);
      await loadConfig();
    } catch (e) {
      if (e instanceof ApiClientError && (e.status === 409 || e.code === "Conflict")) {
        const reload = window.confirm(
          "Gateway config changed on the server since you loaded it. Reload the latest version? (your unsaved edits will be lost)",
        );
        if (reload) await loadConfig();
        else toast("error", "Config changed, reload to continue editing.");
      } else {
        toast("error", `Save failed: ${errMsg(e)}`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function restart() {
    if (!canEdit) return;
    if (!window.confirm("Restart the API gateway deployment now? In-flight requests may be dropped.")) {
      return;
    }
    setRestarting(true);
    try {
      await api.restartGateway();
      toast("success", "Gateway restart triggered");
    } catch (e) {
      toast("error", `Restart failed: ${errMsg(e)}`);
    } finally {
      setRestarting(false);
    }
  }

  if (loading && !config) {
    return <Card className="p-12 text-center text-sm text-ink-faint">Loading config…</Card>;
  }

  if (loadErr && !config) {
    return (
      <div className="rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-3 text-sm text-pf-red">
        Could not load gateway config: {loadErr}
      </div>
    );
  }

  if (!config) return null;

  if (config.keys.length === 0) {
    return (
      <EmptyState
        title="No config keys"
        body={`ConfigMap ${config.configMap} in ${config.namespace} has no editable keys.`}
      />
    );
  }

  return (
    <div>
      {/* Meta line */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <span className="font-mono text-ink-muted">{config.namespace}</span>
        <span>·</span>
        <span className="font-mono text-ink-muted">{config.deployment}</span>
        <span>·</span>
        <span>
          ConfigMap <span className="font-mono text-ink-muted">{config.configMap}</span>
        </span>
        <span>·</span>
        <span>rv {config.resourceVersion}</span>
        {roleResolved && !canEdit && (
          <Badge variant="outline" className="border-line bg-line-soft text-ink-muted">
            Read-only (viewer)
          </Badge>
        )}
      </div>

      {/* Key selector */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={selectedKey} onValueChange={selectKey}>
          <SelectTrigger className="h-8 w-auto min-w-[12rem] text-xs" aria-label="config key">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {config.keys.map((k) => (
              <SelectItem key={k.key} value={k.key}>
                {k.key}
                {dirtyKeys.has(k.key) ? " ●" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {currentDirty && (
          <span className="text-xs font-medium text-[#8a6d00]">unsaved edits</span>
        )}
      </div>

      {/* Editor */}
      <Card className="overflow-hidden">
        <textarea
          value={valueFor(selectedKey)}
          onChange={(e) =>
            setEdits((prev) => ({ ...prev, [selectedKey]: e.target.value }))
          }
          readOnly={!canEdit}
          spellCheck={false}
          className={cx(
            "block h-[28rem] w-full resize-y border-0 bg-white px-4 py-3 font-mono text-xs leading-relaxed text-ink outline-none",
            "focus-visible:ring-1 focus-visible:ring-pf-blue",
            !canEdit && "cursor-default text-ink-soft",
          )}
          aria-label={`Value of ${selectedKey}`}
        />
      </Card>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canEdit ? (
          <>
            <Button
              type="button"
              onClick={() => void save()}
              disabled={!currentDirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void restart()}
              disabled={restarting}
            >
              {restarting ? "Restarting…" : "Apply (restart gateway)"}
            </Button>
          </>
        ) : (
          <span className="text-xs text-ink-muted">
            Read-only (viewer) — admin role required to save or restart.
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void loadConfig()}
          disabled={loading || saving}
        >
          Reload
        </Button>
      </div>
    </div>
  );
}
