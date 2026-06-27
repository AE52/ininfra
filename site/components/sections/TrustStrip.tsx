import { trustFacts } from "@/lib/content";

export function TrustStrip() {
  return (
    <div className="border-y border-hairline bg-white/[0.015]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-5 py-5 sm:px-6">
        {trustFacts.map((fact, i) => (
          <div key={fact} className="flex items-center gap-6">
            <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-faint">
              {fact}
            </span>
            {i < trustFacts.length - 1 ? (
              <span
                aria-hidden
                className="hidden h-1 w-1 rounded-full bg-faint/50 sm:inline-block"
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
