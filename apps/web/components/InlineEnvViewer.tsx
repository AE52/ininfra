"use client";

import { useMemo, useState } from "react";
import type { EnvVar, Namespace } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/Toast";

/**
 * Read-only viewer for the inline `env:` entries declared directly on the
 * container. Searchable; masked secret-sourced values can be revealed on
 * demand (audited) but never edited here.
 */
export function InlineEnvViewer({
  ns,
  workload,
  initial,
}: {
  ns: Namespace;
  workload: string;
  initial: EnvVar[];
}) {
  const toast = useToast();
  const [vars, setVars] = useState<EnvVar[]>(initial);
  const [query, setQuery] = useState("");
  const [revealing, setRevealing] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const hasMasked = useMemo(() => vars.some((v) => v.masked), [vars]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return vars;
    return vars.filter(
      (v) =>
        v.key.toLowerCase().includes(q) ||
        (!v.masked && v.value.toLowerCase().includes(q)),
    );
  }, [vars, query]);

  async function revealAll() {
    setRevealing(true);
    try {
      const fresh = await api.getEnv(ns, workload, true);
      const valueByKey = new Map(fresh.inline.map((d) => [d.key, d.value]));
      setVars((vs) =>
        vs.map((v) =>
          v.masked && valueByKey.has(v.key)
            ? { ...v, value: valueByKey.get(v.key) ?? v.value, masked: false }
            : v,
        ),
      );
      setRevealed(true);
      toast("info", "Revealed inline values (audited)");
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Reveal failed: ${msg}`);
    } finally {
      setRevealing(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="text-xs text-ink-muted">
          Declared inline on the container; edit via the deployment manifest.
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keys…"
            className="h-8 w-auto py-1 text-xs"
            spellCheck={false}
          />
          {hasMasked && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={revealAll}
              disabled={revealing || revealed}
            >
              {revealed ? "Revealed" : revealing ? "Revealing…" : "Reveal values"}
            </Button>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="border-b border-line hover:bg-transparent">
            <TableHead className="w-2/5 px-4 py-2 text-[11px] uppercase tracking-wider text-ink-faint">
              Key
            </TableHead>
            <TableHead className="px-4 py-2 text-[11px] uppercase tracking-wider text-ink-faint">
              Value
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((v) => (
            <TableRow
              key={v.key}
              className="border-b border-line font-mono text-xs last:border-0 hover:bg-transparent"
            >
              <TableCell className="truncate px-4 py-2 text-ink">
                {v.key}
              </TableCell>
              <TableCell
                className={cx(
                  "truncate px-4 py-2",
                  v.masked ? "text-ink-faint" : "text-ink-soft",
                )}
              >
                {v.value || (v.masked ? "••••••" : "")}
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={2}
                className="px-4 py-8 text-center text-sm text-ink-faint"
              >
                {vars.length === 0
                  ? "No inline env declared."
                  : "No keys match your search."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
