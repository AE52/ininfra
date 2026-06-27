import { cn } from "@/lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-display text-[1.15rem] font-semibold tracking-tight text-ink",
        className,
      )}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 22 22"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <defs>
          <linearGradient id="wm" x1="0" y1="0" x2="22" y2="22">
            <stop stopColor="#7C5CFF" />
            <stop offset="0.5" stopColor="#3B82F6" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <rect
          x="1.25"
          y="1.25"
          width="19.5"
          height="19.5"
          rx="5.5"
          stroke="url(#wm)"
          strokeWidth="1.5"
        />
        <path
          d="M6.2 13.4l3.1-4.8 2.5 3 2.9-4.4"
          stroke="url(#wm)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>
        in<span className="text-gradient">Infra</span>
      </span>
    </span>
  );
}
