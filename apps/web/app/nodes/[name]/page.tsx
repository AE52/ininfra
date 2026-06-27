import Link from "next/link";
import type {
  CapacityType,
  NodeCondition,
  NodeDetail,
  NodeTaint,
  PodSummary,
} from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import {
  capacityTypeMeta,
  cpuToCores,
  cx,
  fmtBytes,
  fmtTime,
  memToBytes,
  timeAgo,
} from "@/lib/format";
import { PageHeader, Stat, Meter, EmptyState, NamespaceTag } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Dot, PhaseBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function NodeDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const nodeName = decodeURIComponent(name);

  let detail: NodeDetail | null = null;
  let error: string | null = null;
  try {
    const api = await getServerApi();
    detail = await api.getNode(nodeName);
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  if (error) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker="Infrastructure" title={nodeName} subtitle="Node detail" />
        <ErrorPanel message={error} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker="Infrastructure" title={nodeName} subtitle="Node detail" />
        <EmptyState title="No data" body="The API returned no node." />
      </div>
    );
  }

  const {
    node: n,
    pods,
    conditions,
    systemInfo,
    internalIp,
    externalIp,
    providerId,
    ami,
    nodegroup,
    taintsDetail,
    allocated,
  } = detail;

  const capCpu = cpuToCores(n.capacityCpu);
  const allocCpu = cpuToCores(n.allocatableCpu);
  const capMem = memToBytes(n.capacityMemory);
  const allocMem = memToBytes(n.allocatableMemory);

  // Allocated = sum of pod requests, measured against allocatable capacity.
  const reqCpu = cpuToCores(allocated.requestsCpu);
  const reqMem = memToBytes(allocated.requestsMemory);
  const reqCpuRatio = allocCpu > 0 ? reqCpu / allocCpu : 0;
  const reqMemRatio = allocMem > 0 ? reqMem / allocMem : 0;
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
    ? `${usedCpuCores!.toFixed(2)} / ${capCpu.toFixed(0)} cores live · ${Math.round(cpuUsed * 100)}%`
    : `${(capCpu - allocCpu).toFixed(1)} reserved / ${capCpu.toFixed(0)} cores (metrics unavailable)`;
  const memDetail = haveMemMetric
    ? `${fmtBytes(usedMemBytes!)} / ${fmtBytes(capMem)} live · ${Math.round(memUsed * 100)}%`
    : `${fmtBytes(capMem - allocMem)} reserved / ${fmtBytes(capMem)} (metrics unavailable)`;

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Infrastructure"
        title={nodeName}
        subtitle="Node capacity, live load, and the pods scheduled on it."
        actions={
          <Link
            href="/nodes"
            className="text-xs text-ink-faint hover:text-ink-soft"
          >
            ← All nodes
          </Link>
        }
      />

      {/* Headline */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Status"
          value={n.ready ? "Ready" : "NotReady"}
          accent={n.ready ? "lime" : "rose"}
        />
        <Stat label="Pods" value={n.podCount} hint="scheduled" />
        <Stat label="vCPU" value={capCpu.toFixed(0)} hint="capacity" accent="sky" />
        <Stat label="Memory" value={fmtBytes(capMem)} hint="capacity" accent="sky" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Identity */}
        <Card className="p-5 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-ink">Identity</h2>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <CapacityBadge type={n.capacityType} />
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
          <dl className="space-y-2.5 text-xs">
            <Row label="Instance type" value={n.instanceType ?? "—"} mono />
            <Row label="Zone" value={n.zone ?? "—"} mono />
            <Row label="Kubelet" value={n.kubeletVersion || "—"} mono />
            <Row label="Joined" value={timeAgo(n.createdAt)} />
            <Row label="Pods" value={`${n.podCount}`} />
          </dl>
          {(taintsDetail.length > 0 || n.taints.length > 0) && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-faint">
                Taints
              </div>
              <div className="flex flex-wrap gap-1">
                {taintsDetail.length > 0
                  ? taintsDetail.map((t) => (
                      <TaintChip key={`${t.key}=${t.value ?? ""}:${t.effect}`} t={t} />
                    ))
                  : n.taints.map((t) => (
                      <span
                        key={t}
                        className="rounded border border-pf-gold/30 bg-pf-gold-50 px-1.5 py-0.5 font-mono text-[10px] text-[#8a6d00]"
                      >
                        {t}
                      </span>
                    ))}
              </div>
            </div>
          )}
        </Card>

        {/* Capacity + live load */}
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-4 text-sm font-medium text-ink">Capacity &amp; live load</h2>
          <div className="space-y-4">
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
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-xs sm:grid-cols-4">
            <KV label="Capacity CPU" value={`${capCpu.toFixed(0)} cores`} />
            <KV label="Alloc CPU" value={`${allocCpu.toFixed(2)} cores`} />
            <KV label="Capacity Mem" value={fmtBytes(capMem)} />
            <KV label="Alloc Mem" value={fmtBytes(allocMem)} />
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <div className="mb-3 text-[11px] uppercase tracking-wider text-ink-faint">
              Allocated · requests vs allocatable
            </div>
            <div className="space-y-4">
              <ResourceBar
                label="CPU requests"
                used={reqCpuRatio}
                detail={`${reqCpu.toFixed(2)} / ${allocCpu.toFixed(2)} cores · ${Math.round(reqCpuRatio * 100)}%`}
                tone={reqCpuRatio > 0.9 ? "rose" : reqCpuRatio > 0.75 ? "amber" : "sky"}
              />
              <ResourceBar
                label="Memory requests"
                used={reqMemRatio}
                detail={`${fmtBytes(reqMem)} / ${fmtBytes(allocMem)} · ${Math.round(reqMemRatio * 100)}%`}
                tone={reqMemRatio > 0.9 ? "rose" : reqMemRatio > 0.75 ? "amber" : "lime"}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <KV label="Req CPU" value={allocated.requestsCpu || "—"} />
              <KV label="Limit CPU" value={allocated.limitsCpu || "—"} />
              <KV label="Req Mem" value={allocated.requestsMemory || "—"} />
              <KV label="Limit Mem" value={allocated.limitsMemory || "—"} />
            </div>
          </div>
        </Card>
      </div>

      {/* System + Conditions */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-ink">System</h2>
          <dl className="space-y-2.5 text-xs">
            <Row label="OS image" value={systemInfo.osImage || "—"} mono />
            <Row label="Kernel" value={systemInfo.kernelVersion || "—"} mono />
            <Row label="Container runtime" value={systemInfo.containerRuntime || "—"} mono />
            <Row
              label="Arch / OS"
              value={`${systemInfo.architecture || "—"} / ${systemInfo.operatingSystem || "—"}`}
              mono
            />
            <Row label="Kubelet" value={n.kubeletVersion || "—"} mono />
            <Row label="Kube-proxy" value={systemInfo.kubeProxyVersion || "—"} mono />
            <Row label="AMI" value={ami ?? "—"} mono />
            <Row label="Nodegroup" value={nodegroup ?? "—"} mono />
            <Row label="Provider ID" value={providerId ?? "—"} mono />
            <Row label="Internal IP" value={internalIp ?? "—"} mono />
            <Row label="External IP" value={externalIp ?? "—"} mono />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-medium text-ink">
            Conditions <span className="text-ink-faint">({conditions.length})</span>
          </h2>
          {conditions.length === 0 ? (
            <div className="text-xs text-ink-faint">No conditions reported.</div>
          ) : (
            <div className="space-y-2.5">
              {conditions.map((cnd) => (
                <ConditionRow key={cnd.type} c={cnd} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Pods on this node */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-ink">
          Pods on this node{" "}
          <span className="text-ink-faint">({pods.length})</span>
        </h2>
        {pods.length === 0 ? (
          <EmptyState title="No pods" body="No pods are scheduled on this node." />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                    <TableHead className="px-4 py-2.5 font-medium">Pod</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Namespace</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Owner</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Phase</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">Ready</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">Restarts</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">CPU</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">RAM</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pods.map((p) => (
                    <PodRow key={`${p.namespace}/${p.name}`} p={p} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function PodRow({ p }: { p: PodSummary }) {
  const cpuCores = cpuToCores(p.usageCpu);
  const memBytes = memToBytes(p.usageMemory);
  const cpuLabel = p.usageCpu
    ? cpuCores < 1
      ? `${Math.round(cpuCores * 1000)}m`
      : cpuCores.toFixed(2)
    : "—";
  const memLabel = p.usageMemory ? fmtBytes(memBytes) : "—";
  const owner = ownerLink(p);

  return (
    <TableRow className="border-b border-line last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3 font-mono text-xs text-ink-soft">
        {p.name}
      </TableCell>
      <TableCell className="px-4 py-3">
        <NamespaceTag ns={p.namespace} />
      </TableCell>
      <TableCell className="px-4 py-3 text-xs">
        {owner ? (
          <Link href={owner.href} className="text-pf-blue hover:underline">
            {owner.label}
          </Link>
        ) : (
          <span className="text-ink-faint">{p.ownerRef ?? "—"}</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3">
        <PhaseBadge phase={p.phase} ready={p.ready} />
      </TableCell>
      <TableCell className="tabular px-4 py-3 font-mono text-xs text-ink-muted">
        {p.containerReady}
      </TableCell>
      <TableCell
        className={cx(
          "tabular px-4 py-3 text-right font-mono text-xs",
          p.restarts > 0 ? "text-[#8a6d00]" : "text-ink-faint",
        )}
      >
        {p.restarts}
      </TableCell>
      <TableCell className="tabular px-4 py-3 text-right font-mono text-xs text-ink-soft">
        {cpuLabel}
      </TableCell>
      <TableCell className="tabular px-4 py-3 text-right font-mono text-xs text-ink-soft">
        {memLabel}
      </TableCell>
      <TableCell className="px-4 py-3 text-right text-xs text-ink-faint">
        {timeAgo(p.startedAt)}
      </TableCell>
    </TableRow>
  );
}

/**
 * Derive a link to the owning workload's service detail page where it makes
 * sense. ownerRef is "kind/name", e.g. "deployment/my-service" or
 * "replicaset/my-service-7c9f". Deployments map directly to the service page;
 * a ReplicaSet name is the deployment name plus a hash suffix, so strip it.
 */
function ownerLink(p: PodSummary): { href: string; label: string } | null {
  if (!p.ownerRef) return null;
  const [kind, ...rest] = p.ownerRef.split("/");
  const name = rest.join("/");
  if (!name) return null;
  const k = kind.toLowerCase();
  if (k === "deployment") {
    return { href: `/services/${p.namespace}/${name}`, label: p.ownerRef };
  }
  if (k === "replicaset") {
    const deploy = name.replace(/-[a-z0-9]+$/i, "");
    return { href: `/services/${p.namespace}/${deploy}`, label: p.ownerRef };
  }
  return null;
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

function TaintChip({ t }: { t: NodeTaint }) {
  const label = `${t.key}${t.value ? `=${t.value}` : ""}:${t.effect}`;
  return (
    <span className="rounded border border-pf-gold/30 bg-pf-gold-50 px-1.5 py-0.5 font-mono text-[10px] text-[#8a6d00]">
      {label}
    </span>
  );
}

function ConditionRow({ c }: { c: NodeCondition }) {
  const dot =
    c.status === "True"
      ? "bg-pf-green"
      : c.status === "False"
        ? "bg-pf-red"
        : "bg-ink-faint";
  const text = c.reason || c.message || "—";
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <div className="flex min-w-0 items-baseline gap-2">
        <Dot className={cx(dot, "translate-y-0.5")} />
        <span className="font-mono text-ink-soft">{c.type}</span>
        <span className="truncate text-ink-faint" title={c.message ?? undefined}>
          {text}
        </span>
      </div>
      <span className="shrink-0 text-right text-ink-faint">
        {fmtTime(c.lastTransitionTime)}
      </span>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={cx("text-right text-ink-soft", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="tabular mt-0.5 font-mono text-ink-soft">{value}</div>
    </div>
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
        <span className="tabular font-mono text-ink-soft">{(used * 100).toFixed(0)}%</span>
      </div>
      <Meter ratio={used} tone={tone} />
      <div className="mt-1 text-[10px] text-ink-faint">{detail}</div>
    </div>
  );
}
