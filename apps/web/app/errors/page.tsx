"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ErrorEvent, ErrorSource, Page } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { cx, fmtTime, timeAgo } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { PageHeader, EmptyState } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const PAGE_SIZE = 25;

const ALL = "all";

const STATUS_CODES = [400, 401, 403, 404, 409, 500, 502, 503] as const;

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : String(e);
}

function sourceChipCls(source: ErrorSource): string {
  return source === "client"
    ? "text-pf-blue bg-pf-blue-50"
    : "text-ink-muted bg-line-soft";
}

/** HTTP status → color token (>=500 red, >=400 amber/gold, else muted). */
function statusCls(status: number): string {
  if (status >= 500) return "text-pf-red";
  if (status >= 400) return "text-[#8a6d00]";
  return "text-ink-muted";
}

export default function ErrorsPage() {
  const [role, setRole] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [meError, setMeError] = useState<string | null>(null);

  // me() on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (alive) setRole(me.role);
      } catch (e) {
        if (alive) setMeError(errMsg(e));
      } finally {
        if (alive) setMeReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!meReady) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker="Administration" title="Errors" />
        <Card className="p-12 text-center text-sm text-ink-faint">
          Loading…
        </Card>
      </div>
    );
  }

  if (meError || role !== "admin") {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker="Administration" title="Errors" />
        <EmptyState
          title="Admins only"
          body={
            meError
              ? `Could not verify your role: ${meError}`
              : "You need the admin role to view the error feed."
          }
        />
      </div>
    );
  }

  return <ErrorsAdmin />;
}

function ErrorsAdmin() {
  const [items, setItems] = useState<ErrorEvent[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Stack of cursors used to reach the CURRENT page (last entry = current page cursor).
  const [stack, setStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Filter state.
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<string>(ALL);
  const [source, setSource] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);

  const debouncedUsername = useDebouncedValue(username, 300);

  const hasFilters =
    debouncedUsername.trim() !== "" ||
    status !== ALL ||
    source !== ALL ||
    role !== ALL;

  const buildFilters = useCallback(
    () => ({
      username: debouncedUsername.trim() || undefined,
      status: status === ALL ? undefined : Number(status),
      source: source === ALL ? undefined : source,
      role: role === ALL ? undefined : role,
    }),
    [debouncedUsername, status, source, role],
  );

  // Guard against out-of-order responses when paging / filtering rapidly.
  const seq = useRef(0);
  const load = useCallback(
    async (cursor: string | null) => {
      const mySeq = ++seq.current;
      setLoading(true);
      setListErr(null);
      try {
        const page: Page<ErrorEvent> = await api.listErrors({
          ...buildFilters(),
          cursor: cursor ?? undefined,
          limit: PAGE_SIZE,
        });
        if (mySeq !== seq.current) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setTotal(page.total ?? null);
      } catch (e) {
        if (mySeq === seq.current) setListErr(errMsg(e));
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    },
    [buildFilters],
  );

  // Initial load + reset to page 1 whenever a filter changes.
  useEffect(() => {
    setStack([null]);
    setOpen(null);
    void load(null);
  }, [load]);

  function goNext() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setStack((s) => [...s, cursor]);
    setOpen(null);
    void load(cursor);
  }

  function goPrev() {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    setOpen(null);
    void load(next[next.length - 1]);
  }

  function clearFilters() {
    setUsername("");
    setStatus(ALL);
    setSource(ALL);
    setRole(ALL);
  }

  const hasPrev = stack.length > 1;

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Administration"
        title="Errors"
        subtitle="Captured server request failures and browser-reported client errors, newest first."
      />

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username…"
          className="h-8 w-40 text-xs"
          spellCheck={false}
          aria-label="filter by username"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs" aria-label="filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUS_CODES.map((c) => (
              <SelectItem key={c} value={String(c)}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs" aria-label="filter by source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All sources</SelectItem>
            <SelectItem value="server">server</SelectItem>
            <SelectItem value="client">client</SelectItem>
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-8 w-auto min-w-[6.5rem] text-xs" aria-label="filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="viewer">viewer</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {listErr && (
        <div className="mb-4 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {listErr}
        </div>
      )}

      {items.length === 0 && !loading && !listErr ? (
        <EmptyState
          title="No errors"
          body={
            hasFilters
              ? "No errors match these filters."
              : "No errors have been captured yet."
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[920px] text-sm">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <TableHead className="px-4 py-2.5 font-medium">When</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">User</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Source</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Status</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Code</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Message</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Path</TableHead>
                  <TableHead className="px-4 py-2.5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => {
                  const isOpen = open === e.id;
                  const hasDetail =
                    e.detail && Object.keys(e.detail).length > 0;
                  return (
                    <Fragment key={e.id}>
                      <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-line-soft">
                        <TableCell
                          className="px-4 py-3 text-xs text-ink-muted"
                          title={fmtTime(e.ts)}
                        >
                          {timeAgo(e.ts)}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-soft">
                          {e.username ?? (
                            <span className="text-ink-faint">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={cx(
                              "border-transparent px-2 py-0.5 text-[11px] font-medium",
                              sourceChipCls(e.source),
                            )}
                          >
                            {e.source}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {e.status != null ? (
                            <span
                              className={cx(
                                "tabular font-mono text-xs font-medium",
                                statusCls(e.status),
                              )}
                            >
                              {e.status}
                            </span>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-muted">
                          {e.code ?? <span className="text-ink-faint">—</span>}
                        </TableCell>
                        <TableCell
                          className="max-w-[320px] truncate px-4 py-3 text-ink"
                          title={e.message}
                        >
                          {e.message}
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate px-4 py-3 font-mono text-xs text-ink-muted"
                          title={e.path ?? undefined}
                        >
                          {e.path ?? <span className="text-ink-faint">—</span>}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setOpen(isOpen ? null : e.id)}
                            className="text-xs text-ink-faint hover:text-pf-blue"
                          >
                            {isOpen ? "hide" : "detail"}
                          </button>
                        </TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="border-b border-line bg-line-soft">
                          <TableCell colSpan={8} className="px-4 py-3">
                            <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11.5px] text-ink-muted">
                              <span>
                                <span className="text-ink-faint">method </span>
                                {e.method ?? "—"}
                              </span>
                              <span>
                                <span className="text-ink-faint">path </span>
                                {e.path ?? "—"}
                              </span>
                              <span>
                                <span className="text-ink-faint">status </span>
                                {e.status ?? "—"}
                              </span>
                            </div>
                            <pre className="logwell overflow-x-auto rounded bg-[#1b1d21] p-3 font-mono text-[11.5px] text-[#d2d2d2]">
                              {hasDetail
                                ? JSON.stringify(e.detail, null, 2)
                                : "{}"}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {loading
            ? "Loading…"
            : total != null
              ? `${total} error${total === 1 ? "" : "s"} total`
              : `${items.length} shown`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={!hasPrev || loading}
          >
            Prev
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={!nextCursor || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
