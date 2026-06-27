"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Namespace,
  RightsizingRecommendation,
  RightsizingRow,
} from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { PageHeader, EmptyState, NamespaceTag } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pager } from "@/components/Pager";
import { useConfig } from "@/components/ConfigProvider";
import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ALL = "__all__";

/** Visual + label tokens for each advisory verdict. */
const recMeta: Record<
  RightsizingRecommendation,
  { label: string; bg: string; text: string }
> = {
  over_provisioned: {
    label: "Over-provisioned",
    bg: "bg-pf-gold-50 border-pf-gold/30",
    text: "text-[#8a6d00]",
  },
  under_provisioned: {
    label: "Throttle risk",
    bg: "bg-pf-red-50 border-pf-red/30",
    text: "text-pf-red",
  },
  no_requests: {
    label: "No requests",
    bg: "bg-line-soft border-line",
    text: "text-ink-muted",
  },
  ok: {
    label: "OK",
    bg: "bg-pf-green-50 border-pf-green/30",
    text: "text-pf-green",
  },
  unknown: {
    label: "—",
    bg: "bg-line-soft border-line",
    text: "text-ink-faint",
  },
};

function RecBadge({ rec }: { rec: RightsizingRecommendation }) {
  const m = recMeta[rec];
  return (
    <Badge
      variant="outline"
      className={cx("text-[11px] font-medium", m.bg, m.text)}
    >
      {m.label}
    </Badge>
  );
}

/** Render millicores as "Xm" (< 1 core) or "X.YY" cores; em-dash when null. */
function cpu(m: number | null): string {
  if (m === null) return "—";
  if (m === 0) return "0";
  return m < 1000 ? `${m}m` : `${(m / 1000).toFixed(2)}`;
}

/** Render MiB as "X Mi" or "X.Y Gi"; em-dash when null. */
function mem(mi: number | null): string {
  if (mi === null) return "—";
  if (mi === 0) return "0";
  return mi < 1024 ? `${mi} Mi` : `${(mi / 1024).toFixed(1)} Gi`;
}

export default function RightsizingPage() {
  const { managedNamespaces } = useConfig();
  const [ns, setNs] = useState<string>(ALL);
  const [rows, setRows] = useState<RightsizingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  const cursor = stack[stack.length - 1];

  const load = useCallback(async () => {
    setRows(null);
    try {
      setError(null);
      const page = await api.listRightsizing(ns === ALL ? undefined : ns, {
        cursor,
      });
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    }
  }, [ns, cursor]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset pagination whenever the namespace filter changes.
  useEffect(() => {
    setStack([undefined]);
  }, [ns]);

  // metrics-server detection: if every fetched row reports no metrics, surface a
  // cluster-wide notice. (When a page has zero rows we can't tell, so stay quiet.)
  const metricsUnavailable =
    rows !== null && rows.length > 0 && rows.every((r) => !r.metricsAvailable);

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Compute"
        title="Right-sizing"
        subtitle="Configured requests & limits next to live usage, with advisory recommendations. Read-only — nothing is applied automatically."
        actions={
          <Button onClick={load} variant="outline" size="sm">
            Refresh
          </Button>
        }
      />

      {/* Namespace filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setNs(ALL)}
          size="sm"
          variant={ns === ALL ? "default" : "outline"}
        >
          All namespaces
        </Button>
        {managedNamespaces.map((n) => (
          <Button
            key={n}
            onClick={() => setNs(n)}
            size="sm"
            variant={ns === n ? "default" : "outline"}
          >
            {n}
          </Button>
        ))}
      </div>

      {metricsUnavailable && (
        <div className="mb-4 rounded-md border border-pf-gold/30 bg-pf-gold-50 px-3 py-2 text-xs text-[#8a6d00]">
          metrics-server not detected — usage unavailable. Showing configured
          requests &amp; limits only.
        </div>
      )}

      {error && (
        <div className="mb-4">
          <ErrorPanel message={error} />
        </div>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <EmptyState
          title="No workloads"
          body="No Deployments or StatefulSets found in this scope."
        />
      )}

      {!error && rows !== null && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <TableHead className="px-4 py-2.5 font-medium">
                    Workload
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Replicas
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Req CPU
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Lim CPU
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Req Mem
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Lim Mem
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Usage CPU
                  </TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium">
                    Usage Mem
                  </TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">
                    Recommendation
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow
                    key={`${r.namespace}/${r.kind}/${r.name}`}
                    className="border-b border-line text-sm hover:bg-line-soft/40"
                  >
                    <TableCell className="px-4 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-ink">{r.name}</span>
                        <div className="flex items-center gap-1.5">
                          <NamespaceTag ns={r.namespace} />
                          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                            {r.kind}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right text-ink-soft">
                      {r.replicas}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right font-mono text-ink-soft">
                      {cpu(r.requestsCpuM)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right font-mono text-ink-soft">
                      {cpu(r.limitsCpuM)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right font-mono text-ink-soft">
                      {mem(r.requestsMemMi)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right font-mono text-ink-soft">
                      {mem(r.limitsMemMi)}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right font-mono text-ink-soft">
                      {r.metricsAvailable ? (
                        <span title="per-replica average">
                          {cpu(r.usageCpuMPerReplica)}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular px-4 py-2.5 text-right font-mono text-ink-soft">
                      {r.metricsAvailable ? (
                        <span title="per-replica average">
                          {mem(r.usageMemMiPerReplica)}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-2.5">
                      <RecBadge rec={r.recommendation} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {rows !== null && !error && rows.length > 0 && (
        <Pager
          hasPrev={stack.length > 1}
          hasNext={!!nextCursor}
          total={total}
          shown={rows.length}
          onPrev={() => setStack((s) => s.slice(0, -1))}
          onNext={() => nextCursor && setStack((s) => [...s, nextCursor])}
        />
      )}

      {rows === null && !error && (
        <div className="text-sm text-ink-faint">Loading…</div>
      )}
    </div>
  );
}
