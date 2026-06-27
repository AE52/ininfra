import { ArrowRight, Github } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { Reveal } from "@/components/Reveal";
import { cta } from "@/lib/content";

export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32">
      {/* glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[120px]"
        style={{
          background:
            "radial-gradient(circle, rgba(124,92,255,0.22), rgba(34,211,238,0.08) 55%, transparent 72%)",
        }}
      />
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative mx-auto max-w-4xl px-5 text-center sm:px-6">
        <Reveal>
          <h2 className="fluid-h2 font-display font-bold text-ink">
            Your cluster. Your data.{" "}
            <span className="text-gradient">Your console.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            {cta.desc}
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href={cta.primary.href} variant="primary" size="lg">
              {cta.primary.label}
              <ArrowRight className="h-4 w-4" />
            </ButtonLink>
            <ButtonLink
              href={cta.secondary.href}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="lg"
            >
              <Github className="h-4 w-4" />
              {cta.secondary.label}
            </ButtonLink>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
