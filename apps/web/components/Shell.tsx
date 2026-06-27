"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Masthead } from "@/components/Masthead";
import { Sidebar } from "@/components/Sidebar";
import { CommandPalette } from "@/components/CommandPalette";
import { FavoritesProvider } from "@/components/FavoritesProvider";
import { api } from "@/lib/api";
import { isPublicRoute } from "@/lib/routes";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Best-effort client error reporter: forward uncaught JS errors and
  // unhandled promise rejections to the API's Sentry-style error feed.
  // Never throws, never reports from /login, and guards against loops.
  useEffect(() => {
    let last = "";
    let lastAt = 0;

    function report(message: string, code: string, detail: Record<string, unknown>) {
      try {
        const msg = message.trim();
        if (!msg) return;
        if (typeof location !== "undefined" && isPublicRoute(location.pathname)) {
          return;
        }
        const now = Date.now();
        // Dedupe identical messages fired in a tight burst (loop guard).
        if (msg === last && now - lastAt < 2000) return;
        last = msg;
        lastAt = now;
        const path =
          typeof location !== "undefined" ? location.pathname : undefined;
        void Promise.resolve(
          api.reportError({ message: msg, code, path, detail }),
        ).catch(() => {
          /* swallow — reporting must never surface or throw */
        });
      } catch {
        /* never let the reporter break the app */
      }
    }

    function onError(ev: ErrorEvent) {
      const detail: Record<string, unknown> = {
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      };
      if (ev.error instanceof Error && ev.error.stack) {
        detail.stack = ev.error.stack;
      }
      report(ev.message ?? "", "window.error", detail);
    }

    function onRejection(ev: PromiseRejectionEvent) {
      const reason: unknown = ev.reason;
      let message = "";
      const detail: Record<string, unknown> = {};
      if (reason instanceof Error) {
        message = reason.message;
        if (reason.stack) detail.stack = reason.stack;
      } else if (typeof reason === "string") {
        message = reason;
      } else {
        try {
          message = JSON.stringify(reason);
        } catch {
          message = String(reason);
        }
      }
      report(message, "unhandledrejection", detail);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Public pages (login, setup) render bare, without the console chrome.
  if (isPublicRoute(pathname)) return <>{children}</>;

  return (
    <FavoritesProvider>
      <div className="flex min-h-screen flex-col">
        <Masthead onMenuToggle={() => setNavOpen((v) => !v)} navOpen={navOpen} />
        <div className="flex min-h-0 flex-1">
          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
          <main className="min-w-0 flex-1">
            <div className="mx-auto max-w-[1400px] px-5 py-6 sm:px-7 lg:px-9 lg:py-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <CommandPalette />
    </FavoritesProvider>
  );
}
