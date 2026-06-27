"use client";

import { useState } from "react";
import { Check, Copy, FileCode } from "lucide-react";
import type { Namespace } from "@ininfra/shared-types";
import { api, ApiClientError, type ManifestKind } from "@/lib/api";
import { cx } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Read-only "View YAML" affordance: a button that opens a modal showing the
 * live object's sanitized manifest (server strips managedFields + the kubectl
 * last-applied annotation) in a monospace scrollable well, with copy-to-
 * clipboard. Fetches lazily the first time it's opened.
 *
 * Reusable across workloads and pods — pass `kind`/`ns`/`name`. The trigger can
 * render as a full button (`compact={false}`, default) for the workload header
 * or a small inline link (`compact`) for a pod row.
 */
export function ManifestViewer({
  kind,
  ns,
  name,
  compact = false,
}: {
  kind: ManifestKind;
  ns: Namespace;
  name: string;
  /** Render the trigger as a small inline link rather than a full button. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getManifest(kind, ns, name);
      setYaml(res.yaml);
    } catch (e) {
      setError(e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setLoading(false);
    }
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    setCopied(false);
    // Fetch the first time it's opened (and re-fetch if a prior load failed).
    if (next && (yaml === null || error)) {
      void load();
    }
  }

  async function copy() {
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable (insecure context) — silently ignore */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {compact ? (
          <button
            type="button"
            className="text-xs text-ink-faint hover:text-pf-blue"
          >
            yaml
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <FileCode className="size-3.5" />
            View YAML
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl gap-3 border-line bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileCode className="size-4 text-ink-faint" />
            <span className="font-mono">
              {kind}/{name}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Read-only manifest from the live cluster ({ns}). Server-managed
            fields and the kubectl last-applied annotation are stripped.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          {yaml !== null && !loading && (
            <button
              type="button"
              onClick={copy}
              className={cx(
                "absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium backdrop-blur transition-colors",
                copied
                  ? "border-pf-green/40 bg-pf-green/10 text-pf-green"
                  : "border-white/15 bg-black/40 text-[#d6d6d6] hover:bg-black/60 hover:text-white",
              )}
              aria-label="Copy YAML to clipboard"
            >
              {copied ? (
                <>
                  <Check className="size-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" /> Copy
                </>
              )}
            </button>
          )}

          {loading && (
            <div className="flex h-40 items-center justify-center rounded-md bg-[#1b1d21] text-sm text-[#9a9a9a]">
              Loading manifest…
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-pf-red/30 bg-pf-red-50 px-4 py-3 text-sm text-pf-red">
              Could not load manifest: {error}
            </div>
          )}

          {yaml !== null && !loading && !error && (
            <pre className="max-h-[65vh] overflow-auto rounded-md bg-[#1b1d21] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#f0f0f0]">
              {yaml}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
