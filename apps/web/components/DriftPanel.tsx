"use client";

import { useEffect, useState } from "react";
import type { DriftResponse, Namespace } from "@ininfra/shared-types";
import { api, ApiClientError, type DriftKind } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErrorPanel } from "@/components/ErrorPanel";

/**
 * Read-only "Configuration drift" panel for one workload.
 *
 * Lazy-fetches `GET /api/drift/:kind/:ns/:name` on mount and reports whether the
 * LIVE spec has drifted from what was declaratively applied (the
 * `kubectl.kubernetes.io/last-applied-configuration` annotation):
 *
 *   * no baseline  → muted note (the workload was never `kubectl apply`-ed),
 *   * in sync      → green "In sync" badge,
 *   * drift        → amber "Drift detected" badge + a compact table of the
 *     drifted fields (path · applied → live).
 *
 * Reusable across deployment / statefulset detail surfaces — pass kind/ns/name.
 * Loading / error states are handled inline, dark console styling.
 */
export function DriftPanel({
  kind,
  ns,
  name,
}: {
  kind: DriftKind;
  ns: Namespace;
  name: string;
}) {
  const [data, setData] = useState<DriftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .drift(kind, ns, name)
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

  const drifted = data?.fields.filter((f) => f.drifted) ?? [];

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="label-kicker">Live spec vs last-applied</h3>
        {data?.hasBaseline &&
          (data.hasDrift ? (
            <Badge
              variant="outline"
              className="border-pf-gold/30 bg-pf-gold-50 text-[#8a6d00] px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              title="The live spec differs from the last config applied via kubectl apply."
            >
              Drift detected
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-transparent bg-pf-green text-white px-1.5 py-0.5 text-[10px] font-semibold uppercase"
              title="The live spec matches the last config applied via kubectl apply."
            >
              In sync
            </Badge>
          ))}
      </div>

      {loading && <div className="text-xs text-ink-faint">Loading…</div>}
      {error && !loading && <ErrorPanel message={error} />}

      {/* No declared baseline: the workload was never kubectl apply-ed. */}
      {!loading && !error && data && !data.hasBaseline && (
        <div className="text-xs text-ink-faint">
          No declared baseline (not applied via kubectl apply).
        </div>
      )}

      {/* Baseline present, in sync. */}
      {!loading && !error && data && data.hasBaseline && !data.hasDrift && (
        <div className="text-xs text-ink-faint">
          Live spec matches the last-applied configuration across replicas,
          images, and container resources.
        </div>
      )}

      {/* Baseline present, drift detected → field-level table. */}
      {!loading && !error && data && data.hasBaseline && data.hasDrift && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-left text-xs">
            <thead>
              <tr className="text-ink-faint">
                <th className="label-kicker pb-2 pr-4 font-normal">Field</th>
                <th className="label-kicker pb-2 pr-4 font-normal">Applied</th>
                <th className="label-kicker pb-2 font-normal">Live</th>
              </tr>
            </thead>
            <tbody>
              {drifted.map((f) => (
                <tr
                  key={f.path}
                  className="border-t border-line align-top"
                >
                  <td className="py-1.5 pr-4 font-mono text-[11px] text-ink-soft">
                    {f.path}
                  </td>
                  <td className="py-1.5 pr-4 font-mono text-[11px] text-ink-faint">
                    {f.applied ?? "—"}
                  </td>
                  <td className="py-1.5 font-mono text-[11px] text-[#8a6d00]">
                    {f.live ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
