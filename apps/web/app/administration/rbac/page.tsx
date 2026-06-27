"use client";

import { useCallback, useEffect, useState } from "react";
import type { RbacMatrixRow } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, EmptyState } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { Card } from "@/components/ui/card";

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : String(e);
}

/** Category display order */
const CATEGORY_ORDER = [
  "workloads",
  "ci_cd",
  "infrastructure",
  "storage",
  "administration",
];

function categoryLabel(t: ReturnType<typeof useT>, cat: string): string {
  const map: Record<string, string> = {
    workloads: t.rbac.categoryWorkloads,
    infrastructure: t.rbac.categoryInfrastructure,
    ci_cd: t.rbac.categoryCiCd,
    storage: t.rbac.categoryStorage,
    administration: t.rbac.categoryAdministration,
  };
  return map[cat] ?? cat;
}

function groupByCategory(rows: RbacMatrixRow[]): Map<string, RbacMatrixRow[]> {
  const map = new Map<string, RbacMatrixRow[]>();
  for (const row of rows) {
    if (!map.has(row.category)) map.set(row.category, []);
    map.get(row.category)!.push(row);
  }
  return map;
}

type PermRole = "developer" | "admin";

export default function RbacPage() {
  const t = useT();
  const toast = useToast();

  const [userRole, setUserRole] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [rows, setRows] = useState<RbacMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((me) => {
        if (alive) setUserRole(me.role);
      })
      .catch(() => {
        if (alive) setUserRole(null);
      })
      .finally(() => {
        if (alive) setMeReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await api.getRbacPermissions();
      setRows(data);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (meReady && userRole === "super_admin") {
      void load();
    }
  }, [meReady, userRole, load]);

  if (!meReady || (userRole === "super_admin" && loading)) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.rbac.kicker} title={t.rbac.title} />
        <Card className="p-12 text-center text-sm text-ink-faint">
          {t.rbac.loading}
        </Card>
      </div>
    );
  }

  if (userRole !== "super_admin") {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.rbac.kicker} title={t.rbac.title} />
        <EmptyState title="Access denied" body={t.rbac.accessDenied} />
      </div>
    );
  }

  async function toggle(row: RbacMatrixRow, role: PermRole) {
    const cell = row[role];
    const newVal = !cell.effective;
    try {
      await api.setRbacPermission({ role, key: row.key, allowed: newVal });
      toast("success", t.rbac.toastSaved(row.key, role, newVal ? "✓" : "✗"));
      await load();
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  async function reset(row: RbacMatrixRow, role: PermRole) {
    try {
      await api.setRbacPermission({ role, key: row.key, allowed: null });
      toast("success", t.rbac.toastReset(row.key, role));
      await load();
    } catch (e) {
      toast("error", errMsg(e));
    }
  }

  const grouped = groupByCategory(rows);
  const orderedCats = CATEGORY_ORDER.filter((c) => grouped.has(c));
  // Any category not in CATEGORY_ORDER goes at the end.
  for (const c of grouped.keys()) {
    if (!CATEGORY_ORDER.includes(c)) orderedCats.push(c);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.rbac.kicker}
        title={t.rbac.title}
        subtitle={t.rbac.subtitle}
      />

      {err && (
        <div className="mb-4 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {err}
        </div>
      )}

      <div className="space-y-6">
        {orderedCats.map((cat) => {
          const catRows = grouped.get(cat)!;
          return (
            <Card key={cat} className="overflow-hidden">
              <div className="border-b border-line px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  {categoryLabel(t, cat)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                      <th className="w-1/2 px-4 py-2 font-medium">
                        {t.rbac.colPermission}
                      </th>
                      <th className="px-4 py-2 text-center font-medium">
                        {t.rbac.colDeveloper}
                      </th>
                      <th className="px-4 py-2 text-center font-medium">
                        {t.rbac.colAdmin}
                      </th>
                      <th className="px-4 py-2 text-center font-medium">
                        {t.rbac.colSuperAdmin}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {catRows.map((row) => (
                      <tr
                        key={row.key}
                        className="border-b border-line transition-colors last:border-0 hover:bg-line-soft"
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-ink">
                              {row.key}
                            </span>
                            {row.mutating && (
                              <span
                                className="inline-flex items-center rounded-full bg-pf-yellow-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-yellow-700"
                                title="mutating"
                              >
                                ⚠ mutating
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-faint">
                            {row.label}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <PermCell
                            cell={row.developer}
                            onToggle={() => toggle(row, "developer")}
                            onReset={() => reset(row, "developer")}
                            resetLabel={t.rbac.resetToDefault}
                            defaultLabel={t.rbac.colDefault}
                            overrideLabel={t.rbac.colOverride}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <PermCell
                            cell={row.admin}
                            onToggle={() => toggle(row, "admin")}
                            onReset={() => reset(row, "admin")}
                            resetLabel={t.rbac.resetToDefault}
                            defaultLabel={t.rbac.colDefault}
                            overrideLabel={t.rbac.colOverride}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {/* super_admin is always full access — locked, no toggle. */}
                          <span className="inline-flex items-center gap-1 rounded-full bg-pf-green/10 px-2 py-0.5 text-[11px] font-medium text-pf-green">
                            ✓ full
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function PermCell({
  cell,
  onToggle,
  onReset,
  resetLabel,
  defaultLabel,
  overrideLabel,
}: {
  cell: { effective: boolean; overrideVal: boolean | null };
  onToggle: () => void;
  onReset: () => void;
  resetLabel: string;
  defaultLabel: string;
  overrideLabel: string;
}) {
  const hasOverride = cell.overrideVal !== null;
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        className={`inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pf-blue ${
          cell.effective ? "bg-pf-green" : "bg-[#444]"
        }`}
        aria-pressed={cell.effective}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            cell.effective ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
      <div className="flex items-center gap-1">
        {hasOverride ? (
          <>
            <span className="text-[10px] font-medium text-pf-blue">
              {overrideLabel}
            </span>
            <button
              type="button"
              onClick={onReset}
              className="text-[10px] text-ink-faint underline hover:text-ink"
              title={resetLabel}
            >
              ↩
            </button>
          </>
        ) : (
          <span className="text-[10px] text-ink-faint">{defaultLabel}</span>
        )}
      </div>
    </div>
  );
}
