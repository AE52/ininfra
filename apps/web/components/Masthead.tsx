"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, LogOut, Menu, Search } from "lucide-react";
import type { OverallStatus } from "@ininfra/shared-types";
import { api } from "@/lib/api";
import { cx } from "@/lib/format";
import { openPalette } from "@/lib/palette";
import { Logo, Wordmark } from "@/components/Brand";
import { useConfig } from "@/components/ConfigProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Masthead({
  onMenuToggle,
  navOpen,
}: {
  onMenuToggle: () => void;
  navOpen: boolean;
}) {
  const router = useRouter();
  const { productName, clusterName } = useConfig();
  const t = useT();
  const [user, setUser] = useState<string | null>(null);
  const [overall, setOverall] = useState<OverallStatus | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d?.username) setUser(d.username);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Poll overall status for the masthead indicator.
  useEffect(() => {
    let alive = true;
    const pull = () =>
      api
        .getStatus()
        .then((s) => {
          if (alive) setOverall(s.overall);
        })
        .catch(() => {});
    void pull();
    const id = setInterval(() => void pull(), 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center gap-3 bg-masthead pl-3 pr-3 text-white shadow-masthead sm:pr-5">
      {/* Hamburger — toggles the nav drawer (always visible, OpenShift-style). */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onMenuToggle}
        aria-label={t.masthead.toggleNav}
        aria-expanded={navOpen}
        className="h-10 w-10 rounded-pf text-white/80 hover:bg-white/10 hover:text-white [&_svg]:size-5"
      >
        <Menu />
      </Button>

      {/* Logo link kept as a plain Link so the inInfra logo SVG is not resized
          by the button's [&_svg]:size-4 rule. */}
      <Link href="/" className="flex items-center gap-2.5 rounded-pf px-1 transition-colors hover:bg-white/10">
        <Logo size={32} />
        {productName === "inInfra" ? (
          <Wordmark className="text-[18px] text-white" />
        ) : (
          <span className="font-display text-[18px] font-semibold tracking-tight text-white">
            {productName}
          </span>
        )}
      </Link>

      {/* Command-palette trigger — a faux search box that opens the palette. */}
      <button
        type="button"
        onClick={openPalette}
        aria-label={t.masthead.searchLabel}
        className="ml-auto flex items-center gap-2 rounded-pf border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs text-white/60 transition-colors hover:border-white/25 hover:text-white/85 sm:ml-3 sm:w-56 lg:w-72"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="hidden flex-1 text-left sm:inline">{t.masthead.search}</span>
        <kbd className="hidden rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] tracking-tight text-white/70 sm:inline">
          {t.masthead.searchShortcut}
        </kbd>
      </button>

      <div className="flex items-center gap-1 sm:gap-2">
        {/* Language toggle */}
        <LanguageToggle />

        {/* Global status indicator — links to the status page. */}
        <StatusChip overall={overall} />

        {/* Cluster / perspective pill. */}
        <div className="hidden items-center gap-2 rounded-pf border border-white/15 bg-white/5 px-3 py-1.5 text-xs sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-pf-green shadow-[0_0_6px] shadow-pf-green/70" />
          <span className="font-mono tracking-tight text-white/85">{clusterName}</span>
        </div>

        {/* User menu. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-pf px-2 py-1.5 text-sm transition-colors hover:bg-white/10 focus:outline-none"
              aria-label="User menu"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-pf-blue text-[11px] font-bold uppercase text-white">
                {(user ?? "?").slice(0, 2)}
              </span>
              <span className="hidden max-w-[140px] truncate text-white/90 sm:inline">
                {user ?? "—"}
              </span>
              <ChevronDown className="hidden h-4 w-4 text-white/60 sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 p-0 text-ink">
            <div className="border-b border-line px-3 py-2">
              <div className="text-[11px] uppercase tracking-wide text-ink-muted">{t.masthead.signedInAs}</div>
              <div className="truncate text-sm font-semibold">{user ?? "—"}</div>
            </div>
            <div className="p-1">
              <DropdownMenuItem
                onSelect={logout}
                className="gap-2 px-3 py-2 text-sm text-ink focus:bg-pf-red-50 focus:text-pf-red"
              >
                <LogOut className="h-4 w-4" />
                {t.masthead.logout}
              </DropdownMenuItem>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

const STATUS_CHIP_STYLE: Record<
  OverallStatus,
  { dot: string; ring: string; attention: boolean }
> = {
  operational: {
    dot: "bg-pf-green shadow-[0_0_6px] shadow-pf-green/70",
    ring: "border-white/15 bg-white/5 text-white/85",
    attention: false,
  },
  degraded: {
    dot: "bg-pf-gold shadow-[0_0_6px] shadow-pf-gold/80",
    ring: "border-pf-gold/40 bg-pf-gold/15 text-pf-gold",
    attention: true,
  },
  major_outage: {
    dot: "bg-pf-red shadow-[0_0_6px] shadow-pf-red/80",
    ring: "border-pf-red/40 bg-pf-red/15 text-[#ff8b82]",
    attention: true,
  },
};

function StatusChip({ overall }: { overall: OverallStatus | null }) {
  // Render a neutral placeholder until the first fetch resolves.
  const t = useT();
  const statusLabels: Record<OverallStatus, string> = {
    operational: t.status.statusOperational,
    degraded: t.status.statusDegraded,
    major_outage: t.status.majorOutage,
  };
  const meta = overall ? STATUS_CHIP_STYLE[overall] : null;
  const label = overall ? statusLabels[overall] : t.status.title;
  return (
    <Link
      href="/status"
      aria-label={`System status: ${label}`}
      className={cx(
        "hidden items-center gap-2 rounded-pf border px-3 py-1.5 text-xs transition-colors sm:flex",
        meta ? meta.ring : "border-white/15 bg-white/5 text-white/60",
        meta?.attention && "animate-pulse hover:animate-none",
        "hover:border-white/25",
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          meta ? meta.dot : "bg-ink-faint",
        )}
      />
      <span className="font-medium tracking-tight">
        {label}
      </span>
    </Link>
  );
}
