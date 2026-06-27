"use client";

import { useEffect, useState } from "react";
import type { DescribeResponse, Namespace } from "@ininfra/shared-types";
import { api, ApiClientError, type DescribeKind } from "@/lib/api";
import { cx, timeAgo } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";

/**
 * Read-only "Events & Describe" panel for one workload or pod.
 *
 * Lazy-fetches `GET /api/describe/:kind/:ns/:name` when it mounts and renders:
 *   * status conditions (type / status / reason),
 *   * per-container status for pods (ready, restartCount, state + reason such as
 *     CrashLoopBackOff / OOMKilled),
 *   * that object's recent k8s events, newest first, with Warning rows
 *     highlighted in the existing warn color.
 *
 * Reusable across deployment / statefulset / pod detail surfaces — pass
 * `kind`/`ns`/`name`. Empty and error states are handled inline.
 */
export function DescribePanel({
  kind,
  ns,
  name,
}: {
  kind: DescribeKind;
  ns: Namespace;
  name: string;
}) {
  const [data, setData] = useState<DescribeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .describe(kind, ns, name)
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
      {/* Status / containers column */}
      <div className="space-y-4">
        {/* Container statuses (pods only) */}
        {data && data.containers.length > 0 && (
          <Card className="p-5">
            <h3 className="label-kicker mb-3">Containers</h3>
            <div className="space-y-2">
              {data.containers.map((c) => {
                // A waiting/terminated container with a reason, or a not-ready
                // container, is the interesting (problem) case to highlight.
                const bad =
                  !c.ready ||
                  (c.state !== "running" && c.state !== "terminated") ||
                  (c.reason != null && c.reason !== "Completed");
                return (
                  <div
                    key={c.name}
                    className="flex items-start justify-between gap-3 border-t border-line pt-2 first:border-0 first:pt-0"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-ink">{c.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span
                          className={cx(
                            "rounded border border-transparent px-1.5 py-0.5 font-medium",
                            c.state === "running"
                              ? "bg-line-soft text-ink-soft"
                              : bad
                                ? "bg-pf-red-50 text-pf-red"
                                : "bg-line-soft text-ink-soft",
                          )}
                        >
                          {c.state}
                        </span>
                        {c.reason && (
                          <span
                            className={cx(
                              "font-mono",
                              bad ? "text-pf-red" : "text-ink-faint",
                            )}
                          >
                            {c.reason}
                          </span>
                        )}
                      </div>
                      {c.message && (
                        <div className="mt-0.5 text-[11px] text-ink-faint">
                          {c.message}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-right text-[11px]">
                      <div
                        className={
                          c.ready ? "text-pf-green" : "text-ink-faint"
                        }
                      >
                        {c.ready ? "ready" : "not ready"}
                      </div>
                      <div
                        className={cx(
                          "tabular font-mono",
                          c.restartCount > 0
                            ? "text-[#8a6d00]"
                            : "text-ink-faint",
                        )}
                      >
                        {c.restartCount} restart{c.restartCount === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Conditions */}
        <Card className="p-5">
          <h3 className="label-kicker mb-3">Conditions</h3>
          {loading && (
            <div className="text-xs text-ink-faint">Loading…</div>
          )}
          {!loading && data && data.conditions.length === 0 && (
            <div className="text-xs text-ink-faint">
              No conditions reported.
            </div>
          )}
          {data && data.conditions.length > 0 && (
            <div className="space-y-1.5">
              {data.conditions.map((c) => (
                <div
                  key={c.type}
                  className="flex items-start justify-between gap-3 border-t border-line pt-1.5 first:border-0 first:pt-0"
                >
                  <span className="text-xs text-ink-soft">{c.type}</span>
                  <span className="flex-1 truncate text-right text-[11px] text-ink-faint">
                    {c.reason ?? c.message ?? "—"}
                  </span>
                  <span
                    className={
                      c.status === "True"
                        ? "text-pf-green"
                        : c.status === "False"
                          ? "text-pf-red"
                          : "text-ink-faint"
                    }
                  >
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Events column */}
      <Card className="p-5">
        <h3 className="label-kicker mb-3">Recent events</h3>
        {loading && <div className="text-xs text-ink-faint">Loading…</div>}
        {error && !loading && <ErrorPanel message={error} />}
        {!loading && !error && data && data.events.length === 0 && (
          <EmptyState title="No recent events" />
        )}
        {data && data.events.length > 0 && (
          <div className="space-y-1.5">
            {data.events.map((e, i) => (
              <div
                key={i}
                className={cx(
                  "flex items-start gap-3 rounded-md px-3 py-2",
                  e.type === "Normal" ? "" : "bg-pf-red-50",
                )}
              >
                <Badge
                  variant="outline"
                  className={cx(
                    "mt-0.5 px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    e.type === "Normal"
                      ? "border-transparent bg-line-soft text-ink-soft"
                      : "border-transparent bg-pf-red text-white",
                  )}
                >
                  {e.type || "?"}
                </Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink-soft">
                    <span className="font-medium text-ink">{e.reason}</span>
                  </div>
                  <div className="text-xs text-ink-muted">{e.message}</div>
                </div>
                <div className="shrink-0 text-right text-[11px] text-ink-faint">
                  {e.count > 1 && <span className="mr-2">×{e.count}</span>}
                  {timeAgo(e.lastSeen)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
