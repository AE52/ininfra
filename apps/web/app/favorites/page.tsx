"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import type { Favorite, SearchKind } from "@ininfra/shared-types";
import { cx, timeAgo } from "@/lib/format";
import { KIND_ICON, KIND_LABEL, KIND_ORDER } from "@/lib/search-kind";
import { useFavorites } from "@/components/FavoritesProvider";
import { PageHeader, EmptyState } from "@/components/ui";
import { Card } from "@/components/ui/card";

/** Group favorites by kind in canonical order. */
function groupFavorites(
  favorites: Favorite[],
): Array<{ kind: string; items: Favorite[] }> {
  const byKind = new Map<string, Favorite[]>();
  for (const f of favorites) {
    const arr = byKind.get(f.kind);
    if (arr) arr.push(f);
    else byKind.set(f.kind, [f]);
  }
  const rank = (k: string) => {
    const i = KIND_ORDER.indexOf(k as SearchKind);
    return i === -1 ? 99 : i;
  };
  return Array.from(byKind.entries())
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([kind, items]) => ({
      kind,
      items: [...items].sort((x, y) => x.name.localeCompare(y.name)),
    }));
}

function kindLabel(kind: string): string {
  return KIND_LABEL[kind as SearchKind] ?? kind;
}

export default function FavoritesPage() {
  const { favorites, loading, toggle } = useFavorites();
  const groups = useMemo(() => groupFavorites(favorites), [favorites]);

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Home"
        title="Favorites"
        subtitle="Pinned resources — star anything across the console to keep it here."
      />

      {loading && favorites.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-faint">Loading…</Card>
      ) : favorites.length === 0 ? (
        <EmptyState
          title="No favorites yet"
          body="Star resources to pin them here."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const Icon = KIND_ICON[g.kind as SearchKind] ?? Star;
            return (
              <div key={g.kind}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="label-kicker">{kindLabel(g.kind)}</h3>
                  <span className="text-xs text-ink-faint">
                    {g.items.length} item{g.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <Card className="overflow-hidden">
                  {g.items.map((f, i) => (
                    <div
                      key={f.id}
                      className={cx(
                        "group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-line-soft",
                        i < g.items.length - 1 && "border-b border-line",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
                      <Link
                        href={f.href}
                        className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-ink group-hover:text-pf-blue"
                      >
                        {f.name}
                      </Link>
                      {f.namespace && (
                        <span className="hidden shrink-0 font-mono text-[11px] text-ink-faint sm:inline">
                          {f.namespace}
                        </span>
                      )}
                      <span
                        className="hidden shrink-0 text-[11px] text-ink-faint md:inline"
                        title={f.createdAt}
                      >
                        {timeAgo(f.createdAt)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void toggle({
                            kind: f.kind,
                            namespace: f.namespace || undefined,
                            name: f.name,
                            href: f.href,
                          })
                        }
                        aria-label={`Remove ${f.name} from favorites`}
                        title="Remove from favorites"
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pf transition-colors hover:bg-pf-gold-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-pf-blue"
                      >
                        <Star className="h-4 w-4 fill-pf-gold text-pf-gold" />
                      </button>
                    </div>
                  ))}
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
