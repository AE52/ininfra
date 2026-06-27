"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Hammer } from "lucide-react";
import type { BuildJob } from "@ininfra/shared-types";
import { api } from "@/lib/api";

/**
 * Floating bottom-right indicator showing how many CI/CD builds are currently
 * running. Polls the builds endpoint; hidden when nothing is in flight. Clicking
 * it opens the builds page.
 */
export function ActiveBuildIndicator() {
  const pathname = usePathname();
  // The login and setup pages are public (no session). Polling the auth-gated
  // builds API there 401s, and the API client turns a 401 into
  // window.location="/login" — which would loop. Don't run on those routes.
  const disabled = pathname === "/login" || pathname === "/setup";
  const [active, setActive] = useState<BuildJob[]>([]);

  useEffect(() => {
    if (disabled) return;
    let alive = true;
    const poll = async () => {
      try {
        const page = await api.listBuilds({ limit: 50 });
        if (!alive) return;
        setActive(
          page.items.filter((b) => b.status === "running" || b.status === "queued"),
        );
      } catch {
        // Stay quiet on transient errors; next tick retries.
        if (alive) setActive([]);
      }
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [disabled]);

  if (disabled || active.length === 0) return null;

  const one = active.length === 1 ? active[0] : null;

  return (
    <Link
      href="/builds"
      className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-full border border-pf-blue/40 bg-canvas/95 px-4 py-2.5 shadow-lg backdrop-blur transition-colors hover:border-pf-blue"
      aria-label={`${active.length} build running`}
    >
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-pf-blue opacity-70" />
        <span className="relative inline-flex size-2.5 rounded-full bg-pf-blue" />
      </span>
      <Hammer className="size-4 text-pf-blue" />
      <span className="text-sm font-medium text-ink">
        {one
          ? `Building ${one.job.split("/").at(-1)}`
          : `${active.length} builds running`}
      </span>
    </Link>
  );
}
