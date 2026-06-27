"use client";

import { useCallback, useEffect, useState } from "react";
import type { Hpa, Namespace } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, EmptyState, NamespaceTag } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pager } from "@/components/Pager";
import { useToast } from "@/components/Toast";
import { useConfig } from "@/components/ConfigProvider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Draft = { min: number; max: number; cpu: number | "" };

export default function HpaPage() {
  const toast = useToast();
  const t = useT();
  const { managedNamespaces } = useConfig();
  const [ns, setNs] = useState<Namespace>(managedNamespaces[0] ?? "");
  const [rows, setRows] = useState<Hpa[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  const cursor = stack[stack.length - 1];
  const load = useCallback(async () => {
    if (!ns) return;
    setRows(null);
    try {
      setError(null);
      const page = await api.listHpas(ns, { cursor });
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      const d: Record<string, Draft> = {};
      page.items.forEach((h) => {
        d[h.name] = { min: h.minReplicas, max: h.maxReplicas, cpu: h.targetCpu ?? "" };
      });
      setDrafts(d);
    } catch (e) {
      setError(e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e));
    }
  }, [ns, cursor]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    setStack([undefined]);
  }, [ns]);

  async function save(h: Hpa) {
    const d = drafts[h.name];
    if (!d) return;
    setSaving(h.name);
    try {
      await api.patchHpa(ns, h.name, {
        minReplicas: d.min,
        maxReplicas: d.max,
        targetCpu: d.cpu === "" ? undefined : Number(d.cpu),
      });
      toast("success", t.hpa.toastSuccess(h.name, d.min, d.max, d.cpu || "—"));
      await load();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const set = (name: string, patch: Partial<Draft>) =>
    setDrafts((s) => ({ ...s, [name]: { ...s[name], ...patch } }));

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.hpa.kicker}
        title={t.hpa.title}
        subtitle={t.hpa.subtitle}
      />
      <div className="mb-5 flex gap-2">
        {managedNamespaces.map((n) => (
          <Button key={n} onClick={() => setNs(n)} size="sm" variant={ns === n ? "default" : "outline"}>
            {n}
          </Button>
        ))}
      </div>
      {error && <ErrorPanel message={error} />}
      {rows && rows.length === 0 && (
        <EmptyState title={t.hpa.noHpa} />
      )}
      {rows && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((h) => {
            const d = drafts[h.name] ?? { min: h.minReplicas, max: h.maxReplicas, cpu: h.targetCpu ?? "" };
            const dirty =
              d.min !== h.minReplicas ||
              d.max !== h.maxReplicas ||
              (d.cpu === "" ? null : Number(d.cpu)) !== h.targetCpu;
            return (
              <Card key={h.name} className="p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{h.name}</div>
                    <div className="font-mono text-[11px] text-ink-faint">
                      {h.targetKind}/{h.targetName} · {t.hpa.currentReplicas(h.currentReplicas)}
                      {h.currentCpu != null && ` · CPU ${h.currentCpu}%`}
                    </div>
                  </div>
                  <NamespaceTag ns={h.namespace} />
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <Field label={t.hpa.labelMinReplica}>
                    <Input type="number" min={1} value={d.min}
                      onChange={(e) => set(h.name, { min: Number(e.target.value) })}
                      className="h-8 w-[5.5rem] text-xs" />
                  </Field>
                  <Field label={t.hpa.labelMaxReplica}>
                    <Input type="number" min={1} value={d.max}
                      onChange={(e) => set(h.name, { max: Number(e.target.value) })}
                      className="h-8 w-[5.5rem] text-xs" />
                  </Field>
                  <Field label={t.hpa.labelTargetCpu}>
                    <Input type="number" min={1} max={100} value={d.cpu}
                      onChange={(e) => set(h.name, { cpu: e.target.value === "" ? "" : Number(e.target.value) })}
                      className="h-8 w-[5.5rem] text-xs" />
                  </Field>
                  <Button
                    size="sm"
                    disabled={!dirty || saving === h.name}
                    onClick={() => save(h)}
                  >
                    {saving === h.name ? t.hpa.saveBtnSaving : t.hpa.saveBtn}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {rows && !error && (
        <Pager
          hasPrev={stack.length > 1}
          hasNext={!!nextCursor}
          total={total}
          shown={rows.length}
          onPrev={() => setStack((s) => s.slice(0, -1))}
          onNext={() => nextCursor && setStack((s) => [...s, nextCursor])}
        />
      )}
      {!rows && !error && <div className="text-sm text-ink-faint">{t.hpa.loading}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
      {children}
    </label>
  );
}
