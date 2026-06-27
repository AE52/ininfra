"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AuditAction, AuditEntry, Page } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cx, fmtTime, timeAgo } from "@/lib/format";
import { useConfig } from "@/components/ConfigProvider";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

const ALL = "all";

// ── Timespan presets ───────────────────────────────────────────────────────
type SincePreset = "all" | "1h" | "24h" | "7d" | "30d" | "custom";

const ACTION_VALUES: AuditAction[] = [
  "view",
  "scale",
  "restart",
  "edit_env",
  "trigger_build",
  "delete_pod",
  "rollback",
  "login",
  "change_branch",
  "edit_hpa",
  "create_user",
  "update_user",
  "delete_user",
  "write_file",
  "delete_file",
  "delete_image",
  "edit_gateway",
  "edit_rbac",
];

const actionMeta: Record<AuditAction, { label: string; cls: string }> = {
  view: { label: "view", cls: "text-ink-muted bg-line-soft" },
  scale: { label: "scale", cls: "text-pf-blue bg-pf-blue-50" },
  restart: { label: "restart", cls: "text-[#8a6d00] bg-pf-gold-50" },
  edit_env: { label: "edit env", cls: "text-violet-700 bg-violet-50" },
  trigger_build: { label: "build", cls: "text-pf-blue bg-pf-blue-50" },
  delete_pod: { label: "delete pod", cls: "text-pf-red bg-pf-red-50" },
  rollback: { label: "rollback", cls: "text-orange-700 bg-orange-50" },
  login: { label: "login", cls: "text-ink-muted bg-line-soft" },
  change_branch: { label: "branch", cls: "text-teal-700 bg-teal-50" },
  edit_hpa: { label: "hpa", cls: "text-indigo-700 bg-indigo-50" },
  create_user: { label: "create user", cls: "text-pf-green bg-pf-green-50" },
  update_user: { label: "update user", cls: "text-pf-blue bg-pf-blue-50" },
  delete_user: { label: "delete user", cls: "text-pf-red bg-pf-red-50" },
  write_file: { label: "write file", cls: "text-violet-700 bg-violet-50" },
  delete_file: { label: "delete file", cls: "text-pf-red bg-pf-red-50" },
  delete_image: { label: "delete image", cls: "text-pf-red bg-pf-red-50" },
  edit_gateway: { label: "edit gateway", cls: "text-violet-700 bg-violet-50" },
  edit_rbac: { label: "edit rbac", cls: "text-violet-700 bg-violet-50" },
};

// ── Regex validation (client-side preview) ─────────────────────────────────
function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

export function AuditTable({ initial }: { initial: Page<AuditEntry> }) {
  const t = useT();
  const { managedNamespaces } = useConfig();

  const [items, setItems] = useState<AuditEntry[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // ── Filter state ────────────────────────────────────────────────────────
  const [actor, setActor] = useState("");
  const [action, setAction] = useState<string>(ALL);
  const [ns, setNs] = useState<string>(ALL);
  const [role, setRole] = useState<string>(ALL);

  // Search + regex
  const [search, setSearch] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const debouncedSearch = useDebouncedValue(search, 350);

  // Timespan
  const [since, setSince] = useState<SincePreset>("all");
  const [fromTs, setFromTs] = useState("");
  const [toTs, setToTs] = useState("");

  const debouncedActor = useDebouncedValue(actor, 300);

  // ── Derived: is anything non-default? ──────────────────────────────────
  const filtered =
    debouncedActor.trim() !== "" ||
    action !== ALL ||
    ns !== ALL ||
    role !== ALL ||
    debouncedSearch.trim() !== "" ||
    since !== "all" ||
    fromTs !== "" ||
    toTs !== "";

  // Regex validity (only matters in regex mode)
  const regexInvalid = useRegex && debouncedSearch.trim() !== "" && !isValidRegex(debouncedSearch.trim());

  // Whether the first paint should still be driven by `initial`.
  const [clientDriven, setClientDriven] = useState(false);

  // ── Build filter params ─────────────────────────────────────────────────
  const buildFilters = useCallback(() => {
    const base = {
      actor: debouncedActor.trim() || undefined,
      action: action === ALL ? undefined : action,
      ns: ns === ALL ? undefined : ns,
      role: role === ALL ? undefined : role,
      q: debouncedSearch.trim() || undefined,
      regex: useRegex && debouncedSearch.trim() !== "" ? true : undefined,
    } as Record<string, unknown>;

    if (since !== "all" && since !== "custom") {
      base.since = since;
    } else if (since === "custom") {
      if (fromTs) base.from = new Date(fromTs).toISOString();
      if (toTs) base.to = new Date(toTs).toISOString();
    }

    return base as Parameters<typeof api.listAudit>[0];
  }, [debouncedActor, action, ns, role, debouncedSearch, useRegex, since, fromTs, toTs]);

  // ── Re-query on filter change ───────────────────────────────────────────
  const seq = useRef(0);
  const reload = useCallback(async () => {
    // Don't fire if regex is currently invalid — wait for user to fix.
    if (regexInvalid) return;
    const mySeq = ++seq.current;
    setLoading(true);
    setErr(null);
    try {
      const page = await api.listAudit({ ...buildFilters(), limit: PAGE_SIZE });
      if (mySeq !== seq.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setOpen(null);
    } catch (e) {
      if (mySeq !== seq.current) return;
      setErr(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [buildFilters, regexInvalid]);

  useEffect(() => {
    if (!clientDriven) return;
    void reload();
  }, [clientDriven, reload]);

  useEffect(() => {
    if (!clientDriven && filtered) setClientDriven(true);
  }, [filtered, clientDriven]);

  // ── Load more ───────────────────────────────────────────────────────────
  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    setErr(null);
    try {
      const page = await api.listAudit({
        ...buildFilters(),
        cursor,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // ── Clear all filters ───────────────────────────────────────────────────
  function clearFilters() {
    setActor("");
    setAction(ALL);
    setNs(ALL);
    setRole(ALL);
    setSearch("");
    setUseRegex(false);
    setSince("all");
    setFromTs("");
    setToTs("");
  }

  return (
    <div>
      {/* ── Filter bar ─────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-start gap-2">

        {/* Search + regex toggle */}
        <div className="flex items-center gap-1">
          <div className="relative">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.audit.searchPlaceholder}
              className={cx(
                "h-8 w-44 text-xs",
                regexInvalid && "border-pf-red focus-visible:ring-pf-red",
              )}
              spellCheck={false}
              aria-label="search audit log"
            />
            {regexInvalid && (
              <span className="absolute -bottom-4 left-0 whitespace-nowrap text-[10px] text-pf-red">
                {t.audit.regexInvalid}
              </span>
            )}
          </div>
          <button
            type="button"
            title={t.audit.regexToggleTitle}
            onClick={() => setUseRegex((v) => !v)}
            className={cx(
              "flex h-8 items-center rounded border px-2 text-[11px] font-mono transition-colors",
              useRegex
                ? "border-pf-blue bg-pf-blue-50 text-pf-blue"
                : "border-line bg-transparent text-ink-faint hover:text-ink-muted",
            )}
            aria-pressed={useRegex}
          >
            {t.audit.regexToggleLabel}
          </button>
        </div>

        {/* Timespan select */}
        <Select value={since} onValueChange={(v) => setSince(v as SincePreset)}>
          <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs" aria-label="time range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.audit.sinceAll}</SelectItem>
            <SelectItem value="1h">{t.audit.since1h}</SelectItem>
            <SelectItem value="24h">{t.audit.since24h}</SelectItem>
            <SelectItem value="7d">{t.audit.since7d}</SelectItem>
            <SelectItem value="30d">{t.audit.since30d}</SelectItem>
            <SelectItem value="custom">{t.audit.customRange}</SelectItem>
          </SelectContent>
        </Select>

        {/* Custom date range inputs */}
        {since === "custom" && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-ink-faint">{t.audit.fromLabel}</span>
            <input
              type="datetime-local"
              value={fromTs}
              onChange={(e) => setFromTs(e.target.value)}
              className="h-8 rounded border border-line bg-transparent px-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-pf-blue"
              aria-label="from date"
            />
            <span className="text-[11px] text-ink-faint">{t.audit.toLabel}</span>
            <input
              type="datetime-local"
              value={toTs}
              onChange={(e) => setToTs(e.target.value)}
              className="h-8 rounded border border-line bg-transparent px-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-pf-blue"
              aria-label="to date"
            />
          </div>
        )}

        {/* Divider */}
        <div className="h-8 w-px self-stretch bg-line" />

        {/* Actor text filter */}
        <Input
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          placeholder={t.audit.filterActor}
          className="h-8 w-36 text-xs"
          spellCheck={false}
          aria-label="filter by actor"
        />

        {/* Action select */}
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs" aria-label="filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.audit.filterAllActions}</SelectItem>
            {ACTION_VALUES.map((a) => (
              <SelectItem key={a} value={a}>
                {actionMeta[a].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Namespace select */}
        <Select value={ns} onValueChange={setNs}>
          <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs" aria-label="filter by namespace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.audit.filterAllNamespaces}</SelectItem>
            {managedNamespaces.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Role select */}
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="h-8 w-auto min-w-[6.5rem] text-xs" aria-label="filter by role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t.audit.filterAllRoles}</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
            <SelectItem value="viewer">viewer</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear button */}
        {filtered && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearFilters}
          >
            {t.audit.clearFilters}
          </Button>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      {items.length === 0 && !loading ? (
        <Card className="p-12 text-center text-sm text-ink-faint">
          {filtered ? t.audit.noEntriesFiltered : t.audit.noEntries}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <TableHead className="px-4 py-2.5 font-medium">{t.audit.colWhen}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.audit.colActor}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.audit.colAction}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.audit.colKind}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.audit.colTargetName}</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">{t.audit.colNamespace}</TableHead>
                  <TableHead className="px-4 py-2.5" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((e) => {
                  const m = actionMeta[e.action as AuditAction] ?? actionMeta.view;
                  const hasDetail = e.detail && Object.keys(e.detail).length > 0;
                  const isOpen = open === e.id;
                  return (
                    <Fragment key={e.id}>
                      <TableRow className="border-b border-line last:border-0 hover:bg-line-soft">
                        {/* When — relative + absolute on hover */}
                        <TableCell className="px-4 py-3 text-xs text-ink-muted">
                          <span title={fmtTime(e.ts)} className="cursor-default">
                            {timeAgo(e.ts)}
                          </span>
                          <div className="mt-0.5 text-[10px] text-ink-faint">
                            {fmtTime(e.ts)}
                          </div>
                        </TableCell>

                        {/* Actor */}
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-soft">
                          {e.actor}
                        </TableCell>

                        {/* Action badge */}
                        <TableCell className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={cx(
                              "border-transparent px-2 py-0.5 text-[11px] font-medium",
                              m.cls,
                            )}
                          >
                            {m.label}
                          </Badge>
                        </TableCell>

                        {/* Kind */}
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-faint">
                          {e.targetKind ?? <span className="text-ink-faint">—</span>}
                        </TableCell>

                        {/* Target name */}
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-muted">
                          {e.targetName ?? <span className="text-ink-faint">—</span>}
                        </TableCell>

                        {/* Namespace */}
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-faint">
                          {e.targetNs ?? <span className="text-ink-faint">—</span>}
                        </TableCell>

                        {/* Detail toggle */}
                        <TableCell className="px-4 py-3 text-right">
                          {hasDetail && (
                            <button
                              type="button"
                              onClick={() => setOpen(isOpen ? null : e.id)}
                              className="text-xs text-ink-faint hover:text-pf-blue"
                            >
                              {isOpen ? t.audit.hide : t.audit.detail}
                            </button>
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Expandable JSON detail */}
                      {isOpen && hasDetail && (
                        <TableRow className="border-b border-line bg-line-soft">
                          <TableCell colSpan={7} className="px-4 py-3">
                            <pre className="logwell overflow-x-auto rounded bg-[#1b1d21] p-3 font-mono text-[11.5px] text-[#d2d2d2]">
                              {JSON.stringify(e.detail, null, 2)}
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

      {err && (
        <div className="mt-3 text-center text-xs text-pf-red">{err}</div>
      )}

      <div className="mt-4 flex justify-center">
        {cursor ? (
          <Button
            type="button"
            onClick={loadMore}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            {loading ? t.audit.loading : t.audit.loadMore}
          </Button>
        ) : (
          items.length > 0 && (
            <span className="text-xs text-ink-faint">{t.audit.endOfHistory}</span>
          )
        )}
      </div>
    </div>
  );
}
