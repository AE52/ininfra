"use client";

import { useEffect, useState } from "react";
import type { Namespace, TopologyResponse } from "@ininfra/shared-types";
import { api, ApiClientError, type TopologyKind } from "@/lib/api";
import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";

/**
 * Read-only "Topology & disruption budget" panel for one workload.
 *
 * Lazy-fetches `GET /api/topology/:kind/:ns/:name` on mount and renders:
 *   * where the workload's replicas run — distribution across nodes (each with
 *     its `topology.kubernetes.io/zone`) and across zones,
 *   * SPOF warning badges when every replica is on a single node and/or in a
 *     single zone (the latter only when the cluster spans more than one zone),
 *   * the matching PodDisruptionBudget's budget + live status, or a clear
 *     "No PodDisruptionBudget" note when the workload has none.
 *
 * Reusable across deployment / statefulset detail surfaces — pass kind/ns/name.
 * Loading / empty / error states are handled inline, dark console styling.
 */
export function TopologyPanel({
  kind,
  ns,
  name,
}: {
  kind: TopologyKind;
  ns: Namespace;
  name: string;
}) {
  const [data, setData] = useState<TopologyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .topology(kind, ns, name)
      .then((res) => {
        if (alive) setData(res);
      })
      .catch((e) => {
        if (alive)
          setError(
            e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [kind, ns, name]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Distribution column */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="label-kicker">Replica distribution</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            {data?.singleNode && (
              <Badge
                variant="outline"
                className="border-transparent bg-pf-red text-white px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                title="Every replica is scheduled on a single node — a node failure takes the whole workload down."
              >
                Single node
              </Badge>
            )}
            {data?.singleZone && (
              <Badge
                variant="outline"
                className="border-transparent bg-pf-red text-white px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                title="Every replica is in a single availability zone while the cluster spans multiple — a zone outage takes the whole workload down."
              >
                Single zone
              </Badge>
            )}
          </div>
        </div>

        {loading && <div className="text-xs text-ink-faint">Loading…</div>}
        {error && !loading && <ErrorPanel message={error} />}
        {!loading && !error && data && data.totalPods === 0 && (
          <EmptyState
            title="No scheduled pods"
            body="This workload has no pods currently placed on a node."
          />
        )}

        {!loading && !error && data && data.totalPods > 0 && (
          <>
            <div className="mb-3 flex items-baseline gap-2 text-xs text-ink-faint">
              <span className="tabular font-mono text-ink">
                {data.totalPods}
              </span>
              <span>pod{data.totalPods === 1 ? "" : "s"} across</span>
              <span className="tabular font-mono text-ink">
                {data.nodes.length}
              </span>
              <span>node{data.nodes.length === 1 ? "" : "s"}</span>
              <span>·</span>
              <span className="tabular font-mono text-ink">
                {data.zones.length}
              </span>
              <span>zone{data.zones.length === 1 ? "" : "s"}</span>
            </div>

            {/* Per-node rows */}
            <div className="space-y-1.5">
              {data.nodes.map((n) => (
                <div
                  key={n.node}
                  className="flex items-center justify-between gap-3 border-t border-line pt-1.5 first:border-0 first:pt-0"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-ink">
                      {n.node}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink-faint">
                      {n.zone ? (
                        <span className="font-mono">{n.zone}</span>
                      ) : (
                        <span className="italic">no zone label</span>
                      )}
                    </div>
                  </div>
                  <span className="tabular shrink-0 font-mono text-xs text-ink-soft">
                    {n.count} pod{n.count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>

            {/* Per-zone summary */}
            <div className="mt-4 border-t border-line pt-3">
              <div className="label-kicker mb-2">By zone</div>
              <div className="flex flex-wrap gap-1.5">
                {data.zones.map((z) => (
                  <span
                    key={z.zone ?? "__none__"}
                    className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-muted"
                  >
                    {z.zone ?? "no zone"}
                    <span className="ml-1 text-ink-faint">×{z.count}</span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </Card>

      {/* PodDisruptionBudget column */}
      <Card className="p-5">
        <h3 className="label-kicker mb-3">PodDisruptionBudget</h3>
        {loading && <div className="text-xs text-ink-faint">Loading…</div>}
        {!loading && !error && data && !data.pdb && (
          <div className="rounded-md bg-pf-red-50 px-3 py-2 text-xs text-pf-red">
            No PodDisruptionBudget — voluntary disruptions (node drains,
            upgrades) are not budgeted for this workload.
          </div>
        )}
        {!loading && !error && data?.pdb && (
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
              <span className="font-mono text-ink">{data.pdb.name}</span>
              <Badge
                variant="outline"
                className={cx(
                  "px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                  data.pdb.disruptionsAllowed > 0
                    ? "border-transparent bg-line-soft text-ink-soft"
                    : "border-transparent bg-pf-red text-white",
                )}
                title="Voluntary evictions currently allowed by this budget."
              >
                {data.pdb.disruptionsAllowed} disruption
                {data.pdb.disruptionsAllowed === 1 ? "" : "s"} allowed
              </Badge>
            </div>
            <PdbField
              k="minAvailable"
              v={data.pdb.minAvailable ?? "—"}
            />
            <PdbField
              k="maxUnavailable"
              v={data.pdb.maxUnavailable ?? "—"}
            />
            <PdbField
              k="healthy"
              v={`${data.pdb.currentHealthy} / ${data.pdb.desiredHealthy} desired`}
              bad={data.pdb.currentHealthy < data.pdb.desiredHealthy}
            />
            <PdbField k="expected pods" v={String(data.pdb.expectedPods)} />
          </div>
        )}
      </Card>
    </div>
  );
}

function PdbField({
  k,
  v,
  bad,
}: {
  k: string;
  v: string;
  bad?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 font-mono">
      <span className="text-ink-faint">{k}</span>
      <span className={bad ? "text-pf-red" : "text-ink-soft"}>{v}</span>
    </div>
  );
}
