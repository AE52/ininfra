"use client";

import { SectionHeading } from "@/components/ui/SectionHeading";
import { Reveal } from "@/components/Reveal";
import { withBase } from "@/lib/base";

/**
 * A real, end-to-end screen recording: the first-run setup wizard, then the
 * console operating live workloads on a Kubernetes cluster. No narration —
 * just the product running.
 */
export function Demo() {
  return (
    <section id="demo" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <SectionHeading
          kicker="SEE IT LIVE"
          title={
            <>
              From zero to operating a cluster in{" "}
              <span className="text-gradient">under a minute</span>.
            </>
          }
          description="A real recording — the first-run setup wizard, then the console listing, inspecting, and operating live workloads. No edits, no narration."
        />

        <Reveal className="mt-12">
          {/* faux-browser frame, echoing the console showcase */}
          <div className="overflow-hidden rounded-2xl border border-hairline bg-panel/70 shadow-2xl shadow-black/40">
            <div className="flex items-center gap-2 border-b border-hairline bg-panel px-4 py-3">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
              <span className="ml-3 truncate rounded-md bg-black/30 px-3 py-1 font-mono text-xs text-muted">
                console.your-cluster
              </span>
            </div>
            <video
              className="block aspect-[1440/900] w-full bg-black"
              src={withBase("/demo.mp4")}
              poster={withBase("/demo-poster.jpg")}
              controls
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
            />
          </div>
          <p className="mt-4 text-center font-mono text-xs text-muted">
            Setup wizard → workloads → topology &amp; drift → jobs → capacity →
            right-sizing → secrets health → statefulsets → nodes → audit
          </p>
        </Reveal>
      </div>
    </section>
  );
}
