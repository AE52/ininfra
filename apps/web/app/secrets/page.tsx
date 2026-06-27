"use client";

import { useCallback, useEffect, useState } from "react";
import type { CertHealth, Namespace } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useConfig } from "@/components/ConfigProvider";
import { PageHeader, Stat, EmptyState, NamespaceTag } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { cx, fmtTime } from "@/lib/format";
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

/** Special scope value meaning "scan every managed namespace" (ns omitted). */
const ALL = "__all__";

export default function SecretsPage() {
  const t = useT();
  const { managedNamespaces } = useConfig();
  // Default to scanning ALL managed namespaces — the headline use is a
  // cluster-wide soonest-to-expire view.
  const [scope, setScope] = useState<string>(ALL);
  const [rows, setRows] = useState<CertHealth[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setError(null);
      const ns: Namespace | undefined = scope === ALL ? undefined : scope;
      setRows(await api.secretsHealth(ns));
    } catch (e) {
      setError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    }
  }, [scope]);
  useEffect(() => {
    load();
  }, [load]);

  // Summary stats over the loaded rows (the API already sorts soonest-first).
  const parsed = rows?.filter((r) => r.daysRemaining !== null) ?? [];
  const expiredCount = parsed.filter((r) => r.expired).length;
  const soonCount = parsed.filter(
    (r) => !r.expired && (r.daysRemaining ?? 0) < 30,
  ).length;

  const scopes: Array<{ key: string; label: string }> = [
    { key: ALL, label: t.secrets.allNamespaces },
    ...managedNamespaces.map((n) => ({ key: n, label: n })),
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.secrets.kicker}
        title={t.secrets.title}
        subtitle={t.secrets.subtitle}
      />

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label={t.secrets.statTotal} value={rows?.length ?? "—"} />
        <Stat
          label={t.secrets.statExpiringSoon}
          value={soonCount}
          accent={soonCount > 0 ? "rose" : "lime"}
        />
        <Stat
          label={t.secrets.statExpired}
          value={expiredCount}
          accent={expiredCount > 0 ? "rose" : "lime"}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {scopes.map((s) => (
          <Button
            key={s.key}
            variant="ghost"
            size="sm"
            onClick={() => setScope(s.key)}
            className={cx(
              "text-xs font-medium",
              scope === s.key
                ? "bg-pf-blue-50 text-pf-blue hover:bg-pf-blue-50 hover:text-pf-blue"
                : "bg-line-soft text-ink-muted hover:text-ink-soft",
            )}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {error && <ErrorPanel message={error} />}

      {rows && rows.length === 0 && !error && (
        <EmptyState title={t.secrets.noSecrets} body={t.secrets.noSecretsBody} />
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-line">
          <Table className="text-sm">
            <TableHeader className="bg-line-soft text-left text-xs uppercase tracking-wider text-ink-faint">
              <TableRow>
                <TableHead className="px-4 py-2.5">
                  {t.secrets.colNamespace}
                </TableHead>
                <TableHead className="px-4 py-2.5">
                  {t.secrets.colSecret}
                </TableHead>
                <TableHead className="px-4 py-2.5">
                  {t.secrets.colCommonName}
                </TableHead>
                <TableHead className="px-4 py-2.5">
                  {t.secrets.colIssuer}
                </TableHead>
                <TableHead className="px-4 py-2.5">
                  {t.secrets.colExpires}
                </TableHead>
                <TableHead className="px-4 py-2.5">
                  {t.secrets.colDaysLeft}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-line">
              {rows.map((r) => (
                <TableRow key={`${r.namespace}/${r.secretName}`}>
                  <TableCell className="px-4 py-2.5">
                    <NamespaceTag ns={r.namespace} />
                  </TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-xs text-ink-soft">
                    {r.secretName}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-xs text-ink-muted">
                    {r.commonName ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[22rem] truncate px-4 py-2.5 text-xs text-ink-muted">
                    {r.issuer ?? "—"}
                  </TableCell>
                  <TableCell className="px-4 py-2.5 font-mono text-[11px] text-ink-faint">
                    {r.notAfter ? fmtTime(r.notAfter) : "—"}
                  </TableCell>
                  <TableCell className="px-4 py-2.5">
                    <DaysBadge row={r} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!rows && !error && (
        <div className="text-sm text-ink-faint">{t.secrets.loading}</div>
      )}
    </div>
  );
}

/** Days-remaining badge: red if expired or <30d, amber if <90d, else neutral.
 *  Unparseable certs (daysRemaining === null) render a red "parse error" badge. */
function DaysBadge({ row }: { row: CertHealth }) {
  const t = useT();

  if (row.daysRemaining === null) {
    return (
      <Badge
        variant="outline"
        className="border-pf-red/30 bg-pf-red-50 text-xs font-medium text-pf-red"
        title={row.parseError ?? undefined}
      >
        {t.secrets.parseErrorLabel}
      </Badge>
    );
  }

  const days = row.daysRemaining;
  if (row.expired || days < 0) {
    return (
      <Badge
        variant="outline"
        className="border-pf-red/30 bg-pf-red-50 text-xs font-medium text-pf-red"
      >
        {t.secrets.badgeExpired}
      </Badge>
    );
  }

  const tone =
    days < 30
      ? "border-pf-red/30 bg-pf-red-50 text-pf-red"
      : days < 90
        ? "border-pf-gold/30 bg-pf-gold-50 text-[#8a6d00]"
        : "border-line bg-line-soft text-ink-muted";

  return (
    <Badge
      variant="outline"
      className={cx("text-xs font-medium tabular", tone)}
    >
      {t.secrets.badgeDays(days)}
    </Badge>
  );
}
