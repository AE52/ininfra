import { ArrowUpRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { CodeBlock } from "@/components/CodeBlock";
import { quickstart, site } from "@/lib/content";

export function Quickstart() {
  return (
    <section id="quickstart" className="relative scroll-mt-20 py-20 sm:py-28">
      <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="QUICKSTART"
          title={
            <>
              Up and running in{" "}
              <span className="text-gradient">three commands</span>.
            </>
          }
          description="Build & push the images, create the namespace + auth secret, then apply the manifests. Replace the placeholders with your own values."
        />

        <div className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5">
            {quickstart.steps.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.06}>
                <div className="flex items-start gap-4">
                  <div className="mt-1 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full border border-hairline bg-base font-mono text-xs text-brand-cyan sm:flex">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <CodeBlock code={s.code} label={s.label} />
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1}>
            <div className="rounded-2xl border border-hairline bg-panel/70 p-6">
              <h3 className="font-display text-lg font-semibold tracking-tight text-ink">
                Configuration
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Everything deployment-specific is an environment variable —
                nothing about a cluster, namespace, registry, or brand is
                hard-coded.
              </p>

              <ul className="mt-5 space-y-3">
                {quickstart.env.map((e) => (
                  <li
                    key={e.name}
                    className="flex flex-col gap-0.5 border-b border-hairline/60 pb-3 last:border-0 last:pb-0"
                  >
                    <code className="font-mono text-sm text-brand-cyan">
                      {e.name}
                    </code>
                    <span className="text-xs text-muted">{e.note}</span>
                  </li>
                ))}
              </ul>

              <a
                href={`${site.repo}/blob/main/docs/CONFIGURATION.md`}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink transition-colors hover:text-brand-cyan"
              >
                Full configuration reference
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
