"use client";

import * as React from "react";
import { useReducedMotion } from "framer-motion";
import { terminalLines } from "@/lib/content";
import { cn } from "@/lib/cn";

const toneClass: Record<string, string> = {
  cmd: "text-ink",
  out: "text-muted",
  ok: "text-emerald-400",
};

type RenderedLine = { text: string; tone: string; done: boolean };

export function AnimatedTerminal() {
  const reduced = useReducedMotion();

  // Reduced motion: render the final state immediately.
  const finalState: RenderedLine[] = terminalLines.map((l) => ({
    text: l.text,
    tone: l.tone ?? "out",
    done: true,
  }));

  const [lines, setLines] = React.useState<RenderedLine[]>(
    reduced ? finalState : [],
  );
  const [typing, setTyping] = React.useState(!reduced);

  React.useEffect(() => {
    if (reduced) {
      setLines(finalState);
      setTyping(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let li = 0;
    let ci = 0;
    const acc: RenderedLine[] = [];

    const tick = () => {
      if (cancelled) return;
      if (li >= terminalLines.length) {
        setTyping(false);
        return;
      }
      const src = terminalLines[li];
      const tone = src.tone ?? "out";

      if (ci === 0) {
        acc.push({ text: "", tone, done: false });
      }
      ci += 1;
      acc[acc.length - 1] = {
        text: src.text.slice(0, ci),
        tone,
        done: ci >= src.text.length,
      };
      setLines([...acc]);

      if (ci >= src.text.length) {
        li += 1;
        ci = 0;
        timer = setTimeout(tick, 320);
      } else {
        // Output lines reveal faster than typed commands.
        const speed = tone === "cmd" ? 16 : 7;
        timer = setTimeout(tick, speed);
      }
    };

    timer = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <div className="gradient-border relative overflow-hidden rounded-2xl border border-hairline bg-[#080B11] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)]">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-hairline bg-white/[0.02] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#FF5F57]" aria-hidden />
        <span className="h-3 w-3 rounded-full bg-[#FEBC2E]" aria-hidden />
        <span className="h-3 w-3 rounded-full bg-[#28C840]" aria-hidden />
        <span className="ml-3 font-mono text-xs text-faint">
          ininfra — quickstart
        </span>
      </div>

      {/* Body */}
      <div className="min-h-[16rem] px-4 py-4 font-mono text-[0.78rem] leading-relaxed sm:text-[0.85rem]">
        <pre className="whitespace-pre-wrap break-words" aria-hidden={false}>
          {lines.map((l, i) => (
            <div key={i} className={cn(toneClass[l.tone])}>
              {l.text}
              {!reduced && typing && i === lines.length - 1 && !l.done ? (
                <span className="ml-px inline-block h-[1.05em] w-[0.5ch] translate-y-[0.18em] animate-caret-blink bg-brand-cyan align-middle" />
              ) : null}
            </div>
          ))}
          {/* trailing caret once typing is complete */}
          {!reduced && !typing ? (
            <div className="text-faint">
              ${" "}
              <span className="inline-block h-[1.05em] w-[0.5ch] translate-y-[0.18em] animate-caret-blink bg-brand-cyan align-middle" />
            </div>
          ) : null}
        </pre>
      </div>
    </div>
  );
}
