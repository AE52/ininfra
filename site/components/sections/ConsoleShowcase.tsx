"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Lock } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { consoleTabs, type ConsoleTab } from "@/lib/content";
import { cn } from "@/lib/cn";

const tabPaths: Record<ConsoleTab, string> = {
  Workloads: "workloads",
  Logs: "logs",
  Deploys: "deploys",
  Status: "status",
};

export function ConsoleShowcase() {
  const [tab, setTab] = React.useState<ConsoleTab>("Workloads");
  const reduced = useReducedMotion();

  return (
    <section className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="THE CONSOLE"
          title={
            <>
              A clean, fast UI for{" "}
              <span className="text-gradient">day-two operations</span>.
            </>
          }
          description="Switch between workloads, live logs, deploys, and the status page — all from one place, every change attributed and audited."
        />

        <Reveal className="mt-12">
          {/* tab switcher */}
          <div
            className="mb-4 inline-flex flex-wrap gap-1 rounded-xl border border-hairline bg-panel/70 p-1"
            role="tablist"
            aria-label="Console views"
          >
            {consoleTabs.map((t) => {
              const active = t === tab;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
                    active ? "text-white" : "text-muted hover:text-ink",
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId={reduced ? undefined : "tabpill"}
                      className="absolute inset-0 -z-0 rounded-lg bg-brand"
                      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                    />
                  ) : null}
                  <span className="relative z-10">{t}</span>
                </button>
              );
            })}
          </div>

          {/* faux browser frame */}
          <div className="overflow-hidden rounded-2xl border border-hairline bg-[#080B11] shadow-[0_40px_100px_-50px_rgba(0,0,0,0.9)]">
            <div className="flex items-center gap-3 border-b border-hairline bg-white/[0.02] px-4 py-3">
              <div className="flex gap-2">
                <span className="h-3 w-3 rounded-full bg-[#FF5F57]" />
                <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" />
                <span className="h-3 w-3 rounded-full bg-[#28C840]" />
              </div>
              <div className="flex flex-1 items-center gap-2 rounded-md border border-hairline bg-base/80 px-3 py-1.5">
                <Lock className="h-3 w-3 text-faint" />
                <span className="truncate font-mono text-xs text-muted">
                  console.your-cluster/{tabPaths[tab]}
                </span>
              </div>
            </div>

            <div className="relative min-h-[20rem] p-4 sm:p-6">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={reduced ? undefined : { opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  {tab === "Workloads" && <WorkloadsMock />}
                  {tab === "Logs" && <LogsMock />}
                  {tab === "Deploys" && <DeploysMock />}
                  {tab === "Status" && <StatusMock />}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Bar({ w }: { w: string }) {
  return <span className="block h-2 rounded-full bg-white/10" style={{ width: w }} />;
}

function WorkloadsMock() {
  const rows = [
    { name: "api-gateway", ns: "prod", ready: "4/4", state: "ok" },
    { name: "web", ns: "prod", ready: "3/3", state: "ok" },
    { name: "worker", ns: "prod", ready: "2/3", state: "warn" },
    { name: "postgres", ns: "data", ready: "1/1", state: "ok" },
  ];
  return (
    <div className="font-mono text-xs">
      <div className="grid grid-cols-[1.6fr_0.7fr_0.6fr_0.8fr] gap-3 border-b border-hairline pb-2 uppercase tracking-wider text-faint">
        <span>Name</span>
        <span>Namespace</span>
        <span>Ready</span>
        <span className="text-right">Actions</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.name}
          className="grid grid-cols-[1.6fr_0.7fr_0.6fr_0.8fr] items-center gap-3 border-b border-hairline/60 py-3"
        >
          <span className="flex items-center gap-2 text-ink">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                r.state === "ok" ? "bg-emerald-400" : "bg-amber-400",
              )}
            />
            {r.name}
          </span>
          <span className="text-muted">{r.ns}</span>
          <span className={r.state === "ok" ? "text-emerald-400" : "text-amber-400"}>
            {r.ready}
          </span>
          <span className="flex justify-end gap-1.5">
            <span className="rounded border border-hairline px-2 py-0.5 text-[0.65rem] text-muted">
              Scale
            </span>
            <span className="rounded border border-hairline px-2 py-0.5 text-[0.65rem] text-muted">
              Restart
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function LogsMock() {
  const lines = [
    { t: "12:04:01", c: "text-muted", m: "GET /api/workloads 200 14ms" },
    { t: "12:04:02", c: "text-muted", m: "reconcile deployment/web rev=482" },
    { t: "12:04:03", c: "text-amber-400", m: "WARN slow query 1.2s" },
    { t: "12:04:04", c: "text-muted", m: "stream attached pod/web-7c9 (SSE)" },
    { t: "12:04:05", c: "text-emerald-400", m: "healthcheck ok db=up cache=up" },
    { t: "12:04:06", c: "text-muted", m: "GET /api/pods 200 9ms" },
  ];
  return (
    <div className="font-mono text-xs">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[0.65rem] text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          LIVE · SSE
        </span>
        <span className="text-faint">pod/web-7c9f8</span>
      </div>
      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-faint">{l.t}</span>
            <span className={l.c}>{l.m}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeploysMock() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-hairline p-4">
        <div className="font-mono text-[0.65rem] uppercase tracking-wider text-faint">
          Deployed commit
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-sm text-ink">
          <span className="rounded bg-white/5 px-1.5 py-0.5 text-brand-cyan">
            a1b9c3f
          </span>
          <span className="text-muted">web:latest</span>
        </div>
        <div className="mt-4 space-y-2">
          <Bar w="92%" />
          <Bar w="74%" />
          <Bar w="60%" />
        </div>
        <div className="mt-4 flex gap-2">
          <span className="rounded-md bg-brand px-3 py-1 text-[0.7rem] font-medium text-white">
            Trigger build
          </span>
          <span className="rounded-md border border-hairline px-3 py-1 text-[0.7rem] text-muted">
            Roll back
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-hairline p-4">
        <div className="font-mono text-[0.65rem] uppercase tracking-wider text-faint">
          Recent builds
        </div>
        <div className="mt-3 space-y-2.5 font-mono text-xs">
          {[
            { n: "#482", s: "ok", c: "a1b9c3f" },
            { n: "#481", s: "ok", c: "9f2e7d1" },
            { n: "#480", s: "fail", c: "77ab210" },
          ].map((b) => (
            <div key={b.n} className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-ink">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    b.s === "ok" ? "bg-emerald-400" : "bg-red-400",
                  )}
                />
                {b.n}
              </span>
              <span className="text-muted">{b.c}</span>
              <span className={b.s === "ok" ? "text-emerald-400" : "text-red-400"}>
                {b.s === "ok" ? "SUCCESS" : "FAILED"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusMock() {
  const comps = [
    { n: "API", s: "Operational" },
    { n: "Web", s: "Operational" },
    { n: "Database", s: "Operational" },
    { n: "Jenkins", s: "Degraded" },
  ];
  return (
    <div>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-sm text-emerald-300">
          All core systems operational
        </span>
      </div>
      <div className="space-y-2">
        {comps.map((c) => (
          <div
            key={c.n}
            className="flex items-center justify-between rounded-lg border border-hairline px-4 py-2.5 text-sm"
          >
            <span className="text-ink">{c.n}</span>
            <span
              className={cn(
                "font-mono text-xs",
                c.s === "Operational" ? "text-emerald-400" : "text-amber-400",
              )}
            >
              {c.s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
