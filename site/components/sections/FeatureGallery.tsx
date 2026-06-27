"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";
import { withBase } from "@/lib/base";

type Shot = {
  img: string;
  url: string;
  kicker: string;
  title: string;
  desc: string;
};

// Real screenshots captured from the console running against a live cluster.
const SHOTS: Shot[] = [
  {
    img: "01-setup",
    url: "console.your-cluster/setup",
    kicker: "FIRST RUN",
    title: "Guided setup wizard",
    desc: "Self-host in minutes: name the console, point it at your cluster, pick the namespaces it may manage, toggle integrations, and create the first admin — no YAML required.",
  },
  {
    img: "04-overview",
    url: "console.your-cluster",
    kicker: "OVERVIEW",
    title: "The whole cluster at a glance",
    desc: "Nodes with live CPU and memory, workload health, and the things that need attention — the first screen every operator opens.",
  },
  {
    img: "05-services",
    url: "console.your-cluster/services",
    kicker: "WORKLOADS",
    title: "Every Deployment & StatefulSet",
    desc: "List, filter by namespace, and see image, health, and replica counts across all the namespaces you manage.",
  },
  {
    img: "06-service-detail",
    url: "console.your-cluster/services/demo/web-frontend",
    kicker: "SERVICE DETAIL",
    title: "Scale and roll out, safely",
    desc: "Replica status, resource requests and limits, the pods behind the service, and the commit that's actually deployed — with one-click scale and rolling restart.",
  },
  {
    img: "07-live-logs",
    url: "console.your-cluster/services/demo/web-frontend",
    kicker: "LIVE LOGS",
    title: "Stream logs in the browser",
    desc: "Tail pod logs live over SSE with a volume histogram, level filters, multi-pod selection, and full-text or regex search.",
  },
  {
    img: "08-env",
    url: "console.your-cluster/services/demo/web-frontend/env",
    kicker: "ENVIRONMENT",
    title: "Edit env without YAML",
    desc: "View and patch container env from ConfigMaps and Secrets. Secret values stay masked until you reveal them, with optimistic concurrency on save.",
  },
  {
    img: "10-nodes",
    url: "console.your-cluster/nodes",
    kicker: "NODES",
    title: "Cluster-wide node inventory",
    desc: "Every node with live CPU and memory from metrics-server, capacity type, and the pods scheduled on each.",
  },
  {
    img: "11-autoscaling",
    url: "console.your-cluster/hpa",
    kicker: "AUTOSCALING",
    title: "Tune HPAs inline",
    desc: "View and edit HorizontalPodAutoscalers — min/max replicas and target utilization — without leaving the console.",
  },
  {
    img: "12-status",
    url: "console.your-cluster/status",
    kicker: "STATUS PAGE",
    title: "Atlassian-style health",
    desc: "A status page backed by a background monitor that records every component health transition over time.",
  },
  {
    img: "14-audit",
    url: "console.your-cluster/audit",
    kicker: "AUDIT LOG",
    title: "Every change, attributed",
    desc: "A cursor-paginated, time-ordered record of every mutating action, tied to the user who made it — written to your own Postgres.",
  },
  {
    img: "15-users",
    url: "console.your-cluster/users",
    kicker: "USERS & ROLES",
    title: "Role-based access",
    desc: "Create console users with developer, admin, or super-admin roles. Viewers read; only admins change; user management is admin-only.",
  },
];

function ShotFrame({ shot, reduced }: { shot: Shot; reduced: boolean | null }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-hairline bg-panel shadow-2xl shadow-black/50">
      {/* window chrome */}
      <div className="flex items-center gap-2 border-b border-hairline bg-panel px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" aria-hidden />
        <span className="ml-2 truncate rounded bg-black/30 px-2.5 py-0.5 font-mono text-[11px] text-muted">
          {shot.url}
        </span>
      </div>
      {/* screenshot with zoom motion */}
      <div className="relative aspect-[1440/900] overflow-hidden bg-[#0b0f17]">
        <motion.img
          src={withBase(`/shots/${shot.img}.webp`)}
          alt={shot.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full origin-center object-cover object-top will-change-transform"
          initial={reduced ? undefined : { scale: 1 }}
          whileInView={reduced ? undefined : { scale: 1.07 }}
          viewport={{ once: false, margin: "-12%" }}
          transition={
            reduced
              ? undefined
              : { duration: 9, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }
          }
          whileHover={reduced ? undefined : { scale: 1.22, transition: { duration: 0.5, ease: "easeOut" } }}
        />
        {/* subtle "zoom" affordance */}
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-white/15 bg-black/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-white/70 opacity-0 backdrop-blur transition-opacity duration-300 group-hover:opacity-100">
          hover to zoom
        </div>
      </div>
    </div>
  );
}

export function FeatureGallery() {
  const reduced = useReducedMotion();
  return (
    <section id="screenshots" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="EVERY FEATURE · UP CLOSE"
          title={
            <>
              See the console <span className="text-gradient">in detail</span>.
            </>
          }
          description="Real screenshots from inInfra running against a live Kubernetes cluster. Each one drifts in slowly — hover to zoom right into the UI."
        />

        <div className="mt-14 flex flex-col gap-16 sm:gap-24">
          {SHOTS.map((shot, i) => {
            const flip = i % 2 === 1;
            return (
              <Reveal key={shot.img}>
                <div className="grid items-center gap-7 sm:gap-10 lg:grid-cols-12">
                  <div className={cn("lg:col-span-7", flip && "lg:order-2")}>
                    <ShotFrame shot={shot} reduced={reduced} />
                  </div>
                  <div className={cn("lg:col-span-5", flip && "lg:order-1")}>
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-gradient">
                      {String(i + 1).padStart(2, "0")} · {shot.kicker}
                    </div>
                    <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.7rem]">
                      {shot.title}
                    </h3>
                    <p className="mt-3 text-[1.02rem] leading-relaxed text-muted">
                      {shot.desc}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
