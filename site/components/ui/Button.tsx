import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white font-medium shadow-[0_8px_30px_-12px_rgba(124,92,255,0.6)] hover:shadow-[0_10px_40px_-10px_rgba(59,130,246,0.55)] hover:brightness-110",
  secondary:
    "bg-panel text-ink border border-hairline hover:border-brand-blue/60 hover:bg-white/[0.03]",
  ghost: "text-muted hover:text-ink hover:bg-white/[0.04]",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-lg",
  md: "h-11 px-5 text-sm rounded-xl",
  lg: "h-12 px-6 text-[0.95rem] rounded-xl",
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: React.ReactNode;
};

const baseCls =
  "inline-flex items-center justify-center gap-2 font-medium tracking-tight transition-all duration-200 will-change-transform active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none";

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: CommonProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(baseCls, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: CommonProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn(baseCls, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </a>
  );
}
