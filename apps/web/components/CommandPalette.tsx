"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Star } from "lucide-react";
import type { SearchResult } from "@ininfra/shared-types";
import { api } from "@/lib/api";
import { cx } from "@/lib/format";
import { KIND_ICON, KIND_LABEL, KIND_ORDER, statusTone } from "@/lib/search-kind";
import { onOpenPalette } from "@/lib/palette";
import { FavoriteStar } from "@/components/FavoriteStar";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const DEBOUNCE_MS = 200;

/** Group results by kind in the canonical order, dropping empty groups. */
function groupResults(
  results: SearchResult[],
): Array<{ kind: SearchResult["kind"]; items: SearchResult[] }> {
  const byKind = new Map<SearchResult["kind"], SearchResult[]>();
  for (const r of results) {
    const arr = byKind.get(r.kind);
    if (arr) arr.push(r);
    else byKind.set(r.kind, [r]);
  }
  return KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => ({
    kind,
    items: byKind.get(kind) as SearchResult[],
  }));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);

  // Open via the global emitter (e.g. the Masthead pill).
  useEffect(() => onOpenPalette(() => setOpen(true)), []);

  // Global Cmd/Ctrl+K listener.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Reset transient state whenever the palette closes.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setHighlight(0);
      setLoading(false);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      api
        .search(q)
        .then((res) => {
          setResults(res);
          setHighlight(0);
        })
        .catch(() => {
          setResults([]);
        })
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const groups = useMemo(() => groupResults(results), [results]);

  // Flat list mirrors visual order so keyboard nav lines up with rendering.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (flat.length === 0 ? 0 : (h + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) =>
        flat.length === 0 ? 0 : (h - 1 + flat.length) % flat.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = flat[highlight];
      if (sel) go(sel.href);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const hasQuery = query.trim().length > 0;
  let runningIndex = -1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="top-[12%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden"
        onKeyDown={onKeyDown}
      >
        {/* Radix requires a labelled dialog; keep it visually hidden. */}
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search deployments, pods, services, and nodes across the cluster.
        </DialogDescription>

        {/* Search input row. */}
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deployments, pods, services, nodes…"
            className="h-12 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            aria-label="Search"
          />
          {loading && (
            <span className="shrink-0 text-[11px] text-ink-faint">…</span>
          )}
        </div>

        {/* Results / hints. */}
        <div className="max-h-[52vh] overflow-y-auto py-1.5">
          {!hasQuery ? (
            <div className="px-4 py-6 text-sm">
              <p className="text-ink-muted">Search across the cluster.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/search"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1.5 rounded-pf border border-line bg-line-soft px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-pf-blue/40 hover:text-pf-blue"
                >
                  <Search className="h-3.5 w-3.5" /> Advanced search
                </Link>
                <Link
                  href="/favorites"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1.5 rounded-pf border border-line bg-line-soft px-2.5 py-1 text-xs text-ink-soft transition-colors hover:border-pf-blue/40 hover:text-pf-blue"
                >
                  <Star className="h-3.5 w-3.5" /> Favorites
                </Link>
              </div>
            </div>
          ) : flat.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-faint">
              {loading ? "Searching…" : `No results for "${query.trim()}"`}
            </div>
          ) : (
            groups.map((g) => {
              const Icon = KIND_ICON[g.kind];
              return (
                <div key={g.kind} className="mb-1 last:mb-0">
                  <div className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    {KIND_LABEL[g.kind]}
                  </div>
                  {g.items.map((r) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const active = idx === highlight;
                    const tone = statusTone(r.status);
                    return (
                      <div
                        key={`${r.kind}/${r.namespace ?? ""}/${r.name}`}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setHighlight(idx)}
                        onClick={() => go(r.href)}
                        className={cx(
                          "group mx-1.5 flex cursor-pointer items-center gap-3 rounded-pf px-2.5 py-2 transition-colors",
                          active ? "bg-pf-blue-50" : "hover:bg-line-soft",
                        )}
                      >
                        <Icon
                          className={cx(
                            "h-4 w-4 shrink-0",
                            active ? "text-pf-blue" : "text-ink-faint",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                          {r.name}
                        </span>
                        {r.namespace && (
                          <span className="hidden shrink-0 font-mono text-[11px] text-ink-faint sm:inline">
                            {r.namespace}
                          </span>
                        )}
                        {r.status && (
                          <span
                            className={cx(
                              "hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:inline",
                              tone.bg,
                              tone.text,
                            )}
                          >
                            {r.status}
                          </span>
                        )}
                        <FavoriteStar
                          kind={r.kind}
                          namespace={r.namespace}
                          name={r.name}
                          href={r.href}
                          className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint. */}
        <div className="flex items-center justify-between border-t border-line px-4 py-2 text-[11px] text-ink-faint">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="font-mono">⌘K</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
