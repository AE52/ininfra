import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";

export function PageHeader({
  kicker,
  title,
  subtitle,
  actions,
}: {
  kicker?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        {kicker && <div className="label-kicker mb-1.5">{kicker}</div>}
        <h1 className="truncate font-display text-[26px] font-bold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

const accentText: Record<string, string> = {
  lime: "text-pf-green",
  amber: "text-[#8a6d00]",
  rose: "text-pf-red",
  sky: "text-pf-blue",
  slate: "text-ink",
};

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: "lime" | "amber" | "rose" | "sky" | "slate";
}) {
  return (
    <Card className="px-4 py-3.5">
      <div className="label-kicker">{label}</div>
      <div
        className={cx(
          "tabular mt-1 font-display text-3xl font-bold",
          accentText[accent ?? "slate"],
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </Card>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="text-sm font-semibold text-ink">{title}</div>
      {body && <div className="max-w-md text-sm text-ink-muted">{body}</div>}
    </Card>
  );
}

export function NamespaceTag({ ns }: { ns: string }) {
  return (
    <span className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
      {ns}
    </span>
  );
}

/** A horizontal usage meter (0..1). */
export function Meter({
  ratio,
  tone = "lime",
}: {
  ratio: number;
  tone?: "lime" | "amber" | "rose" | "sky";
}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const bar: Record<string, string> = {
    lime: "bg-pf-green",
    amber: "bg-pf-gold",
    rose: "bg-pf-red",
    sky: "bg-pf-blue",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      <div
        className={cx("h-full rounded-full transition-all", bar[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
