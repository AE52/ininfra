"use client";

import * as React from "react";
import { Github, Menu, X } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { ButtonLink } from "@/components/ui/Button";
import { nav, site } from "@/lib/content";

export function Nav() {
  const [scrolled, setScrolled] = React.useState(false);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
        scrolled
          ? "border-hairline bg-base/80 backdrop-blur-xl"
          : "border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <a href="#top" aria-label="inInfra home" className="rounded-md">
          <Wordmark />
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {nav.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:text-ink"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink
            href={site.repo}
            target="_blank"
            rel="noreferrer"
            variant="secondary"
            size="sm"
          >
            <Github className="h-4 w-4" />
            GitHub
          </ButtonLink>
        </div>

        <button
          type="button"
          className="rounded-lg p-2 text-muted hover:text-ink md:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open ? (
        <div className="border-t border-hairline bg-base/95 backdrop-blur-xl md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-4">
            {nav.links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-white/[0.04] hover:text-ink"
              >
                {l.label}
              </a>
            ))}
            <ButtonLink
              href={site.repo}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
              size="md"
              className="mt-2 w-full"
            >
              <Github className="h-4 w-4" />
              View on GitHub
            </ButtonLink>
          </div>
        </div>
      ) : null}
    </header>
  );
}
