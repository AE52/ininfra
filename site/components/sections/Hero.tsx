"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Github } from "lucide-react";
import { AnimatedTerminal } from "@/components/AnimatedTerminal";
import { ButtonLink } from "@/components/ui/Button";
import { hero } from "@/lib/content";

export function Hero() {
  const reduced = useReducedMotion();

  return (
    <section id="top" className="relative overflow-hidden">
      {/* dot grid */}
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-70" />

      {/* ambient drifting glow (gated behind reduced motion via class) */}
      <div
        aria-hidden
        className={`pointer-events-none absolute left-1/2 top-[-12rem] -z-0 h-[42rem] w-[42rem] -translate-x-1/2 rounded-full blur-[120px] ${
          reduced ? "" : "animate-glow-drift"
        }`}
        style={{
          background:
            "radial-gradient(circle at center, rgba(124,92,255,0.28), rgba(59,130,246,0.16) 42%, rgba(34,211,238,0.08) 64%, transparent 72%)",
        }}
      />

      {/* fade base at bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-base" />

      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:px-6 sm:pt-24 lg:pb-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          {/* Left: copy */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 16 }}
            animate={reduced ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="inline-flex items-center rounded-full border border-hairline bg-white/[0.03] px-3 py-1 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
              {hero.eyebrow}
            </span>

            <h1 className="fluid-display mt-6 font-display font-bold text-ink">
              {hero.headlineLead}{" "}
              <span className="text-gradient">{hero.headlineKeyword}</span>.
            </h1>

            <p className="fluid-deck mt-6 max-w-xl text-muted">{hero.deck}</p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink href={hero.primaryCta.href} variant="primary" size="lg">
                {hero.primaryCta.label}
                <ArrowRight className="h-4 w-4" />
              </ButtonLink>
              <ButtonLink
                href={hero.secondaryCta.href}
                target="_blank"
                rel="noreferrer"
                variant="secondary"
                size="lg"
              >
                <Github className="h-4 w-4" />
                {hero.secondaryCta.label}
              </ButtonLink>
            </div>
          </motion.div>

          {/* Right: animated terminal */}
          <motion.div
            initial={reduced ? false : { opacity: 0, y: 24, scale: 0.985 }}
            animate={reduced ? undefined : { opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.12 }}
          >
            <AnimatedTerminal />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
