import {
  Box,
  Boxes,
  Container,
  Database,
  Hammer,
  Layers,
  Server,
  User,
  type LucideIcon,
} from "lucide-react";
import type { SearchKind } from "@ininfra/shared-types";

/** Per-kind lucide icon. */
export const KIND_ICON: Record<SearchKind, LucideIcon> = {
  deployment: Boxes,
  service: Box,
  statefulset: Database,
  pod: Container,
  namespace: Layers,
  node: Server,
  build: Hammer,
  user: User,
};

/** Human label for a kind (for group headings / filters). */
export const KIND_LABEL: Record<SearchKind, string> = {
  deployment: "Deployments",
  service: "Services",
  statefulset: "StatefulSets",
  pod: "Pods",
  namespace: "Namespaces",
  node: "Nodes",
  build: "Builds",
  user: "Users",
};

/** Stable display order for grouped results. */
export const KIND_ORDER: SearchKind[] = [
  "deployment",
  "statefulset",
  "service",
  "pod",
  "build",
  "node",
  "namespace",
  "user",
];

export const ALL_KINDS: SearchKind[] = KIND_ORDER;

/**
 * Map a free-form status string to a PatternFly badge tone.
 * healthy/Running → green, degraded/Failed → red, progressing/Pending → gold,
 * everything else → muted.
 */
export function statusTone(
  status: string | null,
): { text: string; bg: string; dot: string } {
  const s = (status ?? "").toLowerCase();
  if (/(healthy|running|success|operational|active|ready|bound)/.test(s)) {
    return { text: "text-pf-green", bg: "bg-pf-green-50 border-pf-green/30", dot: "bg-pf-green" };
  }
  if (/(degraded|failed|failure|error|crashloop|outage|down)/.test(s)) {
    return { text: "text-pf-red", bg: "bg-pf-red-50 border-pf-red/30", dot: "bg-pf-red" };
  }
  if (/(progressing|pending|queued|running\b|updating|provisioning)/.test(s)) {
    return { text: "text-[#8a6d00]", bg: "bg-pf-gold-50 border-pf-gold/40", dot: "bg-pf-gold" };
  }
  return { text: "text-ink-muted", bg: "bg-line-soft border-line", dot: "bg-ink-faint" };
}
