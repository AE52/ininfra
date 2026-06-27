"use client";

import type { NodeInfo, Service } from "@ininfra/shared-types";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import {
  cpuToCores,
  fmtBytes,
  memToBytes,
} from "@/lib/format";
import { PageHeader, Stat, EmptyState, Meter } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ServiceCard } from "@/components/ServiceCard";
import { ErrorPanel } from "@/components/ErrorPanel";

type Props = {
  services: Service[];
  nodes: NodeInfo[];
  serviceCount: number;
  error: string | null;
  clusterName: string;
  managedNamespaces: string[];
};

export function DashboardClient({
  services,
  nodes,
  serviceCount,
  error,
  clusterName,
  managedNamespaces,
}: Props) {
  const t = useT();

  const healthy = services.filter((s) => s.health === "healthy").length;
  const degraded = services.filter((s) => s.health === "degraded").length;
  const progressing = services.filter((s) => s.health === "progressing").length;
  const readyNodes = nodes.filter((n) => n.ready).length;

  const cap = nodes.reduce(
    (acc, n) => {
      acc.cpu += cpuToCores(n.capacityCpu);
      acc.alloc += cpuToCores(n.allocatableCpu);
      acc.mem += memToBytes(n.capacityMemory);
      acc.memAlloc += memToBytes(n.allocatableMemory);
      acc.pods += n.podCount;
      return acc;
    },
    { cpu: 0, alloc: 0, mem: 0, memAlloc: 0, pods: 0 },
  );

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.dashboard.kicker}
        title={clusterName}
        subtitle={
          managedNamespaces.length > 0
            ? t.dashboard.namespaceSubtitle(managedNamespaces.join(", "))
            : t.dashboard.defaultSubtitle
        }
      />

      {error && (
        <div className="mb-7">
          <ErrorPanel message={error} />
        </div>
      )}

      {/* Headline stats */}
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label={t.dashboard.statServices}
          value={serviceCount}
          hint={t.dashboard.statHintHealthy(healthy)}
          accent="slate"
        />
        <Stat
          label={t.dashboard.statDegraded}
          value={degraded}
          accent={degraded ? "rose" : "slate"}
          hint={
            progressing
              ? t.dashboard.statHintProgressing(progressing)
              : t.dashboard.statHintAllStable
          }
        />
        <Stat
          label={t.dashboard.statNodes}
          value={`${readyNodes}/${nodes.length}`}
          hint={t.dashboard.statHintReady}
          accent={readyNodes < nodes.length ? "amber" : "slate"}
        />
        <Stat
          label={t.dashboard.statCpu}
          value={cap.cpu.toFixed(0)}
          hint={t.dashboard.statHintAllocatable(cap.alloc.toFixed(1))}
          accent="sky"
        />
        <Stat
          label={t.dashboard.statMemory}
          value={fmtBytes(cap.mem)}
          hint={t.dashboard.statHintPodsScheduled(cap.pods)}
          accent="sky"
        />
      </div>

      {/* Node summary strip */}
      {nodes.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="label-kicker">{t.dashboard.nodeCapacity}</h2>
            <Button
              asChild
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-medium text-pf-blue hover:text-pf-blue-hover"
            >
              <Link href="/nodes">{t.dashboard.viewAllNodes}</Link>
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {nodes.slice(0, 6).map((n) => {
              const capCpu = cpuToCores(n.capacityCpu);
              const allocCpu = cpuToCores(n.allocatableCpu);
              const usedCpu = n.usageCpu ? cpuToCores(n.usageCpu) : null;
              const cpuFrac =
                usedCpu != null && capCpu > 0
                  ? usedCpu / capCpu
                  : capCpu > 0
                  ? 1 - allocCpu / capCpu
                  : 0;
              const cpuLive = usedCpu != null;

              const capMem = memToBytes(n.capacityMemory);
              const allocMem = memToBytes(n.allocatableMemory);
              const usedMem = n.usageMemory ? memToBytes(n.usageMemory) : null;
              const memFrac =
                usedMem != null && capMem > 0
                  ? usedMem / capMem
                  : capMem > 0
                  ? 1 - allocMem / capMem
                  : 0;
              const memLive = usedMem != null;

              return (
                <Link key={n.name} href={`/nodes/${n.name}`} className="block group">
                  <Card className="p-4 transition-colors group-hover:border-pf-blue/40 group-hover:bg-surface-raised/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs text-ink-soft group-hover:text-pf-blue">
                        {n.name}
                      </span>
                      <Badge
                        variant="outline"
                        className={
                          n.ready
                            ? "border-pf-green/30 bg-pf-green-50 text-pf-green"
                            : "border-pf-red/30 bg-pf-red-50 text-pf-red"
                        }
                      >
                        {n.ready ? t.dashboard.ready : t.dashboard.notReady}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[11px] text-ink-muted">
                      {n.instanceType ?? "—"} · {n.zone ?? "—"} · {n.podCount} {t.dashboard.pods}
                    </div>
                    <div className="mt-3 space-y-2">
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                          <span>{cpuLive ? "CPU" : t.dashboard.cpuReserved}</span>
                          <span className="tabular">
                            {Math.round(cpuFrac * 100)}%
                          </span>
                        </div>
                        <Meter ratio={cpuFrac} tone={cpuFrac > 0.85 ? "rose" : "sky"} />
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-ink-muted">
                          <span>{memLive ? "RAM" : t.dashboard.memReserved}</span>
                          <span className="tabular">
                            {Math.round(memFrac * 100)}%
                          </span>
                        </div>
                        <Meter ratio={memFrac} tone={memFrac > 0.85 ? "rose" : "lime"} />
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Services grid */}
      <section>
        <h2 className="label-kicker mb-3">{t.dashboard.servicesSection}</h2>
        {services.length === 0 && !error ? (
          <EmptyState
            title={t.dashboard.noServicesTitle}
            body={t.dashboard.noServicesBody}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {services.map((s) => (
              <ServiceCard key={`${s.namespace}/${s.name}`} svc={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
