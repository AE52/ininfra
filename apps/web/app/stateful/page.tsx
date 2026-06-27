"use client";

import { useCallback, useEffect, useState } from "react";
import type { Namespace, StatefulSetSummary } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, EmptyState, NamespaceTag } from "@/components/ui";
import { HealthBadge } from "@/components/StatusBadge";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Pager } from "@/components/Pager";
import { useToast } from "@/components/Toast";
import { useConfig } from "@/components/ConfigProvider";
import { shortImage } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";

export default function StatefulPage() {
  const toast = useToast();
  const t = useT();
  const { managedNamespaces } = useConfig();
  const [ns, setNs] = useState<Namespace>(managedNamespaces[0] ?? "");
  const [rows, setRows] = useState<StatefulSetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null | undefined>(undefined);

  const cursor = stack[stack.length - 1];
  const load = useCallback(async () => {
    if (!ns) return;
    setRows(null);
    try {
      setError(null);
      const page = await api.listStatefulSets(ns, { cursor });
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
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

  async function scale(s: StatefulSetSummary, replicas: number) {
    if (replicas < 0) return;
    if (!window.confirm(t.stateful.confirmScale(s.name, replicas))) return;
    setBusy(s.name);
    try {
      await api.scaleStatefulSet(ns, s.name, { replicas });
      toast("success", t.stateful.toastScaleSuccess(s.name, replicas));
      await load();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function restart(s: StatefulSetSummary) {
    if (!window.confirm(t.stateful.confirmRestart(s.name))) return;
    setBusy(s.name);
    try {
      await api.restartStatefulSet(ns, s.name);
      toast("success", t.stateful.toastRestartSuccess(s.name));
      await load();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.stateful.kicker}
        title={t.stateful.title}
        subtitle={t.stateful.subtitle}
      />
      <div className="mb-5 flex gap-2">
        {managedNamespaces.map((n) => (
          <Button key={n} onClick={() => setNs(n)} size="sm" variant={ns === n ? "default" : "outline"}>
            {n}
          </Button>
        ))}
      </div>
      {error && <ErrorPanel message={error} />}
      {rows && rows.length === 0 && <EmptyState title={t.stateful.noStateful} />}
      {rows && rows.length > 0 && (
        <div className="space-y-2.5">
          {rows.map((s) => {
            const img = shortImage(s.image);
            return (
              <Card key={s.name} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <HealthBadge status={s.health} />
                    <span className="font-medium text-ink">{s.name}</span>
                    <NamespaceTag ns={s.namespace} />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-ink-faint">
                    {img.name}:{img.tag} · {s.replicasReady}/{s.replicasDesired} {t.stateful.ready}
                    {s.updateStrategy && ` · ${s.updateStrategy}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-7 w-7"
                    onClick={() => scale(s, s.replicasDesired - 1)} disabled={busy === s.name || s.replicasDesired <= 0}>
                    <Minus />
                  </Button>
                  <span className="w-10 text-center font-mono text-sm text-ink-soft">{s.replicasDesired}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7"
                    onClick={() => scale(s, s.replicasDesired + 1)} disabled={busy === s.name}>
                    <Plus />
                  </Button>
                  <Button variant="outline" size="sm" className="ml-2"
                    onClick={() => restart(s)} disabled={busy === s.name}>
                    {busy === s.name ? t.stateful.restartBtnBusy : t.stateful.restartBtn}
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
      {!rows && !error && <div className="text-sm text-ink-faint">{t.stateful.loading}</div>}
    </div>
  );
}
