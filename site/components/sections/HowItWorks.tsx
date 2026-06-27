import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { steps } from "@/lib/content";

export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="HOW IT WORKS"
          title={
            <>
              Connect. Operate. <span className="text-gradient">Audit.</span>
            </>
          }
          description="A thin operations console — not a cluster installer or a GitOps engine. Point it at your cluster and registry and run it."
        />

        <div className="relative mt-12 grid gap-4 md:grid-cols-3">
          {/* connector line on desktop */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-[2.65rem] hidden h-px md:block"
            style={{
              background:
                "linear-gradient(to right, transparent, rgba(59,130,246,0.5), rgba(34,211,238,0.4), transparent)",
            }}
          />

          {steps.map((s, i) => (
            <Reveal key={s.no} delay={i * 0.08}>
              <div className="relative h-full rounded-2xl border border-hairline bg-panel/70 p-6">
                <div className="relative z-10 inline-flex h-9 items-center rounded-full border border-hairline bg-base px-3 font-mono text-xs text-brand-cyan">
                  STEP {s.no}
                </div>
                <h3 className="mt-5 font-display text-xl font-semibold tracking-tight text-ink">
                  {s.title}
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-muted">
                  {s.desc}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
