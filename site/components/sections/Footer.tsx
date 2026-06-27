import { Github } from "lucide-react";
import { Wordmark } from "@/components/Wordmark";
import { footer, site } from "@/lib/content";

export function Footer() {
  return (
    <footer className="border-t border-hairline bg-base">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted">
              {footer.blurb}
            </p>
            <a
              href={site.repo}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-lg border border-hairline px-3 py-2 text-sm text-muted transition-colors hover:border-brand-blue/60 hover:text-ink"
            >
              <Github className="h-4 w-4" />
              github.com/AE52/ininfra
            </a>
          </div>

          {footer.columns.map((col) => (
            <div key={col.heading}>
              <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.16em] text-faint">
                {col.heading}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a
                      href={l.href}
                      target={l.href.startsWith("#") ? undefined : "_blank"}
                      rel={l.href.startsWith("#") ? undefined : "noreferrer"}
                      className="text-sm text-muted transition-colors hover:text-ink"
                    >
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-hairline pt-6 sm:flex-row sm:items-center">
          <span className="font-mono text-xs text-faint">
            {site.name} · Licensed under {site.license}
          </span>
          <span className="font-mono text-xs text-faint">
            Rust + Next.js · self-hostable
          </span>
        </div>
      </div>
    </footer>
  );
}
