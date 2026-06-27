"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import type {
  HealthStatus,
  Incident,
  OverallStatus,
  StatusComponent,
  StatusSummary,
} from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cx, fmtDuration, fmtTime, timeAgo } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

const REFRESH_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Visual token maps                                                   */
/* ------------------------------------------------------------------ */

type OverallTheme = {
  icon: LucideIcon;
  headline: string;
  band: string;
  iconWrap: string;
};

type OverallThemeBase = Omit<OverallTheme, "headline">;

const OVERALL_STYLE: Record<OverallStatus, OverallThemeBase> = {
  operational: {
    icon: CheckCircle2,
    band: "bg-pf-green-50 border-pf-green/30 text-pf-green",
    iconWrap: "bg-pf-green/10 text-pf-green",
  },
  degraded: {
    icon: AlertTriangle,
    band: "bg-pf-gold-50 border-pf-gold/40 text-[#8a6d00]",
    iconWrap: "bg-pf-gold/15 text-[#8a6d00]",
  },
  major_outage: {
    icon: AlertOctagon,
    band: "bg-pf-red-50 border-pf-red/30 text-pf-red",
    iconWrap: "bg-pf-red/10 text-pf-red",
  },
};

type StatusTheme = { label: string; dot: string; text: string };

const STATUS_STYLE: Record<HealthStatus, Omit<StatusTheme, "label">> = {
  healthy: { dot: "bg-pf-green", text: "text-pf-green" },
  progressing: { dot: "bg-pf-gold animate-pulse", text: "text-[#8a6d00]" },
  degraded: { dot: "bg-pf-red", text: "text-pf-red" },
  unknown: { dot: "bg-ink-faint", text: "text-ink-muted" },
};

/** Map an uptime fraction (0..1) to a bar fill tone. */
function uptimeFill(uptime: number): string {
  if (uptime >= 0.99) return "bg-pf-green";
  if (uptime >= 0.9) return "bg-pf-gold";
  return "bg-pf-red";
}

function groupLabel(kind: string, t: ReturnType<typeof useT>): string {
  if (kind === "Deployment") return t.status.services;
  if (kind === "StatefulSet") return t.status.statefulSets;
  return kind;
}

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
}

/** Sort: degraded / ongoing components first, then alphabetical. */
function rank(c: StatusComponent): number {
  if (c.ongoing || c.status === "degraded") return 0;
  if (c.status === "progressing") return 1;
  if (c.status === "unknown") return 2;
  return 3;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function StatusPage() {
  const t = useT();
  const [data, setData] = useState<StatusSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Re-render tick so "down for …" durations advance between fetches.
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;

    async function pull() {
      try {
        const next = await api.getStatus();
        if (!alive) return;
        setData(next);
        setError(null);
      } catch (e) {
        if (alive) setError(errMsg(e));
      } finally {
        if (alive) setLoading(false);
      }
    }

    void pull();
    const refresh = setInterval(() => void pull(), REFRESH_MS);
    // Lightweight 1s tick so live incident durations stay current.
    const ticker = setInterval(() => alive && setTick((t) => t + 1), 1000);
    return () => {
      alive = false;
      clearInterval(refresh);
      clearInterval(ticker);
    };
  }, []);

  if (loading && !data) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.status.kicker} title={t.status.title} />
        <Card className="p-12 text-center text-sm text-ink-faint">{t.status.loading}</Card>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={t.status.kicker} title={t.status.title} />
        <div className="rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-3 text-sm text-pf-red">
          {t.status.loadError(error)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <StatusBody data={data} error={error} />
    </TooltipProvider>
  );
}

function StatusBody({
  data,
  error,
}: {
  data: StatusSummary;
  error: string | null;
}) {
  const t = useT();
  const headlines: Record<OverallStatus, string> = {
    operational: t.status.allOperational,
    degraded: t.status.partialDegradation,
    major_outage: t.status.majorOutage,
  };
  const themeBase = OVERALL_STYLE[data.overall];
  const theme: OverallTheme = { ...themeBase, headline: headlines[data.overall] };
  const HeroIcon = theme.icon;

  const ongoing = useMemo(
    () => data.incidents.filter((i) => i.ongoing),
    [data.incidents],
  );

  // Group components by kind, each group sorted degraded-first then by name.
  const groups = useMemo(() => {
    const byKind = new Map<string, StatusComponent[]>();
    for (const c of data.components) {
      const arr = byKind.get(c.kind);
      if (arr) arr.push(c);
      else byKind.set(c.kind, [c]);
    }
    const order = ["Deployment", "StatefulSet"];
    return Array.from(byKind.entries())
      .sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      })
      .map(([kind, items]) => ({
        kind,
        items: [...items].sort(
          (x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name),
        ),
      }));
  }, [data.components]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker={t.status.kicker}
        title={t.status.title}
        subtitle={t.status.subtitle}
        actions={
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pf-green/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-pf-green" />
            </span>
            <span className="tabular" title={fmtTime(data.updatedAt)}>
              {t.status.updatedAgo(timeAgo(data.updatedAt))}
            </span>
          </div>
        }
      />

      {error && (
        <div className="mb-5 rounded-pf border border-pf-gold/40 bg-pf-gold-50 px-4 py-2 text-xs text-[#8a6d00]">
          {t.status.showingLastKnown(error)}
        </div>
      )}

      {/* Hero status banner — the focal point. */}
      <Card
        className={cx(
          "mb-6 flex items-center gap-5 border px-6 py-7 shadow-card",
          theme.band,
        )}
      >
        <div
          className={cx(
            "flex h-16 w-16 shrink-0 items-center justify-center rounded-full",
            theme.iconWrap,
          )}
        >
          <HeroIcon className="h-9 w-9" strokeWidth={2} />
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            {theme.headline}
          </h2>
          <p className="mt-1.5 text-sm font-medium text-ink-soft">
            {t.status.healthySummary(data.healthy, data.total)}
            {data.degraded > 0 && (
              <>
                {" · "}
                <span className="tabular font-semibold text-pf-red">
                  {data.degraded}
                </span>{" "}
                {t.status.statusDegraded.toLowerCase()}
              </>
            )}
            <span className="text-ink-faint">
              {" · "}{t.status.uptimeWindow(data.windowHours)}
            </span>
          </p>
        </div>
      </Card>

      {/* Ongoing incidents — loud, top of page. */}
      {ongoing.length > 0 && (
        <section className="mb-6">
          <h3 className="label-kicker mb-2 text-pf-red">
            {t.status.activeIncidents(ongoing.length)}
          </h3>
          <Card className="overflow-hidden border-pf-red/40 shadow-card">
            <div className="border-l-4 border-pf-red">
              {ongoing.map((inc, i) => (
                <OngoingIncidentRow
                  key={`${inc.namespace}/${inc.name}`}
                  incident={inc}
                  last={i === ongoing.length - 1}
                />
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* Components grouped by kind. */}
      <section className="mb-8 space-y-6">
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="label-kicker">{groupLabel(g.kind, t)}</h3>
              <span className="text-xs text-ink-faint">
                {t.status.components(g.items.length)}
              </span>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="min-w-[760px] text-sm">
                  <TableHeader>
                    <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                      <TableHead className="px-4 py-2.5 font-medium">
                        {t.status.colComponent}
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">
                        {t.status.colStatus}
                      </TableHead>
                      <TableHead className="px-4 py-2.5 font-medium">
                        {t.status.colReplicas}
                      </TableHead>
                      <TableHead className="w-[34%] px-4 py-2.5 font-medium">
                        {t.status.colUptime(data.windowHours)}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.items.map((c) => (
                      <ComponentRow
                        key={`${c.namespace}/${c.name}`}
                        comp={c}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          </div>
        ))}
      </section>

      {/* Incident history. */}
      <section>
        <h3 className="label-kicker mb-2">{t.status.incidentHistory}</h3>
        {data.incidents.length === 0 ? (
          <EmptyState
            title={t.status.noIncidents}
            body={t.status.noIncidentsBody(data.windowHours)}
          />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <Table className="min-w-[680px] text-sm">
                <TableHeader>
                  <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                    <TableHead className="px-4 py-2.5 font-medium">
                      {t.status.colComponent}
                    </TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">
                      {t.status.colStatus}
                    </TableHead>
                    <TableHead className="px-4 py-2.5 font-medium">
                      {t.status.colStarted}
                    </TableHead>
                    <TableHead className="px-4 py-2.5 text-right font-medium">
                      {t.status.colDuration}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.incidents.map((inc, i) => (
                    <IncidentRow
                      key={`${inc.namespace}/${inc.name}/${inc.startedAt}/${i}`}
                      incident={inc}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

function OngoingIncidentRow({
  incident,
  last,
}: {
  incident: Incident;
  last: boolean;
}) {
  const t = useT();
  const down = fmtDuration(Date.now() - new Date(incident.startedAt).getTime());
  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-pf-red-50/60 px-4 py-3.5",
        !last && "border-b border-pf-red/20",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pf-red/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-pf-red" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-semibold text-ink">
            {incident.name}
          </div>
          <div className="text-[11px] text-ink-muted">
            {incident.namespace} · {incident.kind}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 text-right">
        <div className="text-sm font-semibold text-pf-red">
          {t.status.downFor(down)}
        </div>
        <div
          className="hidden text-[11px] text-ink-muted sm:block"
          title={fmtTime(incident.startedAt)}
        >
          {t.status.since(timeAgo(incident.startedAt))}
        </div>
      </div>
    </div>
  );
}

function ComponentRow({ comp }: { comp: StatusComponent }) {
  const t = useT();
  const statusLabels: Record<HealthStatus, string> = {
    healthy: t.status.statusOperational,
    progressing: t.status.statusProgressing,
    degraded: t.status.statusDegraded,
    unknown: t.status.statusUnknown,
  };
  const stBase = STATUS_STYLE[comp.status];
  const st: StatusTheme = { ...stBase, label: statusLabels[comp.status] };
  const pct = (comp.uptime * 100).toFixed(2);
  const fillWidth = `${Math.max(0, Math.min(1, comp.uptime)) * 100}%`;
  const ready = comp.replicasReady === comp.replicasDesired;

  return (
    <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3">
        <div className="font-mono text-[13px] font-medium text-ink">
          {comp.name}
        </div>
        <div className="text-[11px] text-ink-faint">{comp.namespace}</div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <span className="flex items-center gap-2">
          <span
            className={cx("h-2.5 w-2.5 shrink-0 rounded-full", st.dot)}
            aria-hidden
          />
          <span className={cx("text-[13px] font-medium", st.text)}>
            {st.label}
          </span>
        </span>
        {comp.since && (
          <span
            className="mt-0.5 block text-[11px] text-ink-faint"
            title={fmtTime(comp.since)}
          >
            {t.status.since(timeAgo(comp.since))}
          </span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3">
        <span
          className={cx(
            "tabular text-[13px]",
            ready ? "text-ink-soft" : "font-semibold text-pf-red",
          )}
        >
          {comp.replicasReady}/{comp.replicasDesired}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="h-2 flex-1 cursor-default overflow-hidden rounded-full bg-line"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={comp.uptime * 100}
                aria-label={`Uptime ${pct}%`}
              >
                <div
                  className={cx(
                    "h-full rounded-full transition-all",
                    uptimeFill(comp.uptime),
                  )}
                  style={{ width: fillWidth }}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <span className="tabular">{pct}% uptime</span> over the window
            </TooltipContent>
          </Tooltip>
          <span
            className={cx(
              "tabular w-[3.75rem] shrink-0 text-right text-[13px] font-medium",
              comp.uptime >= 0.99
                ? "text-pf-green"
                : comp.uptime >= 0.9
                  ? "text-[#8a6d00]"
                  : "text-pf-red",
            )}
          >
            {pct}%
          </span>
        </div>
      </TableCell>
    </TableRow>
  );
}

function IncidentRow({ incident }: { incident: Incident }) {
  const t = useT();
  return (
    <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3">
        <div className="font-mono text-[13px] font-medium text-ink">
          {incident.name}
        </div>
        <div className="text-[11px] text-ink-faint">{incident.namespace}</div>
      </TableCell>
      <TableCell className="px-4 py-3">
        <Badge
          variant="outline"
          className="border-pf-red/30 bg-pf-red-50 text-[11px] font-medium text-pf-red"
        >
          {incident.status}
        </Badge>
      </TableCell>
      <TableCell
        className="px-4 py-3 text-[13px] text-ink-muted"
        title={fmtTime(incident.startedAt)}
      >
        {fmtTime(incident.startedAt)}
      </TableCell>
      <TableCell className="px-4 py-3 text-right">
        {incident.ongoing ? (
          <Badge
            variant="outline"
            className="border-pf-red/30 bg-pf-red-50 text-[11px] font-medium text-pf-red"
          >
            <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-pf-red align-middle" />
            {t.status.ongoing}
          </Badge>
        ) : (
          <span className="tabular text-[13px] text-ink-soft">
            {fmtDuration(incident.durationMs)}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
