import { cx } from "@/lib/format";

/**
 * inInfra mark — a blue tile holding an isometric "layered stack" glyph
 * that reads as stacked infrastructure tiers. Scales cleanly from the
 * 24px nav badge to the 44px login card.
 */
export function Logo({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cx("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id="inInfraTile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0092DD" />
          <stop offset="1" stopColor="#0049A8" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#inInfraTile)" />
      {/* Three offset infrastructure tiers, top → bottom. */}
      <g
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M24 11 35 17 24 23 13 17 24 11Z" fill="#ffffff" fillOpacity="0.95" stroke="none" />
        <path d="M13 24 24 30 35 24" opacity="0.85" />
        <path d="M13 31 24 37 35 31" opacity="0.55" />
      </g>
    </svg>
  );
}

/**
 * Wordmark: "in" muted, "Infra" bold. Inherits color from context so it
 * works white-on-masthead and ink-on-light.
 */
export function Wordmark({
  className,
  muted = "text-white/55",
}: {
  className?: string;
  muted?: string;
}) {
  return (
    <span className={cx("font-display font-semibold tracking-tight", className)}>
      <span className={muted}>in</span>
      <span>Infra</span>
    </span>
  );
}

/** Logo + wordmark + cluster subtitle, used in masthead and login card. */
export function Brand({
  size = 34,
  subtitle,
  className,
}: {
  size?: number;
  subtitle?: string | null;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center gap-2.5", className)}>
      <Logo size={size} />
      <div className="leading-none">
        <Wordmark className="text-[17px] text-white" />
        {subtitle && (
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
