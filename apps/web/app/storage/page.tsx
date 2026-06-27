"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { Namespace, Pvc } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, EmptyState } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { useConfig } from "@/components/ConfigProvider";
import { cx } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function StoragePage() {
  const t = useT();
  const { managedNamespaces } = useConfig();
  const [ns, setNs] = useState<Namespace>(managedNamespaces[0] ?? "");
  const [rows, setRows] = useState<Pvc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ns) return;
    setRows(null);
    try {
      setError(null);
      setRows(await api.listPvcs(ns));
    } catch (e) {
      setError(e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e));
    }
  }, [ns]);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.storage.kicker}
        title={t.storage.title}
        subtitle={t.storage.subtitle}
      />
      <div className="mb-5 flex gap-2">
        {managedNamespaces.map((n) => (
          <Button
            key={n}
            variant="ghost"
            size="sm"
            onClick={() => setNs(n)}
            className={cx(
              "text-xs font-medium",
              ns === n
                ? "bg-pf-blue-50 text-pf-blue hover:bg-pf-blue-50 hover:text-pf-blue"
                : "bg-line-soft text-ink-muted hover:text-ink-soft",
            )}
          >
            {n}
          </Button>
        ))}
      </div>
      {error && <ErrorPanel message={error} />}
      {rows && rows.length === 0 && <EmptyState title={t.storage.noPvc} />}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <Table className="text-sm">
            <TableHeader className="bg-line-soft text-left text-xs uppercase tracking-wider text-ink-faint">
              <TableRow>
                <TableHead className="px-4 py-2.5">{t.storage.colPvc}</TableHead>
                <TableHead className="px-4 py-2.5">{t.storage.colStatus}</TableHead>
                <TableHead className="px-4 py-2.5">{t.storage.colCapacity}</TableHead>
                <TableHead className="px-4 py-2.5">{t.storage.colStorageClass}</TableHead>
                <TableHead className="px-4 py-2.5">{t.storage.colAccess}</TableHead>
                <TableHead className="px-4 py-2.5">{t.storage.colUsedBy}</TableHead>
                <TableHead className="px-4 py-2.5" />
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {rows.map((p) => (
                <TableRow key={p.name}>
                  <TableCell className="px-4 py-2.5 font-medium">
                    <Link
                      href={`/storage/${ns}/${p.name}`}
                      className="text-pf-blue hover:underline"
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <Badge
                      variant="outline"
                      className={cx(
                        "border-transparent text-xs font-normal",
                        p.phase === "Bound"
                          ? "bg-pf-green-50 text-pf-green"
                          : "bg-pf-gold-50 text-[#8a6d00]",
                      )}
                    >
                      {p.phase}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-xs text-ink-soft">{p.capacity ?? "—"}</TableCell>
                  <TableCell className="px-4 py-2.5 text-xs text-ink-muted">{p.storageClass ?? "—"}</TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-[11px] text-ink-faint">{p.accessModes.join(",") || "—"}</TableCell>
                  <TableCell className="px-4 py-2.5 text-xs text-ink-muted">
                    {p.usedByPods.length ? p.usedByPods.join(", ") : <span className="text-ink-faint">{t.storage.idle}</span>}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-right">
                    <Button
                      asChild
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs font-medium text-pf-blue"
                    >
                      <Link href={`/storage/${ns}/${p.name}`}>
                        {t.storage.browseLinkText}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!rows && !error && <div className="text-sm text-ink-faint">{t.storage.loading}</div>}
    </div>
  );
}
