"use client";

import { useLang } from "@/lib/i18n";

/**
 * A compact TR | EN toggle that sits in the masthead.
 * Styled to blend with the dark masthead bar.
 */
export function LanguageToggle() {
  const { lang, setLang } = useLang();

  return (
    <div
      className="hidden items-center gap-0 rounded-pf border border-white/15 bg-white/5 text-xs font-semibold sm:flex"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLang("tr")}
        aria-pressed={lang === "tr"}
        className={
          lang === "tr"
            ? "rounded-l-pf bg-white/20 px-2.5 py-1.5 text-white transition-colors"
            : "rounded-l-pf px-2.5 py-1.5 text-white/50 transition-colors hover:text-white/85"
        }
      >
        TR
      </button>
      <span className="h-4 w-px bg-white/15" aria-hidden />
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={
          lang === "en"
            ? "rounded-r-pf bg-white/20 px-2.5 py-1.5 text-white transition-colors"
            : "rounded-r-pf px-2.5 py-1.5 text-white/50 transition-colors hover:text-white/85"
        }
      >
        EN
      </button>
    </div>
  );
}
