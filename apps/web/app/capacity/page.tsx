"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CapacityResponse,
  LimitRangeItem,
  NamespaceQuota,
  QuotaResource,
} from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useConfig } from "@/components/ConfigProvider";
import { PageHeader, Stat, Meter, EmptyState, NamespaceTag } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { cpuToCores, cx, fmtBytes, memToBytes } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ALL = "__all__";

/* ---- unit formatters (CPU in millicores, memory in MiB on the wire) ---- */

/** Millicores → "Xm" (< 1 core) or "X.YY" cores. */
function cpuM(m: number): string {
  if (m === 0) return "0";
  return m < 1000 ? `${m}m` : (m / 1000).toFixed(2);
}

/** MiB → "X Mi" or "X.Y Gi". */
function memMi(mi: number): string {
  if (mi === 0) return "0";
  return mi < 1024 ? `${mi} Mi` : `${(mi / 1024).toFixed(1)} Gi`;
}

/** Safe ratio, clamped at 0 when the denominator is non-positive. */
function ratio(used: number, total: number): number {
  return total > 0 ? used / total : 0;
}

/**
 * Parse a ResourceQuota quantity string for ratio math. CPU resources are
 * millicores-normalised, memory/storage are bytes, everything else (object
 * counts like `pods`, `services`) is a plain number.
 */
function quotaValue(resource: string, q: string): number {
  const r = resource.toLowerCase();
  if (r.includes("cpu")) return cpuToCores(q) * 1000; // millicores
  if (r.includes("memory") || r.includes("storage") || r.includes("ephemeral"))
    return memToBytes(q);
  const n = parseFloat(q);
  return Number.isFinite(n) ? n : 0;
}

export default function CapacityPage() {
  const { managedNamespaces } = useConfig();

  const [cap, setCap] = useState<CapacityResponse | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  const [ns, setNs] = useState<string>(ALL);
  const [quotas, setQuotas] = useState<NamespaceQuota[] | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  const loadCapacity = useCallback(async () => {
    setCap(null);
    try {
      setCapError(null);
      setCap(await api.getCapacity());
    } catch (e) {
      setCapError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    }
  }, []);

  const loadQuotas = useCallback(async () => {
    setQuotas(null);
    try {
      setQuotaError(null);
      setQuotas(await api.listQuotas(ns === ALL ? undefined : ns));
    } catch (e) {
      setQuotaError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    }
  }, [ns]);

  useEffect(() => {
    loadCapacity();
  }, [loadCapacity]);
  useEffect(() => {
    loadQuotas();
  }, [loadQuotas]);

  const cluster = cap?.cluster;
  const reqCpuPct = cluster ? ratio(cluster.requestedCpuM, cluster.allocatableCpuM) : 0;
  const reqMemPct = cluster ? ratio(cluster.requestedMemMi, cluster.allocatableMemMi) : 0;
  const usedCpuPct =
    cluster && cluster.usedCpuM !== null
      ? ratio(cluster.usedCpuM, cluster.allocatableCpuM)
      : null;
  const usedMemPct =
    cluster && cluster.usedMemMi !== null
      ? ratio(cluster.usedMemMi, cluster.allocatableMemMi)
      : null;

  // Quota section namespaces with anything to show.
  const nsWithData =
    quotas?.filter(
      (n) => n.quotas.length > 0 || n.limitRanges.length > 0,
    ) ?? [];

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Compute"
        title="Capacity"
        subtitle="Schedulable allocatable vs requested vs live-used CPU/memory per node and cluster-wide, plus per-namespace quotas. Read-only."
        actions={
          <Button
            onClick={() => {
              loadCapacity();
              loadQuotas();
            }}
            variant="outline"
            size="sm"
          >
            Refresh
          </Button>
        }
      />

      {/* ───────────────────────── Section 1: cluster + nodes ─────────────── */}
      <h2 className="mb-3 text-sm font-semibold text-ink">Cluster capacity</h2>

      {capError && (
        <div className="mb-4">
          <ErrorPanel message={capError} />
        </div>
      )}

      {cap === null && !capError && (
        <div className="mb-6 text-sm text-ink-faint">Loading…</div>
      )}

      {cluster && (
        <>
          {!cluster.metricsAvailable && (
            <div className="mb-4 rounded-md border border-pf-gold/30 bg-pf-gold-50 px-3 py-2 text-xs text-[#8a6d00]">
              metrics-server not detected — live usage unavailable. Showing
              allocatable vs requested only.
            </div>
          )}

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Allocatable CPU"
              value={cpuM(cluster.allocatableCpuM)}
              hint="schedulable, cluster-wide"
              accent="sky"
            />
            <Stat
              label="Requested CPU"
              value={`${Math.round(reqCpuPct * 100)}%`}
              hint={`${cpuM(cluster.requestedCpuM)} requested`}
              accent={reqCpuPct > 0.9 ? "rose" : reqCpuPct > 0.75 ? "amber" : "lime"}
            />
            <Stat
              label="Used CPU"
              value={usedCpuPct === null ? "—" : `${Math.round(usedCpuPct * 100)}%`}
              hint={
                cluster.usedCpuM === null
                  ? "metrics unavailable"
                  : `${cpuM(cluster.usedCpuM)} live`
              }
              accent={
                usedCpuPct === null
                  ? "slate"
                  : usedCpuPct > 0.9
                    ? "rose"
                    : "lime"
              }
            />
            <Stat
              label="CPU headroom"
              value={cpuM(cluster.headroomCpuM)}
              hint="allocatable − requested"
              accent={cluster.headroomCpuM <= 0 ? "rose" : "slate"}
            />

            <Stat
              label="Allocatable Mem"
              value={memMi(cluster.allocatableMemMi)}
              hint="schedulable, cluster-wide"
              accent="sky"
            />
            <Stat
              label="Requested Mem"
              value={`${Math.round(reqMemPct * 100)}%`}
              hint={`${memMi(cluster.requestedMemMi)} requested`}
              accent={reqMemPct > 0.9 ? "rose" : reqMemPct > 0.75 ? "amber" : "lime"}
            />
            <Stat
              label="Used Mem"
              value={usedMemPct === null ? "—" : `${Math.round(usedMemPct * 100)}%`}
              hint={
                cluster.usedMemMi === null
                  ? "metrics unavailable"
                  : `${memMi(cluster.usedMemMi)} live`
              }
              accent={
                usedMemPct === null
                  ? "slate"
                  : usedMemPct > 0.9
                    ? "rose"
                    : "lime"
              }
            />
            <Stat
              label="Mem headroom"
              value={memMi(cluster.headroomMemMi)}
              hint="allocatable − requested"
              accent={cluster.headroomMemMi <= 0 ? "rose" : "slate"}
            />
          </div>

          {cap.nodes.length === 0 ? (
            <EmptyState title="No nodes" body="The API returned no nodes." />
          ) : (
            <Card className="mb-8 overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                      <TableHead className="px-4 py-2.5 font-medium">Node</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">CPU</TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">Memory</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cap.nodes.map((n) => {
                      const cpuReq = ratio(n.requestedCpuM, n.allocatableCpuM);
                      const cpuUse =
                        n.usedCpuM !== null
                          ? ratio(n.usedCpuM, n.allocatableCpuM)
                          : null;
                      const memReq = ratio(n.requestedMemMi, n.allocatableMemMi);
                      const memUse =
                        n.usedMemMi !== null
                          ? ratio(n.usedMemMi, n.allocatableMemMi)
                          : null;
                      return (
                        <TableRow
                          key={n.name}
                          className="border-b border-line align-top text-sm hover:bg-line-soft/40"
                        >
                          <TableCell className="px-4 py-3">
                            <span className="font-mono text-xs text-ink">
                              {n.name}
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <NodeBar
                              reqRatio={cpuReq}
                              useRatio={cpuUse}
                              reqLabel={`${cpuM(n.requestedCpuM)} req`}
                              useLabel={
                                n.usedCpuM !== null ? `${cpuM(n.usedCpuM)} used` : null
                              }
                              allocLabel={`${cpuM(n.allocatableCpuM)} alloc`}
                            />
                          </TableCell>
                          <TableCell className="px-4 py-3">
                            <NodeBar
                              reqRatio={memReq}
                              useRatio={memUse}
                              reqLabel={`${memMi(n.requestedMemMi)} req`}
                              useLabel={
                                n.usedMemMi !== null
                                  ? `${memMi(n.usedMemMi)} used`
                                  : null
                              }
                              allocLabel={`${memMi(n.allocatableMemMi)} alloc`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ───────────────────────── Section 2: namespace quotas ────────────── */}
      <h2 className="mb-3 text-sm font-semibold text-ink">Namespace quotas</h2>

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

      {quotaError && (
        <div className="mb-4">
          <ErrorPanel message={quotaError} />
        </div>
      )}

      {quotas === null && !quotaError && (
        <div className="text-sm text-ink-faint">Loading…</div>
      )}

      {quotas !== null && !quotaError && nsWithData.length === 0 && (
        <EmptyState
          title="No quotas or limit ranges"
          body="No ResourceQuota or LimitRange objects found in this scope."
        />
      )}

      {nsWithData.length > 0 && (
        <div className="space-y-4">
          {nsWithData.map((n) => (
            <NamespaceQuotaCard key={n.namespace} data={n} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A stacked node resource bar: live usage (when present) layered over requests,
 * both as a fraction of allocatable. Falls back to a requests-only bar when the
 * node has no metrics sample.
 */
function NodeBar({
  reqRatio,
  useRatio,
  reqLabel,
  useLabel,
  allocLabel,
}: {
  reqRatio: number;
  useRatio: number | null;
  reqLabel: string;
  useLabel: string | null;
  allocLabel: string;
}) {
  // When live usage is available, show it as the primary meter (it's the truth
  // of what the node is doing); otherwise show requests.
  const primary = useRatio !== null ? useRatio : reqRatio;
  const tone = primary > 0.9 ? "rose" : primary > 0.75 ? "amber" : "sky";
  return (
    <div className="min-w-[200px]">
      <Meter ratio={primary} tone={tone} />
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-faint">
        {useLabel ? (
          <span className="text-ink-soft">{useLabel}</span>
        ) : (
          <span className="text-ink-faint" title="metrics-server not detected">
            no metrics
          </span>
        )}
        <span>{reqLabel}</span>
        <span>{allocLabel}</span>
        <span className="tabular">{Math.round(primary * 100)}%</span>
      </div>
    </div>
  );
}

function NamespaceQuotaCard({ data }: { data: NamespaceQuota }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <NamespaceTag ns={data.namespace} />
      </div>

      {data.quotas.length === 0 ? (
        <div className="text-xs text-ink-faint">No ResourceQuota.</div>
      ) : (
        <div className="space-y-4">
          {data.quotas.map((qInfo) => (
            <div key={qInfo.name}>
              <div className="mb-2 font-mono text-xs text-ink-muted">
                {qInfo.name}
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {qInfo.hard.map((r) => (
                  <QuotaBar key={r.resource} r={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {data.limitRanges.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            LimitRange defaults
          </div>
          <div className="space-y-3">
            {data.limitRanges.map((lr) => (
              <div key={lr.name}>
                <div className="mb-1 font-mono text-xs text-ink-muted">
                  {lr.name}
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[520px] text-xs">
                    <TableHeader>
                      <TableRow className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                        <TableHead className="px-3 py-1.5 font-medium">Type</TableHead>
                        <TableHead className="px-3 py-1.5 font-medium">Resource</TableHead>
                        <TableHead className="px-3 py-1.5 text-right font-medium">Default req</TableHead>
                        <TableHead className="px-3 py-1.5 text-right font-medium">Default limit</TableHead>
                        <TableHead className="px-3 py-1.5 text-right font-medium">Min</TableHead>
                        <TableHead className="px-3 py-1.5 text-right font-medium">Max</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lr.limits.map((item) => (
                        <LimitRangeRow
                          key={`${item.type}/${item.resource}`}
                          item={item}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function QuotaBar({ r }: { r: QuotaResource }) {
  const used = quotaValue(r.resource, r.used);
  const hard = quotaValue(r.resource, r.hard);
  const pct = ratio(used, hard);
  // Red when at/over hard, amber when close (>= 85%), else neutral/sky.
  const tone = pct >= 1 ? "rose" : pct >= 0.85 ? "amber" : "sky";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-mono text-ink-muted">{r.resource}</span>
        <span
          className={cx(
            "tabular shrink-0 font-mono",
            pct >= 1 ? "text-pf-red" : "text-ink-soft",
          )}
        >
          {r.used} / {r.hard}
        </span>
      </div>
      <Meter ratio={pct} tone={tone} />
    </div>
  );
}

function LimitRangeRow({ item }: { item: LimitRangeItem }) {
  return (
    <TableRow className="border-b border-line">
      <TableCell className="px-3 py-1.5 text-ink-muted">{item.type}</TableCell>
      <TableCell className="px-3 py-1.5 font-mono text-ink-soft">
        {item.resource}
      </TableCell>
      <TableCell className="tabular px-3 py-1.5 text-right font-mono text-ink-soft">
        {item.defaultRequest ?? "—"}
      </TableCell>
      <TableCell className="tabular px-3 py-1.5 text-right font-mono text-ink-soft">
        {item.default ?? "—"}
      </TableCell>
      <TableCell className="tabular px-3 py-1.5 text-right font-mono text-ink-soft">
        {item.min ?? "—"}
      </TableCell>
      <TableCell className="tabular px-3 py-1.5 text-right font-mono text-ink-soft">
        {item.max ?? "—"}
      </TableCell>
    </TableRow>
  );
}
