import type {
  BuildStatus,
  HealthStatus,
  PodPhase,
} from "@ininfra/shared-types";
import { buildMeta, cx, healthMeta, podPhaseMeta } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

/** Standalone status dot (optionally pulsing). */
export function Dot({ className }: { className: string }) {
  return (
    <span
      className={cx("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      aria-hidden
    />
  );
}

export function HealthBadge({ status }: { status: HealthStatus }) {
  const m = healthMeta[status];
  return (
    <Badge variant="outline" className={cx("gap-1.5 text-[11px] font-medium", m.bg, m.text)}>
      <Dot className={m.dot} />
      {m.label}
    </Badge>
  );
}

export function BuildBadge({ status }: { status: BuildStatus }) {
  const m = buildMeta[status];
  return (
    <Badge variant="outline" className={cx("gap-1.5 border-line bg-line-soft text-[11px] font-medium", m.text)}>
      <Dot className={m.dot} />
      {m.label}
    </Badge>
  );
}

export function PhaseBadge({ phase, ready }: { phase: PodPhase; ready: boolean }) {
  const m = podPhaseMeta[phase];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs", m.text)}>
      <Dot className={cx(m.dot, ready && "shadow-[0_0_6px]")} />
      {phase}
    </span>
  );
}
