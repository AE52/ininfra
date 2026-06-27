"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Favorite, NewFavorite } from "@ininfra/shared-types";
import { api } from "@/lib/api";

interface FavoritesContextValue {
  favorites: Favorite[];
  /** Is the given resource currently favorited? */
  isFavorite: (kind: string, namespace: string | null | undefined, name: string) => boolean;
  /** Optimistically add/remove the favorite, syncing with the API. */
  toggle: (fav: NewFavorite) => Promise<void>;
  loading: boolean;
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/** Normalize a namespace for comparison — `null`/`undefined`/"" are equivalent. */
function nsKey(ns: string | null | undefined): string {
  return ns ?? "";
}

/**
 * Loads the per-user favorites on mount and exposes optimistic add/remove.
 * Mounted inside Shell so it only wraps authenticated pages (never /login),
 * avoiding a 401 on the public login screen.
 */
export function FavoritesProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .listFavorites()
      .then((list) => {
        if (alive) setFavorites(list);
      })
      .catch(() => {
        /* tolerate errors → empty list */
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const isFavorite = useCallback(
    (kind: string, namespace: string | null | undefined, name: string) =>
      favorites.some(
        (f) =>
          f.kind === kind &&
          nsKey(f.namespace) === nsKey(namespace) &&
          f.name === name,
      ),
    [favorites],
  );

  const toggle = useCallback(
    async (fav: NewFavorite) => {
      const exists = favorites.find(
        (f) =>
          f.kind === fav.kind &&
          nsKey(f.namespace) === nsKey(fav.namespace) &&
          f.name === fav.name,
      );

      if (exists) {
        // Optimistic remove.
        setFavorites((prev) => prev.filter((f) => f.id !== exists.id));
        try {
          await api.removeFavorite({
            kind: fav.kind,
            namespace: fav.namespace,
            name: fav.name,
          });
        } catch {
          // Rollback on failure.
          setFavorites((prev) =>
            prev.some((f) => f.id === exists.id) ? prev : [...prev, exists],
          );
        }
      } else {
        // Optimistic add with a temporary record.
        const tempId = `tmp-${Date.now()}`;
        const optimistic: Favorite = {
          id: tempId,
          kind: fav.kind,
          namespace: fav.namespace ?? "",
          name: fav.name,
          href: fav.href,
          createdAt: new Date().toISOString(),
        };
        setFavorites((prev) => [...prev, optimistic]);
        try {
          const created = await api.addFavorite(fav);
          setFavorites((prev) =>
            prev.map((f) => (f.id === tempId ? created : f)),
          );
        } catch {
          // Rollback on failure.
          setFavorites((prev) => prev.filter((f) => f.id !== tempId));
        }
      }
    },
    [favorites],
  );

  const value = useMemo<FavoritesContextValue>(
    () => ({ favorites, isFavorite, toggle, loading }),
    [favorites, isFavorite, toggle, loading],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

/** Access the favorites store. Must be used under a `<FavoritesProvider>`. */
export function useFavorites(): FavoritesContextValue {
  const ctx = useContext(FavoritesContext);
  if (ctx === null) {
    throw new Error("useFavorites must be used within a <FavoritesProvider>");
  }
  return ctx;
}
