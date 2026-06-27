"use client";

import { motion, useReducedMotion } from "framer-motion";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { features } from "@/lib/content";
import { cn } from "@/lib/cn";

export function Features() {
  const reduced = useReducedMotion();

  return (
    <section id="features" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="FEATURES"
          title={
            <>
              Everything you need to{" "}
              <span className="text-gradient">run a cluster</span>.
            </>
          }
          description="One console for workloads, env, logs, storage, deploys, access, and observability — built on Rust and Next.js, no GitOps lock-in."
        />

        <motion.div
          className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          variants={
            reduced
              ? undefined
              : { hidden: {}, show: { transition: { staggerChildren: 0.05 } } }
          }
        >
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.title}
                variants={
                  reduced
                    ? undefined
                    : {
                        hidden: { opacity: 0, y: 16 },
                        show: {
                          opacity: 1,
                          y: 0,
                          transition: {
                            duration: 0.5,
                            ease: [0.22, 1, 0.36, 1],
                          },
                        },
                      }
                }
                whileHover={reduced ? undefined : { y: -4 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  "gradient-border group relative flex flex-col rounded-2xl border border-hairline bg-panel/70 p-5 transition-colors hover:bg-panel",
                  f.span === "wide" && "sm:col-span-2 lg:col-span-2",
                )}
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-hairline bg-white/[0.03] text-brand-cyan transition-colors group-hover:border-brand-blue/50">
                  <Icon className="h-5 w-5" strokeWidth={1.6} />
                </div>
                <span className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-faint">
                  {f.kicker}
                </span>
                <h3 className="mt-1.5 font-display text-lg font-semibold tracking-tight text-ink">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {f.desc}
                </p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
