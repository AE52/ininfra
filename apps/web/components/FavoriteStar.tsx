"use client";

import { Star } from "lucide-react";
import type { SearchKind } from "@ininfra/shared-types";
import { cx } from "@/lib/format";
import { useFavorites } from "@/components/FavoritesProvider";

/**
 * A small star toggle. Filled pf-gold when the resource is favorited, an
 * outline otherwise. Stops propagation/preventDefault so it can live inside
 * clickable cards and links without triggering navigation.
 */
export function FavoriteStar({
  kind,
  namespace,
  name,
  href,
  className,
}: {
  kind: SearchKind | string;
  namespace?: string | null;
  name: string;
  href: string;
  className?: string;
}) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(kind, namespace, name);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void toggle({
      kind,
      namespace: namespace ?? undefined,
      name,
      href,
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      data-favorited={active ? "true" : "false"}
      aria-pressed={active}
      aria-label={active ? `Unstar ${name}` : `Star ${name}`}
      title={active ? "Remove from favorites" : "Add to favorites"}
      className={cx(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-pf transition-colors hover:bg-line-soft focus:outline-none focus-visible:ring-1 focus-visible:ring-pf-blue",
        className,
      )}
    >
      <Star
        className={cx(
          "h-4 w-4 transition-colors",
          active
            ? "fill-pf-gold text-pf-gold"
            : "text-ink-faint hover:text-ink-muted",
        )}
        strokeWidth={2}
      />
    </button>
  );
}
