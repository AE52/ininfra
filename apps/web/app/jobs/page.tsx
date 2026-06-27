"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CronJobSummary,
  JobStatus,
  JobSummary,
  Namespace,
} from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useConfig } from "@/components/ConfigProvider";
import { PageHeader, EmptyState, NamespaceTag } from "@/components/ui";
import { ErrorPanel } from "@/components/ErrorPanel";
import { useToast } from "@/components/Toast";
import { cx, fmtDuration, shortImage, timeAgo } from "@/lib/format";
import { Card } from "@/components/ui/card";
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

/** Special scope value meaning "every managed namespace" (ns omitted). */
const ALL = "__all__";

function jobStatusMeta(
  status: JobStatus,
  t: ReturnType<typeof useT>,
): { label: string; cls: string; dot: string } {
  switch (status) {
    case "Complete":
      return { label: t.jobs.statusComplete, cls: "text-pf-green bg-pf-green-50", dot: "bg-pf-green" };
    case "Failed":
      return { label: t.jobs.statusFailed, cls: "text-pf-red bg-pf-red-50", dot: "bg-pf-red" };
    case "Running":
      return { label: t.jobs.statusRunning, cls: "text-pf-blue bg-pf-blue-50", dot: "bg-pf-blue" };
    default:
      return { label: t.jobs.statusUnknown, cls: "text-ink-muted bg-line-soft", dot: "bg-ink-faint" };
  }
}

export default function JobsPage() {
  const t = useT();
  const toast = useToast();
  const { managedNamespaces } = useConfig();

  const [scope, setScope] = useState<string>(ALL);
  const [cronjobs, setCronjobs] = useState<CronJobSummary[] | null>(null);
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCronjobs(null);
    setJobs(null);
    try {
      setError(null);
      const ns: Namespace | undefined = scope === ALL ? undefined : scope;
      const [cj, jb] = await Promise.all([
        api.listCronjobs(ns, { limit: 500 }),
        api.listJobs(ns, { limit: 500 }),
      ]);
      setCronjobs(cj.items);
      setJobs(jb.items);
    } catch (e) {
      setError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    }
  }, [scope]);
  useEffect(() => {
    load();
  }, [load]);

  // key for the busy guard so concurrent cronjobs don't all spin together
  const cronKey = (c: CronJobSummary) => `${c.namespace}/${c.name}`;

  async function toggleSuspend(c: CronJobSummary) {
    const next = !c.suspended;
    const confirmMsg = next
      ? t.jobs.confirmSuspend(c.name)
      : t.jobs.confirmResume(c.name);
    if (!window.confirm(confirmMsg)) return;
    setBusy(cronKey(c));
    try {
      await api.suspendCronjob(c.namespace, c.name, next);
      toast(
        "success",
        next ? t.jobs.toastSuspendSuccess(c.name) : t.jobs.toastResumeSuccess(c.name),
      );
      await load();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runNow(c: CronJobSummary) {
    if (!window.confirm(t.jobs.confirmTrigger(c.name))) return;
    setBusy(cronKey(c));
    try {
      const ack = await api.triggerCronjob(c.namespace, c.name);
      toast("success", t.jobs.toastTriggerSuccess(ack.jobName));
      await load();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const scopes: Array<{ key: string; label: string }> = [
    { key: ALL, label: t.jobs.allNamespaces },
    ...managedNamespaces.map((n) => ({ key: n, label: n })),
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.jobs.kicker}
        title={t.jobs.title}
        subtitle={t.jobs.subtitle}
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {scopes.map((s) => (
          <Button
            key={s.key}
            size="sm"
            variant={scope === s.key ? "default" : "outline"}
            onClick={() => setScope(s.key)}
          >
            {s.label}
          </Button>
        ))}
      </div>

      {error && <ErrorPanel message={error} />}

      {/* ── CronJobs ──────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          {t.jobs.cronjobsTitle}
        </h2>
        {!cronjobs && !error && (
          <div className="text-sm text-ink-faint">{t.jobs.loading}</div>
        )}
        {cronjobs && cronjobs.length === 0 && (
          <EmptyState title={t.jobs.noCronjobs} />
        )}
        {cronjobs && cronjobs.length > 0 && (
          <div className="space-y-2.5">
            {cronjobs.map((c) => {
              const img = c.image ? shortImage(c.image) : null;
              const key = cronKey(c);
              return (
                <Card
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-4 p-4"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{c.name}</span>
                      <NamespaceTag ns={c.namespace} />
                      {c.suspended && (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-pf-gold-50 px-2 py-0.5 text-[11px] font-medium text-[#8a6d00]"
                        >
                          {t.jobs.suspended}
                        </Badge>
                      )}
                      {c.activeCount > 0 && (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-pf-blue-50 px-2 py-0.5 text-[11px] font-medium text-pf-blue"
                        >
                          {c.activeCount} {t.jobs.active}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-ink-faint">
                      <span className="text-ink-muted">{c.schedule}</span>
                      {img && ` · ${img.name}:${img.tag}`}
                      {` · ${t.jobs.lastRun}: `}
                      {c.lastScheduleTime ? timeAgo(c.lastScheduleTime) : t.jobs.never}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleSuspend(c)}
                      disabled={busy === key}
                    >
                      {busy === key
                        ? t.jobs.busy
                        : c.suspended
                          ? t.jobs.resumeBtn
                          : t.jobs.suspendBtn}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => runNow(c)}
                      disabled={busy === key}
                    >
                      {t.jobs.runNowBtn}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Recent Jobs ───────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-faint">
          {t.jobs.recentJobsTitle}
        </h2>
        {!jobs && !error && (
          <div className="text-sm text-ink-faint">{t.jobs.loading}</div>
        )}
        {jobs && jobs.length === 0 && <EmptyState title={t.jobs.noJobs} />}
        {jobs && jobs.length > 0 && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[820px]">
                <TableHeader>
                  <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint">
                    <TableHead className="px-4 py-2.5 font-medium">{t.jobs.colJob}</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">{t.jobs.colStatus}</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">{t.jobs.colCompletions}</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">{t.jobs.colDuration}</TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">{t.jobs.colOwner}</TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">{t.jobs.colStarted}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((j) => {
                    const m = jobStatusMeta(j.status, t);
                    const completions =
                      j.completions != null
                        ? `${j.succeeded}/${j.completions}`
                        : `${j.succeeded}`;
                    const duration =
                      j.durationSeconds != null
                        ? fmtDuration(j.durationSeconds * 1000)
                        : j.status === "Running"
                          ? t.jobs.statusRunning
                          : "—";
                    return (
                      <TableRow
                        key={`${j.namespace}/${j.name}`}
                        className="border-b border-line last:border-0 hover:bg-line-soft"
                      >
                        <TableCell className="px-4 py-3 font-mono text-xs text-ink-soft">
                          <div className="flex items-center gap-2">
                            {j.name}
                            <NamespaceTag ns={j.namespace} />
                          </div>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={cx(
                              "gap-1.5 border-transparent px-2 py-0.5 text-[11px] font-medium",
                              m.cls,
                            )}
                          >
                            <span className={cx("inline-block h-2 w-2 rounded-full", m.dot)} aria-hidden />
                            {m.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular px-4 py-3 text-right font-mono text-xs text-ink-muted">
                          {completions}
                          {j.failed > 0 && (
                            <span className="ml-1 text-pf-red">({j.failed}✕)</span>
                          )}
                        </TableCell>
                        <TableCell className="tabular px-4 py-3 text-right font-mono text-xs text-ink-soft">
                          {duration}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-[11px] text-ink-faint">
                          {j.owner ?? "—"}
                        </TableCell>
                        <TableCell className="px-4 py-3 text-right text-xs text-ink-faint">
                          {timeAgo(j.startTime)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
