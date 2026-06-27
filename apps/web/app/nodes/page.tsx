import Link from "next/link";
import type { CapacityType, NodeInfo } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { capacityTypeMeta, cpuToCores, cx, fmtBytes, memToBytes, timeAgo } from "@/lib/format";
import { PageHeader, Stat, Meter, EmptyState } from "@/components/ui";
import { Dot } from "@/components/StatusBadge";
import { ErrorPanel } from "@/components/ErrorPanel";
import { CursorPager } from "@/components/Pager";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type TypeFilter = "all" | "spot" | "on-demand";

export default async function NodesPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; type?: string }>;
}) {
  const { c, type } = await searchParams;
  const cursor = c?.split(",").filter(Boolean).at(-1);
  const filter: TypeFilter =
    type === "spot" || type === "on-demand" ? type : "all";

  let nodes: NodeInfo[] = [];
  let nextCursor: string | null = null;
  let total: number | null | undefined;
  let error: string | null = null;
  try {
    const api = await getServerApi();
    const page = await api.listNodes({ cursor });
    nodes = page.items;
    nextCursor = page.nextCursor;
    total = page.total;
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  // Stats reflect the full fetched page; the capacity-type filter then narrows
  // which cards render. Pagination (?c=) is independent of ?type=.
  const totalCpu = nodes.reduce((a, n) => a + cpuToCores(n.capacityCpu), 0);
  const totalMem = nodes.reduce((a, n) => a + memToBytes(n.capacityMemory), 0);
  const totalPods = nodes.reduce((a, n) => a + n.podCount, 0);
  const ready = nodes.filter((n) => n.ready).length;
  const spotCount = nodes.filter((n) => n.capacityType === "spot").length;
  const onDemandCount = nodes.filter((n) => n.capacityType === "on-demand").length;

  const shownNodes =
    filter === "all" ? nodes : nodes.filter((n) => n.capacityType === filter);

  // Preserve the active cursor when switching the capacity-type filter.
  const filterHref = (t: TypeFilter) => {
    const p = new URLSearchParams();
    if (c) p.set("c", c);
    if (t !== "all") p.set("type", t);
    const qs = p.toString();
    return qs ? `/nodes?${qs}` : "/nodes";
  };

  const filters: Array<{ key: TypeFilter; label: string; count: number }> = [
    { key: "all", label: "All", count: nodes.length },
    { key: "spot", label: "Spot", count: spotCount },
    { key: "on-demand", label: "On-demand", count: onDemandCount },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Infrastructure"
        title="Nodes"
        subtitle="Worker capacity and scheduling pressure across the EKS cluster."
      />

      {error && <div className="mb-6"><ErrorPanel message={error} /></div>}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Nodes" value={`${ready}/${nodes.length}`} hint="ready" accent={ready < nodes.length ? "amber" : "lime"} />
        <Stat label="Spot / On-demand" value={`${spotCount} / ${onDemandCount}`} hint="capacity type" accent="sky" />
        <Stat label="vCPU" value={totalCpu.toFixed(0)} hint="total capacity" accent="sky" />
        <Stat label="Memory" value={fmtBytes(totalMem)} hint="total capacity" accent="sky" />
        <Stat label="Pods" value={totalPods} hint="scheduled" />
      </div>

      {!error && nodes.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {filters.map((f) => (
            <Link
              key={f.key}
              href={filterHref(f.key)}
              className={cx(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                filter === f.key
                  ? "border-pf-blue/30 bg-pf-blue-50 text-pf-blue"
                  : "border-line bg-surface-raised text-ink-muted hover:text-ink-soft",
              )}
            >
              {f.label}
              <span className="tabular ml-1.5 text-ink-faint">{f.count}</span>
            </Link>
          ))}
        </div>
      )}

      {nodes.length === 0 && !error ? (
        <EmptyState title="No nodes" body="The API returned no nodes." />
      ) : shownNodes.length === 0 ? (
        <EmptyState
          title="No matching nodes"
          body={`No ${filter} nodes on this page.`}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {shownNodes.map((n) => (
            <NodeCard key={n.name} n={n} />
          ))}
        </div>
      )}

      {!error && nodes.length > 0 && (
        <CursorPager nextCursor={nextCursor} total={total} shown={nodes.length} />
      )}
    </div>
  );
}

function CapacityBadge({ type }: { type: CapacityType }) {
  const m = capacityTypeMeta[type];
  return (
    <Badge
      variant="outline"
      className={cx("gap-1.5 text-[11px] font-medium", m.bg, m.text)}
    >
      <Dot className={m.dot} />
      {m.label}
    </Badge>
  );
}

function NodeCard({ n }: { n: NodeInfo }) {
  const capCpu = cpuToCores(n.capacityCpu);
  const allocCpu = cpuToCores(n.allocatableCpu);
  const capMem = memToBytes(n.capacityMemory);
  const allocMem = memToBytes(n.allocatableMemory);
  // Prefer live usage from metrics-server; fall back to the kubelet reservation
  // (capacity − allocatable) only when metrics are unavailable.
  const usedCpuCores = n.usageCpu ? cpuToCores(n.usageCpu) : null;
  const usedMemBytes = n.usageMemory ? memToBytes(n.usageMemory) : null;
  const haveCpuMetric = usedCpuCores !== null;
  const haveMemMetric = usedMemBytes !== null;
  const cpuUsed =
    haveCpuMetric && capCpu > 0 ? usedCpuCores! / capCpu : capCpu > 0 ? 1 - allocCpu / capCpu : 0;
  const memUsed =
    haveMemMetric && capMem > 0 ? usedMemBytes! / capMem : capMem > 0 ? 1 - allocMem / capMem : 0;
  const cpuDetail = haveCpuMetric
    ? `${usedCpuCores!.toFixed(2)} / ${capCpu.toFixed(0)} cores · ${Math.round(cpuUsed * 100)}%`
    : `${(capCpu - allocCpu).toFixed(1)} reserved · ${capCpu.toFixed(0)} cores`;
  const memDetail = haveMemMetric
    ? `${fmtBytes(usedMemBytes!)} / ${fmtBytes(capMem)} · ${Math.round(memUsed * 100)}%`
    : `${fmtBytes(capMem - allocMem)} reserved · ${fmtBytes(capMem)}`;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm text-ink">{n.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
            <span>{n.instanceType ?? "unknown type"}</span>
            <span className="text-ink-faint">·</span>
            <span>{n.zone ?? "—"}</span>
            <span className="text-ink-faint">·</span>
            <span className="font-mono">{n.kubeletVersion}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <CapacityBadge type={n.capacityType} />
          {n.unschedulable && (
            <Badge
              variant="outline"
              className="gap-1.5 border-pf-gold/30 bg-pf-gold-50 text-[#8a6d00]"
            >
              <Dot className="bg-[#8a6d00]" />
              Cordoned
            </Badge>
          )}
          <Badge
            variant="outline"
            className={
              n.ready
                ? "border-pf-green/30 bg-pf-green-50 text-pf-green"
                : "border-pf-red/30 bg-pf-red-50 text-pf-red"
            }
          >
            {n.ready ? "Ready" : "NotReady"}
          </Badge>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <ResourceBar
          label="CPU"
          used={cpuUsed}
          detail={cpuDetail}
          tone={cpuUsed > 0.85 ? "rose" : "sky"}
        />
        <ResourceBar
          label="Memory"
          used={memUsed}
          detail={memDetail}
          tone={memUsed > 0.85 ? "rose" : "lime"}
        />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-faint">
        <span className="tabular">{n.podCount} pods</span>
        <span>joined {timeAgo(n.createdAt)}</span>
      </div>

      {n.taints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {n.taints.map((t) => (
            <span
              key={t}
              className="rounded border border-pf-gold/30 bg-pf-gold-50 px-1.5 py-0.5 font-mono text-[10px] text-[#8a6d00]"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function ResourceBar({
  label,
  used,
  detail,
  tone,
}: {
  label: string;
  used: number;
  detail: string;
  tone: "lime" | "amber" | "rose" | "sky";
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="tabular font-mono text-ink-soft">
          {(used * 100).toFixed(0)}%
        </span>
      </div>
      <Meter ratio={used} tone={tone} />
      <div className="mt-1 text-[10px] text-ink-faint">{detail}</div>
    </div>
  );
}
