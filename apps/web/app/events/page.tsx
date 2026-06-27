"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EventInfo, Namespace } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, EmptyState } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pager } from "@/components/Pager";
import { useConfig } from "@/components/ConfigProvider";
import { cx, timeAgo } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SinceOption = "1h" | "6h" | "24h" | "48h" | "7d" | "";

const SINCE_LABELS: { value: SinceOption; label: string }[] = [
  { value: "", label: "All" },
  { value: "1h", label: "Last 1h" },
  { value: "6h", label: "Last 6h" },
  { value: "24h", label: "Last 24h" },
  { value: "48h", label: "Last 48h" },
  { value: "7d", label: "Last 7d" },
];

export default function EventsPage() {
  const t = useT();
  const { managedNamespaces } = useConfig();
  const [ns, setNs] = useState<Namespace>(managedNamespaces[0] ?? "");
  const [rows, setRows] = useState<EventInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyWarn, setOnlyWarn] = useState(false);
  // Search + time-range filters.
  const [search, setSearch] = useState("");
  const [since, setSince] = useState<SinceOption>("24h");
  // Debounce search input to avoid hammering on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cursor stack: each entry is the cursor used to fetch that page.
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  const cursor = stack[stack.length - 1];

  // Debounce search changes — reset pagination and fire after 350ms idle.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setStack([undefined]);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const load = useCallback(async () => {
    if (!ns) return;
    setRows(null);
    try {
      setError(null);
      const page = await api.listEvents(ns, {
        q: debouncedSearch || undefined,
        since: since || undefined,
        cursor,
      });
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (e) {
      setError(e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e));
    }
  }, [ns, cursor, debouncedSearch, since]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset pagination when the namespace or filters change.
  useEffect(() => {
    setStack([undefined]);
  }, [ns, since]);

  const shown = (rows ?? []).filter((e) => !onlyWarn || e.type !== "Normal");

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.events.kicker}
        title={t.events.title}
        subtitle={t.events.subtitle}
        actions={
          <Button onClick={load} variant="outline" size="sm">
            {t.events.refreshBtn}
          </Button>
        }
      />

      {/* Namespace + Warning filter row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {managedNamespaces.map((n) => (
          <Button key={n} onClick={() => setNs(n)} size="sm" variant={ns === n ? "default" : "outline"}>
            {n}
          </Button>
        ))}
        <label className="ml-3 flex items-center gap-1.5 text-xs text-ink-muted">
          <input type="checkbox" checked={onlyWarn} onChange={(e) => setOnlyWarn(e.target.checked)} />
          {t.events.onlyWarnings}
        </label>
      </div>

      {/* Search + Time-range row */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {/* Search input */}
        <input
          type="search"
          placeholder="Search reason, message, name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cx(
            "h-8 w-64 rounded-md border border-line-soft bg-canvas px-3 text-xs text-ink",
            "placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-brand",
          )}
        />
        {/* Time-range select */}
        <select
          value={since}
          onChange={(e) => setSince(e.target.value as SinceOption)}
          className={cx(
            "h-8 rounded-md border border-line-soft bg-canvas px-2 text-xs text-ink",
            "focus:outline-none focus:ring-1 focus:ring-brand",
          )}
        >
          {SINCE_LABELS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <ErrorPanel message={error} />}
      {rows && shown.length === 0 && <EmptyState title={t.events.noEvents} />}
      {shown.length > 0 && (
        <div className="space-y-1.5">
          {shown.map((e, i) => (
            <Card key={i} className="flex items-start gap-3 px-4 py-2.5">
              <Badge variant="outline" className={cx("mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                e.type === "Normal" ? "border-transparent bg-line-soft text-ink-soft" : "border-transparent bg-pf-red-50 text-pf-red")}>
                {e.type || "?"}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink-soft">
                  <span className="font-medium text-ink">{e.reason}</span>
                  <span className="ml-2 font-mono text-[11px] text-ink-faint">
                    {e.involvedKind}/{e.involvedName}
                  </span>
                </div>
                <div className="text-xs text-ink-muted">{e.message}</div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-ink-faint">
                {e.count > 1 && <span className="mr-2">×{e.count}</span>}
                {e.source && <span className="mr-2 opacity-60">{e.source}</span>}
                {timeAgo(e.lastSeen)}
              </div>
            </Card>
          ))}
        </div>
      )}
      {rows && !error && (
        <Pager
          hasPrev={stack.length > 1}
          hasNext={!!nextCursor}
          total={total}
          shown={shown.length}
          onPrev={() => setStack((s) => s.slice(0, -1))}
          onNext={() => nextCursor && setStack((s) => [...s, nextCursor])}
        />
      )}
      {!rows && !error && <div className="text-sm text-ink-faint">{t.events.loading}</div>}
    </div>
  );
}
