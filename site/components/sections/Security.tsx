import { ShieldCheck } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { security } from "@/lib/content";

export function Security() {
  return (
    <section className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="SECURITY"
          title={
            <>
              Secure by default,{" "}
              <span className="text-gradient">least privilege</span> by design.
            </>
          }
          description="Hashed credentials, stateless sessions, a namespace allowlist, role enforcement, and tightly scoped RBAC. Always serve over TLS."
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {security.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.06}>
              <div className="h-full rounded-2xl border border-hairline bg-panel/70 p-5">
                <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-hairline bg-white/[0.03] text-brand-violet">
                  <ShieldCheck className="h-4.5 w-4.5" strokeWidth={1.6} />
                </div>
                <h3 className="font-display text-base font-semibold tracking-tight text-ink">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
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
