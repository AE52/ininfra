"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useConfig } from "@/components/ConfigProvider";
import { useT } from "@/lib/i18n";
import { cx } from "@/lib/format";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  match: (p: string) => boolean;
  /** When true, only render for admin or super_admin. */
  adminOnly?: boolean;
  /** When true, only render for super_admin. */
  superAdminOnly?: boolean;
  /** When set, only render if the named feature flag is enabled. */
  feature?: "gateway" | "jenkins";
};
type NavGroup = { title: string; items: NavItem[] };

function buildNav(t: ReturnType<typeof useT>): NavGroup[] {
  return [
    {
      title: t.nav.home,
      items: [
        { href: "/", label: t.nav.overview, match: (p) => p === "/", icon: "M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7v-9h-7v9Zm0-16v5h7V4h-7Z" },
        { href: "/search", label: t.nav.search, match: (p) => p.startsWith("/search"), icon: "m21 21-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" },
        { href: "/favorites", label: t.nav.favorites, match: (p) => p.startsWith("/favorites"), icon: "M12 17.3 6.18 21l1.64-7.03L2.5 9.24l7.19-.61L12 2l2.31 6.63 7.19.61-5.32 4.73L17.82 21 12 17.3Z" },
        { href: "/status", label: t.nav.status, match: (p) => p.startsWith("/status"), icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
        { href: "/events", label: t.nav.events, match: (p) => p.startsWith("/events"), icon: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
      ],
    },
    {
      title: t.nav.workloads,
      items: [
        { href: "/services", label: t.nav.services, match: (p) => p === "/services" || p.startsWith("/services/"), icon: "M3 7h18M3 12h18M3 17h18M7 4v3m10 10v3" },
        { href: "/stateful", label: t.nav.stateful, match: (p) => p.startsWith("/stateful"), icon: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" },
        { href: "/jobs", label: t.nav.jobs, match: (p) => p.startsWith("/jobs"), icon: "M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
        { href: "/hpa", label: t.nav.autoscaling, match: (p) => p.startsWith("/hpa"), icon: "M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" },
        { href: "/gateway", label: t.nav.gateway, match: (p) => p.startsWith("/gateway"), feature: "gateway", icon: "M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18M3 12h18M4.6 7h14.8M4.6 17h14.8M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" },
      ],
    },
    {
      title: t.nav.builds,
      items: [
        { href: "/builds", label: t.nav.builds, match: (p) => p.startsWith("/builds"), feature: "jenkins", icon: "M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" },
        { href: "/branches", label: t.nav.branches, match: (p) => p.startsWith("/branches"), feature: "jenkins", icon: "M6 3v12m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12-6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-3 3v2a4 4 0 0 1-4 4H6" },
      ],
    },
    {
      title: t.nav.storage,
      items: [
        { href: "/storage", label: t.nav.storage, match: (p) => p.startsWith("/storage"), icon: "M4 6h16v4H4zM4 14h16v4H4zM7 8h.01M7 16h.01" },
        { href: "/secrets", label: t.nav.secrets, match: (p) => p.startsWith("/secrets"), icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Zm0-7a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 0v3" },
      ],
    },
    {
      title: t.nav.compute,
      items: [
        { href: "/nodes", label: t.nav.nodes, match: (p) => p.startsWith("/nodes"), icon: "M5 4h14v6H5zM5 14h14v6H5zM8 7h.01M8 17h.01" },
        { href: "/rightsizing", label: t.nav.rightsizing, match: (p) => p.startsWith("/rightsizing"), icon: "M3 12h4l3 8 4-16 3 8h4" },
      ],
    },
    {
      title: t.nav.administration,
      items: [
        { href: "/audit", label: t.nav.auditLog, match: (p) => p.startsWith("/audit"), icon: "M9 5h6m-7 4h8m-8 4h8m-9 4h10M5 5v14" },
        { href: "/users", label: t.nav.users, match: (p) => p.startsWith("/users"), adminOnly: true, icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
        { href: "/administration/rbac", label: t.nav.rbac, match: (p) => p.startsWith("/administration/rbac"), superAdminOnly: true, icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" },
        { href: "/errors", label: t.nav.errors, match: (p) => p.startsWith("/errors"), adminOnly: true, icon: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
      ],
    },
  ];
}

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname() ?? "/";
  const { productName, features } = useConfig();
  const t = useT();
  const NAV = buildNav(t);
  const [userRole, setUserRole] = useState<string | null>(null);

  // Resolve role once so admin-only nav items can be gated client-side.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((me) => {
        if (alive) setUserRole(me.role);
      })
      .catch(() => {
        /* unauthenticated / error → treat as non-admin, hide admin items */
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      {/* Mobile drawer backdrop. */}
      <div
        className={cx(
          "fixed inset-0 top-[60px] z-30 bg-black/50 transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={cx(
          "fixed top-[60px] z-30 h-[calc(100vh-60px)] w-64 shrink-0 overflow-y-auto bg-nav transition-transform duration-200 lg:sticky lg:top-[60px] lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <nav className="py-3">
          {NAV.map((group) => {
            const items = group.items.filter(
              (i) =>
                (!i.adminOnly || userRole === "admin" || userRole === "super_admin") &&
                (!i.superAdminOnly || userRole === "super_admin") &&
                (!i.feature || features[i.feature]),
            );
            if (items.length === 0) return null;
            return (
            <div key={group.title} className="mb-1 px-3 pb-1.5 pt-2">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8a8d90]">
                {group.title}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cx(
                        "group relative flex items-center gap-3 rounded-pf py-2 pl-4 pr-3 text-sm transition-colors",
                        active
                          ? "bg-nav-active font-medium text-white"
                          : "text-[#d2d2d2] hover:bg-nav-hover hover:text-white",
                      )}
                    >
                      <span
                        className={cx(
                          "absolute inset-y-0 left-0 w-[3px] rounded-r bg-pf-blue transition-opacity",
                          active ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className={active ? "text-white" : "text-[#8a8d90] group-hover:text-[#d2d2d2]"}>
                        <Icon path={item.icon} />
                      </span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            );
          })}
        </nav>

        <div className="mt-2 border-t border-nav-border px-6 py-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-[#8a8d90]">
            <span className="h-1.5 w-1.5 rounded-full bg-pf-green shadow-[0_0_6px] shadow-pf-green/60" />
            {productName}
          </div>
        </div>
      </aside>
    </>
  );
}
