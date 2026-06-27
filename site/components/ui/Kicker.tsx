import { cn } from "@/lib/cn";

export function Kicker({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[0.7rem] uppercase tracking-[0.18em] text-faint",
        className,
      )}
    >
      {children}
    </span>
  );
}
