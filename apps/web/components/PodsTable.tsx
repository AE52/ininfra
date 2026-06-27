"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Namespace, PodSummary } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { cx, cpuToCores, fmtBytes, memToBytes, timeAgo } from "@/lib/format";
import { PhaseBadge } from "@/components/StatusBadge";
import { ManifestViewer } from "@/components/ManifestViewer";
import { useToast } from "@/components/Toast";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function PodsTable({
  ns,
  pods,
}: {
  ns: Namespace;
  pods: PodSummary[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function del(name: string) {
    if (!confirm(`Delete pod ${name}? The Deployment will recreate it.`)) return;
    setDeleting(name);
    try {
      await api.deletePod(ns, name);
      toast("success", `Deleted pod ${name}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  }

  if (pods.length === 0) {
    return (
      <Card className="p-6 text-center text-sm text-ink-faint">
        No pods match this workload.
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[780px]">
          <TableHeader>
            <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
              <TableHead className="px-4 py-2.5 font-medium">Pod</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">Phase</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">Ready</TableHead>
              <TableHead className="px-4 py-2.5 text-right font-medium">Restarts</TableHead>
              <TableHead className="px-4 py-2.5 text-right font-medium">CPU</TableHead>
              <TableHead className="px-4 py-2.5 text-right font-medium">RAM</TableHead>
              <TableHead className="px-4 py-2.5 font-medium">Node</TableHead>
              <TableHead className="px-4 py-2.5 text-right font-medium">Age</TableHead>
              <TableHead className="px-4 py-2.5" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {pods.map((p) => {
              const cpuCores = cpuToCores(p.usageCpu);
              const memBytes = memToBytes(p.usageMemory);
              // Format cpu as millicores when < 1 core, otherwise as cores
              const cpuLabel = p.usageCpu
                ? cpuCores < 1
                  ? `${Math.round(cpuCores * 1000)}m`
                  : `${cpuCores.toFixed(2)}`
                : "—";
              const memLabel = p.usageMemory ? fmtBytes(memBytes) : "—";

              return (
                <TableRow
                  key={p.name}
                  className="border-b border-line last:border-0 hover:bg-line-soft"
                >
                  <TableCell className="px-4 py-3 font-mono text-xs text-ink-soft">
                    {p.name}
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
                  <TableCell className="px-4 py-3 font-mono text-[11px] text-ink-faint">
                    {p.node ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right text-xs text-ink-faint">
                    {timeAgo(p.startedAt)}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <ManifestViewer kind="pod" ns={ns} name={p.name} compact />
                      <button
                        type="button"
                        onClick={() => del(p.name)}
                        disabled={deleting === p.name}
                        className="text-xs text-ink-faint hover:text-pf-red disabled:opacity-40"
                      >
                        {deleting === p.name ? "deleting…" : "delete"}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
