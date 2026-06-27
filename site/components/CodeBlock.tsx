"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard may be unavailable; fail silently
    }
  }, [code]);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-hairline bg-[#080B11]",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-hairline bg-white/[0.02] px-4 py-2.5">
        <span className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-faint">
          {label ?? "bash"}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy code to clipboard"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[0.7rem] text-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[0.78rem] leading-relaxed text-ink/90 sm:text-[0.82rem]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
