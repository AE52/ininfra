"use client";

import * as React from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/cn";
import { withBase } from "@/lib/base";

type Shot = { img: string; url: string; kicker: string; title: string; desc?: string };

const MAIN: Shot[] = [
  { img: "01-setup", url: "console.your-cluster/setup", kicker: "FIRST RUN", title: "Guided setup wizard", desc: "Self-host in minutes: name the console, point it at your cluster, pick the namespaces it may manage, toggle integrations, and create the first admin — no YAML required." },
  { img: "04-overview", url: "console.your-cluster", kicker: "OVERVIEW", title: "The whole cluster at a glance", desc: "Nodes with live CPU and memory, workload health, and the things that need attention — the first screen every operator opens." },
  { img: "05-services", url: "console.your-cluster/services", kicker: "WORKLOADS", title: "Every Deployment & StatefulSet", desc: "List, filter by namespace, and see image, health, and replica counts across all the namespaces you manage." },
  { img: "06-service-detail", url: "console.your-cluster/services/demo/web-frontend", kicker: "SERVICE DETAIL", title: "Scale and roll out, safely", desc: "Replica status, resource requests and limits, the pods behind the service, and the commit that's actually deployed — with one-click scale and rolling restart." },
  { img: "07-live-logs", url: "console.your-cluster/services/demo/web-frontend", kicker: "LIVE LOGS", title: "Stream logs in the browser", desc: "Tail pod logs live over SSE with a volume histogram, level filters, multi-pod selection, and full-text or regex search." },
  { img: "08-env", url: "console.your-cluster/.../env", kicker: "ENVIRONMENT", title: "Edit env without YAML", desc: "View and patch container env from ConfigMaps and Secrets. Secret values stay masked until you reveal them, with optimistic concurrency on save." },
  { img: "10-nodes", url: "console.your-cluster/nodes", kicker: "NODES", title: "Cluster-wide node inventory", desc: "Every node with live CPU and memory from metrics-server, capacity type, and the pods scheduled on each." },
  { img: "11-autoscaling", url: "console.your-cluster/hpa", kicker: "AUTOSCALING", title: "Tune HPAs inline", desc: "View and edit HorizontalPodAutoscalers — min/max replicas and target utilization — without leaving the console." },
  { img: "22-jobs", url: "console.your-cluster/jobs", kicker: "JOBS & CRONJOBS", title: "Schedule, suspend, run now", desc: "List CronJobs and recent Jobs, suspend or resume a schedule, and trigger a run on demand — every action audited." },
  { img: "23-capacity", url: "console.your-cluster/capacity", kicker: "CAPACITY & QUOTAS", title: "Know your headroom", desc: "Per-node allocatable vs requested vs live-used CPU/memory rolled up cluster-wide, plus per-namespace ResourceQuota and LimitRange usage." },
  { img: "24-rightsizing", url: "console.your-cluster/rightsizing", kicker: "RIGHT-SIZING", title: "Stop over-provisioning", desc: "Configured requests and limits next to live usage, flagging over-provisioned and throttle-risk workloads — advisory, never applied automatically." },
  { img: "12-status", url: "console.your-cluster/status", kicker: "STATUS PAGE", title: "Atlassian-style health", desc: "A status page backed by a background monitor that records every component health transition over time." },
  { img: "14-audit", url: "console.your-cluster/audit", kicker: "AUDIT LOG", title: "Every change, attributed", desc: "A cursor-paginated, time-ordered record of every mutating action, tied to the user who made it — written to your own Postgres." },
  { img: "15-users", url: "console.your-cluster/users", kicker: "USERS & ROLES", title: "Role-based access", desc: "Create console users with developer, admin, or super-admin roles. Viewers read; only admins change; user management is admin-only." },
];

const MORE: Shot[] = [
  { img: "25-secrets-health", url: "console.your-cluster/secrets", kicker: "SECRETS HEALTH", title: "TLS cert expiry" },
  { img: "09-stateful", url: "console.your-cluster/stateful", kicker: "STATEFULSETS", title: "Stateful workloads" },
  { img: "16-builds", url: "console.your-cluster/builds", kicker: "CI / CD", title: "Builds & deploys" },
  { img: "17-branches", url: "console.your-cluster/branches", kicker: "BRANCHES", title: "Per-service deploy branch" },
  { img: "18-storage", url: "console.your-cluster/storage", kicker: "STORAGE", title: "PVC file browser" },
  { img: "13-events", url: "console.your-cluster/events", kicker: "EVENTS", title: "Namespace event stream" },
  { img: "21-search", url: "console.your-cluster/search", kicker: "SEARCH", title: "Global command palette" },
  { img: "19-favorites", url: "console.your-cluster/favorites", kicker: "FAVORITES", title: "Pin what you watch" },
  { img: "20-errors", url: "console.your-cluster/errors", kicker: "ERROR FEED", title: "Sentry-style errors" },
];

/** A browser-framed screenshot that tilts toward the cursor in 3D, lifts, and
 *  glows — with a soft sheen tracking the pointer and the shot zooming gently. */
function TiltShot({ shot, compact = false }: { shot: Shot; compact?: boolean }) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const tilt = compact ? 5 : 7;
  const rotateX = useSpring(useTransform(my, [0, 1], [tilt, -tilt]), { stiffness: 140, damping: 14 });
  const rotateY = useSpring(useTransform(mx, [0, 1], [-tilt, tilt]), { stiffness: 140, damping: 14 });
  const sheenX = useTransform(mx, (v) => `${v * 100}%`);
  const sheenY = useTransform(my, (v) => `${v * 100}%`);

  function onMove(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  }
  const reset = () => { mx.set(0.5); my.set(0.5); };

  const frame = (
    <div className="overflow-hidden rounded-xl border border-hairline bg-panel">
      <div className="flex items-center gap-2 border-b border-hairline bg-panel px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" aria-hidden />
        <span className="ml-2 truncate rounded bg-black/30 px-2 py-0.5 font-mono text-[10px] text-muted">
          {shot.url}
        </span>
      </div>
      <div className="relative aspect-[1440/900] overflow-hidden bg-[#0b0f17]">
        <img
          src={withBase(`/shots/${shot.img}.webp`)}
          alt={shot.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-[600ms] ease-out group-hover:scale-[1.05]"
        />
        {!reduced && (
          <motion.div
            className="pointer-events-none absolute h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/20 opacity-0 blur-3xl transition-opacity duration-300 group-hover:opacity-100"
            style={{ left: sheenX, top: sheenY }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );

  if (reduced) {
    return <div className="group transition-transform duration-300 hover:-translate-y-1">{frame}</div>;
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ rotateX, rotateY, transformPerspective: 1000 }}
      whileHover={{ scale: compact ? 1.03 : 1.015, y: -4 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className={cn(
        "group relative rounded-xl transition-shadow duration-500 will-change-transform",
        "[box-shadow:0_24px_60px_-36px_rgba(0,0,0,0.85)]",
        "hover:[box-shadow:0_40px_110px_-30px_rgba(124,92,255,0.40)]",
      )}
    >
      {frame}
    </motion.div>
  );
}

export function FeatureGallery() {
  return (
    <section id="screenshots" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="EVERY FEATURE · UP CLOSE"
          title={<>See the console <span className="text-gradient">in detail</span>.</>}
          description="Real screenshots from inInfra running against a live Kubernetes cluster. Move your cursor over any shot — it tilts in 3D and zooms right into the UI."
        />

        <div className="mt-14 flex flex-col gap-16 sm:gap-24">
          {MAIN.map((shot, i) => {
            const flip = i % 2 === 1;
            return (
              <Reveal key={shot.img}>
                <div className="grid items-center gap-7 sm:gap-10 lg:grid-cols-12">
                  <div className={cn("lg:col-span-7", flip && "lg:order-2")}>
                    <TiltShot shot={shot} />
                  </div>
                  <div className={cn("lg:col-span-5", flip && "lg:order-1")}>
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-gradient">
                      {String(i + 1).padStart(2, "0")} · {shot.kicker}
                    </div>
                    <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink sm:text-[1.7rem]">
                      {shot.title}
                    </h3>
                    <p className="mt-3 text-[1.02rem] leading-relaxed text-muted">{shot.desc}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* More capabilities — compact grid */}
        <Reveal className="mt-24">
          <div className="mb-8 text-center">
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-gradient">
              AND MORE
            </div>
            <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink">
              Everything else an operator reaches for
            </h3>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {MORE.map((shot) => (
              <div key={shot.img} style={{ perspective: 1000 }}>
                <TiltShot shot={shot} compact />
                <div className="mt-3 px-0.5">
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/80">
                    {shot.kicker}
                  </div>
                  <div className="mt-0.5 font-display text-[0.98rem] font-semibold text-ink">
                    {shot.title}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
