import type {
  BuildStatus,
  CapacityType,
  HealthStatus,
  PodPhase,
} from "@ininfra/shared-types";

/** Join class names, dropping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Relative "3m ago" formatting for ISO timestamps. */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return "just now";
  const units: Array<[number, string]> = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
    [4.345, "w"],
    [12, "mo"],
    [Number.POSITIVE_INFINITY, "y"],
  ];
  let v = secs;
  let unit = "s";
  for (const [div, label] of units) {
    if (v < div) {
      unit = label;
      break;
    }
    v = Math.floor(v / div);
    unit = label;
  }
  return `${v}${unit} ago`;
}

/** Absolute, locale-independent timestamp for tooltips/detail. */
export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Strip the registry/path prefix off an image ref for compact display. */
export function shortImage(image: string): { name: string; tag: string } {
  const [path, tag = "latest"] = image.split(":");
  const name = path.split("/").pop() ?? path;
  return { name, tag };
}

/** Parse a k8s CPU quantity to a number of cores. Handles cores ("2"),
 *  millicores ("500m"), microcores ("1500u") and nanocores ("717122166n") —
 *  metrics-server reports node usage in nanocores. */
export function cpuToCores(q: string | null): number {
  if (!q) return 0;
  if (q.endsWith("n")) return parseInt(q, 10) / 1e9;
  if (q.endsWith("u")) return parseInt(q, 10) / 1e6;
  if (q.endsWith("m")) return parseInt(q, 10) / 1000;
  const n = parseFloat(q);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a k8s memory quantity ("128Mi", "2Gi", "1000000Ki") to bytes. */
export function memToBytes(q: string | null): number {
  if (!q) return 0;
  const m = q.match(/^(\d+(?:\.\d+)?)([A-Za-z]*)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2];
  const factors: Record<string, number> = {
    "": 1,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    k: 1e3,
  };
  return n * (factors[unit] ?? 1);
}

export function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0";
  const units = ["B", "Ki", "Mi", "Gi", "Ti"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)}${units[i]}`;
}

/* ---- status → visual token maps ---- */

export const healthMeta: Record<
  HealthStatus,
  { label: string; dot: string; text: string; bg: string }
> = {
  healthy: {
    label: "Healthy",
    dot: "bg-pf-green",
    text: "text-pf-green",
    bg: "bg-pf-green-50 border-pf-green/30",
  },
  progressing: {
    label: "Progressing",
    dot: "bg-pf-blue animate-pulse",
    text: "text-pf-blue",
    bg: "bg-pf-blue-50 border-pf-blue/30",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-pf-red",
    text: "text-pf-red",
    bg: "bg-pf-red-50 border-pf-red/30",
  },
  unknown: {
    label: "Unknown",
    dot: "bg-ink-faint",
    text: "text-ink-muted",
    bg: "bg-line-soft border-line",
  },
};

export const buildMeta: Record<
  BuildStatus,
  { label: string; dot: string; text: string }
> = {
  queued: { label: "Queued", dot: "bg-ink-faint", text: "text-ink-muted" },
  running: {
    label: "Running",
    dot: "bg-pf-blue animate-pulse",
    text: "text-pf-blue",
  },
  success: { label: "Success", dot: "bg-pf-green", text: "text-pf-green" },
  failure: { label: "Failure", dot: "bg-pf-red", text: "text-pf-red" },
  aborted: { label: "Aborted", dot: "bg-pf-gold", text: "text-[#8a6d00]" },
  unknown: { label: "Unknown", dot: "bg-ink-faint", text: "text-ink-muted" },
};

export const capacityTypeMeta: Record<
  CapacityType,
  { label: string; text: string; bg: string; dot: string }
> = {
  spot: {
    label: "Spot",
    text: "text-pf-blue",
    bg: "bg-pf-blue-50 border-pf-blue/30",
    dot: "bg-pf-blue",
  },
  "on-demand": {
    label: "On-demand",
    text: "text-pf-green",
    bg: "bg-pf-green-50 border-pf-green/30",
    dot: "bg-pf-green",
  },
  unknown: {
    label: "Unknown",
    text: "text-ink-muted",
    bg: "bg-line-soft border-line",
    dot: "bg-ink-faint",
  },
};

export const podPhaseMeta: Record<PodPhase, { dot: string; text: string }> = {
  Running: { dot: "bg-pf-green", text: "text-pf-green" },
  Pending: { dot: "bg-pf-gold animate-pulse", text: "text-[#8a6d00]" },
  Succeeded: { dot: "bg-pf-blue", text: "text-pf-blue" },
  Failed: { dot: "bg-pf-red", text: "text-pf-red" },
  Unknown: { dot: "bg-ink-faint", text: "text-ink-muted" },
};
