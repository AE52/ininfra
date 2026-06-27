"use client";

import { useCallback, useEffect, useState } from "react";
import type { BuildConfigService } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, EmptyState } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { useToast } from "@/components/Toast";
import { useConfig } from "@/components/ConfigProvider";
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

export default function BranchesPage() {
  const toast = useToast();
  const t = useT();
  const { managedNamespaces, features } = useConfig();
  // The build catalog lives in the first managed namespace.
  const ns = managedNamespaces[0] ?? "";
  const [rows, setRows] = useState<BuildConfigService[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ns) return;
    try {
      setError(null);
      const data = await api.listBuildConfig(ns);
      setRows(data);
      setEdits({});
    } catch (e) {
      setError(e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e));
    }
  }, [ns]);
  useEffect(() => {
    load();
  }, [load]);

  async function save(svc: string) {
    const branch = (edits[svc] ?? "").trim();
    if (!branch) return;
    setSaving(svc);
    try {
      await api.changeBranch(ns, svc, { branch });
      toast("success", t.branches.toastSuccess(svc, branch));
      await load();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  // CI/CD off → render the same "not configured" empty state the gateway uses,
  // rather than a working-looking-but-broken branch table.
  if (!features.jenkins) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.branches.kicker} title={t.branches.title} />
        <EmptyState
          title="CI/CD is not configured"
          body="Set the Jenkins integration environment variables on the API to manage which branch each service builds from."
        />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.branches.kicker}
        title={t.branches.title}
        subtitle={t.branches.subtitle}
      />
      {!ns ? (
        // No managed namespace → the loader can never fetch a catalog, so show
        // an explicit empty state instead of a permanent "Loading…".
        <EmptyState
          title="No managed namespace configured"
          body="Set MANAGED_NAMESPACES on the API to enable branch management for your services."
        />
      ) : (
        <>
      {error && <ErrorPanel message={error} />}
      {rows && rows.length === 0 && <EmptyState title={t.branches.noServices} />}
      {rows && rows.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-line-soft text-left text-xs uppercase tracking-wider text-ink-faint">
                <TableRow>
                  <TableHead className="px-4 py-2.5">{t.branches.colService}</TableHead>
                  <TableHead className="px-4 py-2.5">{t.branches.colCurrentBranch}</TableHead>
                  <TableHead className="px-4 py-2.5">{t.branches.colNewBranch}</TableHead>
                  <TableHead className="px-4 py-2.5"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-line">
                {rows.map((r) => {
                  const val = edits[r.name] ?? r.branch;
                  const dirty = val.trim() !== r.branch && val.trim() !== "";
                  return (
                    <TableRow key={r.name} className={r.enabled ? "" : "opacity-50"}>
                      <TableCell className="px-4 py-2.5 font-medium text-ink-soft">
                        {r.name}
                        {!r.enabled && (
                          <span className="ml-2 text-[10px] text-ink-faint">{t.branches.disabled}</span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <span className="rounded bg-line-soft px-2 py-0.5 font-mono text-xs text-pf-blue">
                          {r.branch}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-2.5">
                        <Input
                          value={val}
                          onChange={(e) =>
                            setEdits((s) => ({ ...s, [r.name]: e.target.value }))
                          }
                          className="h-8 w-44 font-mono text-xs"
                        />
                      </TableCell>
                      <TableCell className="px-4 py-2.5 text-right">
                        <Button
                          size="sm"
                          disabled={!dirty || saving === r.name}
                          onClick={() => save(r.name)}
                        >
                          {saving === r.name ? t.branches.changeBtnSaving : t.branches.changeBtn}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {!rows && !error && <div className="text-sm text-ink-faint">{t.branches.loading}</div>}
        </>
      )}
    </div>
  );
}
