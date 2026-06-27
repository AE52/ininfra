"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Namespace, PodLog, PodSummary } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { cx, fmtTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Download,
  BarChart3,
  Copy as CopyIcon,
} from "lucide-react";

const MAX_LINES = 2000;

type ConnState = "idle" | "connecting" | "live" | "error" | "closed";

// ---------------------------------------------------------------------------
// Pod-label colour palette (multi-pod mode)
// ---------------------------------------------------------------------------

/** Small, distinct palette for per-pod label chips. Deterministic by name. */
const POD_LABEL_COLORS = [
  "text-pf-blue",
  "text-pf-green",
  "text-pf-gold",
  "text-pf-purple",
  "text-pf-cyan",
  "text-pf-red",
] as const;

/** Deterministically map a pod name to a palette colour class. */
function podLabelColor(pod: string): string {
  let h = 0;
  for (let i = 0; i < pod.length; i++) {
    h = (h * 31 + pod.charCodeAt(i)) | 0;
  }
  return POD_LABEL_COLORS[Math.abs(h) % POD_LABEL_COLORS.length];
}

/** Short, stable display label for a pod (trailing replica hash/suffix). */
function podShortLabel(pod: string): string {
  const parts = pod.split("-");
  if (parts.length >= 2) {
    return parts.slice(-2).join("-");
  }
  return pod;
}

// ---------------------------------------------------------------------------
// Time-range presets
// ---------------------------------------------------------------------------

const TIME_WINDOWS = [
  { labelKey: "last5m",  value: "5m"  },
  { labelKey: "last15m", value: "15m" },
  { labelKey: "last1h",  value: "1h"  },
  { labelKey: "last6h",  value: "6h"  },
  { labelKey: "last24h", value: "24h" },
  { labelKey: "last3d",  value: "3d"  },
  { labelKey: "last7d",  value: "7d"  },
] as const;

type SinceValue = (typeof TIME_WINDOWS)[number]["value"];

/** Special sentinel that means "use custom from/to". */
const CUSTOM = "__custom__" as const;
type TimespanSelection = SinceValue | typeof CUSTOM;

// ---------------------------------------------------------------------------
// Match-highlight helper
// ---------------------------------------------------------------------------

/** Split `text` into alternating non-match / match segments.  When `pattern`
 *  is empty or the regex is invalid the whole text is returned as a single
 *  non-match segment. */
function splitByMatch(
  text: string,
  pattern: string,
  isRegex: boolean,
): Array<{ text: string; match: boolean }> {
  if (!pattern) return [{ text, match: false }];
  try {
    const flags = "gi";
    const re = isRegex
      ? new RegExp(pattern, flags)
      : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

    const segments: Array<{ text: string; match: boolean }> = [];
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      if (m.index > last) {
        segments.push({ text: text.slice(last, m.index), match: false });
      }
      segments.push({ text: m[0], match: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) {
      segments.push({ text: text.slice(last), match: false });
    }
    return segments.length ? segments : [{ text, match: false }];
  } catch {
    return [{ text, match: false }];
  }
}

// ---------------------------------------------------------------------------
// Log-level detection + palette
// ---------------------------------------------------------------------------

type LogLevel = "error" | "warn" | "info" | "debug" | "other";

const LEVEL_ORDER: LogLevel[] = ["error", "warn", "info", "debug", "other"];

/** Detect a coarse log level from a message, case-insensitively. Checked in a
 *  fixed precedence: error → warn → info → debug → other. */
function detectLevel(message: string): LogLevel {
  if (/error|err\b|fatal|panic|exception|fail/i.test(message)) return "error";
  if (/warn|warning/i.test(message)) return "warn";
  if (/info|notice/i.test(message)) return "info";
  if (/debug|trace|verbose/i.test(message)) return "debug";
  return "other";
}

/** Per-level visual tokens. `bar` is a solid background (bars / dots), `text`
 *  the foreground colour for chip labels. */
const LEVEL_META: Record<
  LogLevel,
  { bar: string; text: string; labelKey: string }
> = {
  error: { bar: "bg-pf-red",    text: "text-pf-red",    labelKey: "levelError" },
  warn:  { bar: "bg-pf-gold",   text: "text-pf-gold",   labelKey: "levelWarn" },
  info:  { bar: "bg-pf-blue",   text: "text-pf-blue",   labelKey: "levelInfo" },
  debug: { bar: "bg-pf-cyan",   text: "text-pf-cyan",   labelKey: "levelDebug" },
  other: { bar: "bg-ink-faint", text: "text-ink-faint", labelKey: "levelOther" },
};

/** Number of histogram buckets across the loaded time window. */
const HISTO_BUCKETS = 40;

/** Format a Date as a `datetime-local`-compatible string (local time, no tz),
 *  i.e. `YYYY-MM-DDTHH:mm`. Used when zooming via histogram click. */
function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LogViewer({
  ns,
  pods,
}: {
  ns: Namespace;
  pods: PodSummary[];
}) {
  const t = useT();

  /** All pod names (stable string for effect deps + multi-pod calls). */
  const allPodNames = useMemo(() => pods.map((p) => p.name), [pods]);
  const allPodNamesKey = allPodNames.join(",");

  // --- Pod subset selection (Grafana-like multi-pod) -------------------------
  // `selectedPods` holds an explicit subset. An empty set means "all pods"
  // (the default aggregate, equivalent to the legacy ALL_PODS sentinel).
  const [selectedPods, setSelectedPods] = useState<Set<string>>(
    () => new Set(pods[0]?.name ? [pods[0].name] : []),
  );

  // Keep the selection valid as the pod list changes (e.g. rollout). Drop names
  // that no longer exist; if everything vanished, fall back to the first pod.
  useEffect(() => {
    setSelectedPods((prev) => {
      const next = new Set([...prev].filter((n) => allPodNames.includes(n)));
      if (next.size === 0 && pods[0]?.name) next.add(pods[0].name);
      // Avoid a state churn if nothing changed.
      if (next.size === prev.size && [...next].every((n) => prev.has(n))) {
        return prev;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPodNamesKey]);

  /** Effective target list: the explicit subset, or every pod when the subset
   *  spans all of them (or is somehow empty). */
  const effectivePods = useMemo(() => {
    const arr = [...selectedPods].filter((n) => allPodNames.includes(n));
    if (arr.length === 0 || arr.length === allPodNames.length) {
      return [...allPodNames];
    }
    return arr.sort();
  }, [selectedPods, allPodNames]);
  /** True when the effective target is the whole namespace (aggregate). */
  const isAllSelected =
    selectedPods.size === 0 || effectivePods.length === allPodNames.length;
  /** Whether to render in multi-pod (aggregate) mode: >1 pod shown. */
  const allPods = effectivePods.length > 1;
  /** The single pod name when exactly one pod is targeted, else "". */
  const podName = effectivePods.length === 1 ? effectivePods[0] : "";
  /** Stable key for effect deps — sorted comma-joined effective set. */
  const effectivePodsKey = effectivePods.join(",");
  /** Any pod targeted at all? (guards the historical/stream effects). */
  const hasTarget = effectivePods.length > 0;

  const selectedPod = pods.find((p) => p.name === podName);
  const containers = selectedPod?.containers ?? [];
  const [container, setContainer] = useState(containers[0] ?? "");
  const [lines, setLines] = useState<PodLog[]>([]);
  const [state, setState] = useState<ConnState>("idle");
  const [streaming, setStreaming] = useState(true);
  const [autoscroll, setAutoscroll] = useState(true);

  // --- Historical / Loki view controls ---
  /** Search pattern forwarded to Loki. */
  const [search, setSearch] = useState("");
  /** Whether to treat `search` as a regex. */
  const [isRegex, setIsRegex] = useState(false);
  /** Local regex-validity (for inline feedback). Empty string = valid. */
  const [regexError, setRegexError] = useState("");

  // --- Timespan controls ---
  /** Currently selected preset or CUSTOM. */
  const [timespan, setTimespan] = useState<TimespanSelection>("1h");
  /** Custom range from (RFC3339 / datetime-local string). */
  const [customFrom, setCustomFrom] = useState("");
  /** Custom range to (RFC3339 / datetime-local string). */
  const [customTo, setCustomTo] = useState("");

  /** Error banner for failed Loki fetch. */
  const [fetchError, setFetchError] = useState<string | null>(null);

  // --- Grafana-like extras ---
  /** Which log levels are currently shown (chip toggles). All on by default. */
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(
    () => new Set<LogLevel>(LEVEL_ORDER),
  );
  /** Whether the volume histogram panel is shown. */
  const [showHistogram, setShowHistogram] = useState(true);
  /** Indices (into `shown`) of log lines that are expanded. */
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  /** Index of the line whose Copy button just fired (for transient feedback). */
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const wellRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // Keep container valid when pod changes.
  useEffect(() => {
    if (containers.length && !containers.includes(container)) {
      setContainer(containers[0]);
    }
  }, [containers, container]);

  // Validate regex on the fly as the user types.
  useEffect(() => {
    if (!isRegex || !search) {
      setRegexError("");
      return;
    }
    try {
      new RegExp(search);
      setRegexError("");
    } catch (e: unknown) {
      setRegexError(e instanceof Error ? e.message : t.logs.regexInvalid);
    }
  }, [search, isRegex, t.logs.regexInvalid]);

  // ---------------------------------------------------------------------------
  // Build the query opts object used by both snapshot and refetch.
  // ---------------------------------------------------------------------------
  const buildQueryOpts = () => {
    const base = {
      container: container || undefined,
      q: search || undefined,
      regex: isRegex || undefined,
      limit: 500 as const,
    };
    if (timespan === CUSTOM) {
      // Convert datetime-local strings to RFC3339 (they're already ISO-ish).
      const fromIso = customFrom ? new Date(customFrom).toISOString() : undefined;
      const toIso   = customTo   ? new Date(customTo).toISOString()   : undefined;
      return { ...base, from: fromIso, to: toIso };
    }
    return { ...base, since: timespan };
  };

  // ---------------------------------------------------------------------------
  // Historical snapshot effect.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!hasTarget || streaming) return;
    // Don't fire if regex is locally invalid (server would 400 anyway).
    if (isRegex && regexError) return;

    let cancelled = false;
    setFetchError(null);
    setLines([]);
    setState("connecting");

    const onSnap = (snap: PodLog[]) => {
      if (!cancelled) {
        setLines(snap.slice(-MAX_LINES));
        setState("closed");
      }
    };
    const onErr = (e: unknown) => {
      if (!cancelled) {
        setState("error");
        setFetchError(
          e instanceof ApiClientError
            ? e.message
            : "Failed to fetch logs from Loki",
        );
      }
    };

    if (allPods) {
      const { container: _c, ...multiOpts } = buildQueryOpts();
      void _c;
      api.getMultiLogs(ns, effectivePods, multiOpts).then(onSnap).catch(onErr);
    } else {
      api.getLogs(ns, podName, buildQueryOpts()).then(onSnap).catch(onErr);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ns, effectivePodsKey, allPods, container, streaming, search, isRegex, timespan, customFrom, customTo]);

  // ---------------------------------------------------------------------------
  // Live-stream (SSE) effect — only active when `streaming` is true.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    esRef.current?.close();
    esRef.current = null;

    if (!hasTarget || !streaming) {
      if (!streaming) {
        // Historical mode: the other effect handles fetching.
      } else {
        setState("idle");
      }
      return;
    }

    setState("connecting");
    setFetchError(null);

    // Seed with a Loki snapshot (last 1h, no filter) before attaching the
    // stream. Multi-pod streaming has no seed (kept simple/correct backend-side).
    let cancelled = false;
    if (allPods) {
      api
        .getMultiLogs(ns, effectivePods, { since: "1h", limit: 200 })
        .then((snap) => {
          if (!cancelled) setLines(snap.slice(-MAX_LINES));
        })
        .catch(() => {
          /* snapshot is best-effort in live mode */
        });
    } else {
      api
        .getLogs(ns, podName, {
          container: container || undefined,
          since: "1h",
          limit: 200,
        })
        .then((snap) => {
          if (!cancelled) setLines(snap.slice(-MAX_LINES));
        })
        .catch(() => {
          /* snapshot is best-effort in live mode */
        });
    }

    const url = allPods
      ? api.streamMultiLogsUrl(ns, effectivePods)
      : api.streamLogsUrl(ns, podName, container || undefined);
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setState("live");
    es.onmessage = (ev) => {
      try {
        const log = JSON.parse(ev.data) as PodLog;
        setLines((prev) => {
          const next =
            prev.length >= MAX_LINES ? prev.slice(-MAX_LINES + 1) : prev;
          return [...next, log];
        });
      } catch {
        /* ignore malformed event */
      }
    };
    es.onerror = () => {
      setState("error");
    };

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ns, effectivePodsKey, allPods, container, streaming]);

  // Autoscroll to bottom on new lines.
  useEffect(() => {
    if (autoscroll && wellRef.current) {
      wellRef.current.scrollTop = wellRef.current.scrollHeight;
    }
  }, [lines, autoscroll]);

  // ---------------------------------------------------------------------------
  // Derived display data
  // ---------------------------------------------------------------------------

  /** Lines that have at least one match when a search is active (client-side
   *  filter for the live stream, which carries all lines unfiltered). In
   *  historical mode Loki already filtered them, so we pass all through. */
  const shown = useMemo(() => {
    let result = lines;
    // In live mode with a non-empty search we do a client-side filter.
    if (streaming && search) {
      try {
        const flags = "i";
        const re = isRegex
          ? new RegExp(search, flags)
          : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        result = result.filter((l) => re.test(l.message));
      } catch {
        /* invalid regex → no search filter */
      }
    }
    // Compose with the level-filter chips (applies in all modes).
    if (enabledLevels.size < LEVEL_ORDER.length) {
      result = result.filter((l) => enabledLevels.has(detectLevel(l.message)));
    }
    return result;
  }, [lines, streaming, search, isRegex, enabledLevels]);

  /** Total match-segment count across all shown lines (for the counter). */
  const matchCount = useMemo(() => {
    if (!search) return null;
    let count = 0;
    for (const l of shown) {
      const segs = splitByMatch(l.message, search, isRegex);
      count += segs.filter((s) => s.match).length;
    }
    return count;
  }, [shown, search, isRegex]);

  // Reset expansion when the underlying line set changes (indices would drift).
  useEffect(() => {
    setExpanded(new Set());
  }, [lines]);

  // ---------------------------------------------------------------------------
  // Level counts (over the search-filtered set, before the level filter so the
  // chip counts stay stable as you toggle).
  // ---------------------------------------------------------------------------
  const searchFiltered = useMemo(() => {
    if (streaming && search) {
      try {
        const flags = "i";
        const re = isRegex
          ? new RegExp(search, flags)
          : new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
        return lines.filter((l) => re.test(l.message));
      } catch {
        return lines;
      }
    }
    return lines;
  }, [lines, streaming, search, isRegex]);

  const levelCounts = useMemo(() => {
    const c: Record<LogLevel, number> = {
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
      other: 0,
    };
    for (const l of searchFiltered) c[detectLevel(l.message)]++;
    return c;
  }, [searchFiltered]);

  // ---------------------------------------------------------------------------
  // Volume histogram buckets (client-side, from the displayed lines).
  // ---------------------------------------------------------------------------
  const histogram = useMemo(() => {
    // Only lines with a parseable timestamp contribute.
    const stamped = shown
      .map((l) => ({ t: l.timestamp ? new Date(l.timestamp).getTime() : NaN, l }))
      .filter((x) => Number.isFinite(x.t));
    if (stamped.length === 0) return null;

    let min = Infinity;
    let max = -Infinity;
    for (const s of stamped) {
      if (s.t < min) min = s.t;
      if (s.t > max) max = s.t;
    }
    // Degenerate span → widen by a minute so we still draw something.
    if (min === max) max = min + 60_000;
    const span = max - min;
    const width = span / HISTO_BUCKETS;

    const buckets = Array.from({ length: HISTO_BUCKETS }, (_, i) => ({
      start: min + i * width,
      end: min + (i + 1) * width,
      counts: { error: 0, warn: 0, info: 0, debug: 0, other: 0 } as Record<
        LogLevel,
        number
      >,
      total: 0,
    }));
    for (const s of stamped) {
      let idx = Math.floor((s.t - min) / width);
      if (idx < 0) idx = 0;
      if (idx >= HISTO_BUCKETS) idx = HISTO_BUCKETS - 1;
      const lvl = detectLevel(s.l.message);
      if (!enabledLevels.has(lvl)) continue;
      buckets[idx].counts[lvl]++;
      buckets[idx].total++;
    }
    const peak = buckets.reduce((m, b) => Math.max(m, b.total), 0);
    return { buckets, peak, min, max };
  }, [shown, enabledLevels]);

  // ---------------------------------------------------------------------------
  // Handlers for the new controls
  // ---------------------------------------------------------------------------
  const toggleLevel = (lvl: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl);
      else next.add(lvl);
      return next;
    });
  };

  const togglePod = (name: string) => {
    setSelectedPods((prev) => {
      // From the aggregate "all" state, the first toggle starts an explicit set.
      const base =
        prev.size === 0 ? new Set<string>(allPodNames) : new Set(prev);
      if (base.has(name)) base.delete(name);
      else base.add(name);
      if (base.size === 0 && pods[0]?.name) base.add(pods[0].name);
      return base;
    });
  };

  const selectAllPods = () => setSelectedPods(new Set());

  /** When a histogram bar is clicked in historical mode: zoom into the bucket. */
  const onBucketClick = (startMs: number, endMs: number) => {
    if (streaming) return; // no-op in live mode
    setTimespan(CUSTOM);
    setCustomFrom(toDatetimeLocal(new Date(startMs)));
    setCustomTo(toDatetimeLocal(new Date(endMs)));
    // Refetch on the next tick so the custom range state is applied first.
    setTimeout(() => refetchHistorical(), 0);
  };

  const toggleExpanded = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const copyMessage = async (i: number, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  /** Pretty-print a message if it is (or embeds) a JSON value; else return null. */
  const prettyJson = (message: string): string | null => {
    const tryParse = (s: string): string | null => {
      try {
        return JSON.stringify(JSON.parse(s), null, 2);
      } catch {
        return null;
      }
    };
    const whole = tryParse(message.trim());
    if (whole) return whole;
    // Embedded object/array: grab from first {/[ to its matching last }/].
    const m = message.match(/[{[][\s\S]*[}\]]/);
    if (m) return tryParse(m[0]);
    return null;
  };

  /** Build the displayed lines as text and trigger a download. */
  const download = (fmt: "txt" | "json") => {
    let content: string;
    let mime: string;
    if (fmt === "json") {
      content = JSON.stringify(shown, null, 2);
      mime = "application/json";
    } else {
      content = shown
        .map(
          (l) =>
            `${l.timestamp ?? ""}\t${l.pod}\t${l.message}`.replace(/\n+$/, ""),
        )
        .join("\n");
      mime = "text/plain";
    }
    const podTag = isAllSelected
      ? "all"
      : effectivePods.length === 1
        ? effectivePods[0]
        : "multi";
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${ns}-${podTag}-${shown.length}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // Pod-selector trigger label
  // ---------------------------------------------------------------------------
  const podTriggerLabel = isAllSelected
    ? t.logs.allPods(allPodNames.length)
    : effectivePods.length === 1
      ? effectivePods[0]
      : t.logs.podsSelected(effectivePods.length);

  // ---------------------------------------------------------------------------
  // Refetch (manual re-trigger from the Search button).
  // ---------------------------------------------------------------------------
  const refetchHistorical = () => {
    if (streaming) return;
    if (isRegex && regexError) return;
    setLines([]);
    setFetchError(null);
    setState("connecting");
    const onSnap = (snap: PodLog[]) => {
      setLines(snap.slice(-MAX_LINES));
      setState("closed");
    };
    const onErr = (e: unknown) => {
      setState("error");
      setFetchError(
        e instanceof ApiClientError
          ? e.message
          : "Failed to fetch logs from Loki",
      );
    };
    if (allPods) {
      const { container: _c, ...multiOpts } = buildQueryOpts();
      void _c;
      api.getMultiLogs(ns, effectivePods, multiOpts).then(onSnap).catch(onErr);
    } else {
      api.getLogs(ns, podName, buildQueryOpts()).then(onSnap).catch(onErr);
    }
  };

  // ---------------------------------------------------------------------------
  // Status dot / label
  // ---------------------------------------------------------------------------
  const stateMeta: Record<ConnState, { text: string; dot: string }> = {
    idle:       { text: "Idle",       dot: "bg-ink-faint" },
    connecting: { text: "Connecting", dot: "bg-pf-gold animate-pulse" },
    live:       { text: "Live",       dot: "bg-pf-green animate-pulse" },
    error:      { text: "Error",      dot: "bg-pf-red" },
    closed:     { text: "Historical", dot: "bg-pf-blue" },
  };
  const sm = stateMeta[state];

  // ---------------------------------------------------------------------------
  // Footer summary label
  // ---------------------------------------------------------------------------
  const footerTimeLabel = useMemo(() => {
    if (streaming) return null;
    if (timespan === CUSTOM) {
      const parts: string[] = [];
      if (customFrom) parts.push(`from ${customFrom.replace("T", " ")}`);
      if (customTo)   parts.push(`to ${customTo.replace("T", " ")}`);
      return parts.join(" ");
    }
    const found = TIME_WINDOWS.find((w) => w.value === timespan);
    if (!found) return timespan;
    // Access the label from the translation using the key.
    return t.logs[found.labelKey as keyof typeof t.logs] as string;
  }, [streaming, timespan, customFrom, customTo, t.logs]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Card className="overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        {/* Status dot */}
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <span className={cx("h-2 w-2 rounded-full", sm.dot)} />
          {sm.text}
        </span>

        {/* Pod selector — multi-pod subset via checkbox dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={pods.length === 0}
              aria-label="pod"
            >
              {pods.length === 0 ? "no pods" : podTriggerLabel}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72">
            {pods.length > 1 && (
              <>
                <DropdownMenuCheckboxItem
                  checked={isAllSelected}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => selectAllPods()}
                >
                  {t.logs.allPods(pods.length)}
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
              </>
            )}
            {pods.map((p) => {
              const checked = isAllSelected || selectedPods.has(p.name);
              return (
                <DropdownMenuCheckboxItem
                  key={p.name}
                  checked={checked}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => togglePod(p.name)}
                  className="text-xs"
                >
                  <span className={cx("font-mono", podLabelColor(p.name))}>
                    {p.name}
                  </span>
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Container selector (only when >1 container; hidden in all-pods mode) */}
        {!allPods && containers.length > 1 && (
          <Select value={container} onValueChange={setContainer}>
            <SelectTrigger
              className="h-7 w-auto text-xs"
              aria-label="container"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {containers.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* ── Historical-mode controls ── */}
        {!streaming && (
          <>
            {/* Timespan preset + custom */}
            <Select
              value={timespan}
              onValueChange={(v) => setTimespan(v as TimespanSelection)}
            >
              <SelectTrigger
                className="h-7 w-auto text-xs"
                aria-label={t.logs.timespanLabel}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={w.value}>
                    {t.logs[w.labelKey as keyof typeof t.logs] as string}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM}>{t.logs.customRange}</SelectItem>
              </SelectContent>
            </Select>

            {/* Custom date/time inputs */}
            {timespan === CUSTOM && (
              <span className="flex items-center gap-1 text-xs">
                <label className="text-ink-muted">{t.logs.fromLabel}</label>
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-7 rounded border border-line bg-transparent px-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-pf-blue"
                />
                <label className="text-ink-muted">{t.logs.toLabel}</label>
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-7 rounded border border-line bg-transparent px-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-pf-blue"
                />
              </span>
            )}

            {/* Search row: regex toggle + input + button */}
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                refetchHistorical();
              }}
            >
              {/* Regex toggle button */}
              <button
                type="button"
                title={t.logs.regexToggleTitle}
                onClick={() => setIsRegex((v) => !v)}
                className={cx(
                  "flex h-7 items-center rounded border px-1.5 font-mono text-xs transition-colors",
                  isRegex
                    ? "border-pf-blue bg-pf-blue/10 text-pf-blue"
                    : "border-line bg-transparent text-ink-muted hover:text-ink",
                )}
              >
                .*
              </button>

              <span className="relative flex items-center">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.logs.searchPlaceholder}
                  className={cx(
                    "h-7 w-44 text-xs",
                    regexError ? "border-pf-red focus-visible:ring-pf-red" : "",
                  )}
                  aria-label="search"
                />
                {regexError && (
                  <span
                    title={regexError}
                    className="pointer-events-none absolute right-1.5 text-pf-red"
                    aria-label={t.logs.regexInvalid}
                  >
                    ⚠
                  </span>
                )}
              </span>

              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!podName || (isRegex && !!regexError)}
              >
                {t.logs.searchBtn}
              </Button>
            </form>
          </>
        )}

        {/* ── Right-side controls ── */}
        <div className="ml-auto flex items-center gap-2">
          {streaming && (
            <label className="flex items-center gap-1.5 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={autoscroll}
                onChange={(e) => setAutoscroll(e.target.checked)}
                className="accent-pf-blue"
              />
              {t.logs.followLabel}
            </label>
          )}
          {/* Histogram show/hide toggle */}
          <button
            type="button"
            title={t.logs.histogramToggle}
            aria-label={t.logs.histogramToggle}
            onClick={() => setShowHistogram((v) => !v)}
            className={cx(
              "flex h-7 items-center rounded border px-1.5 transition-colors",
              showHistogram
                ? "border-pf-blue bg-pf-blue/10 text-pf-blue"
                : "border-line bg-transparent text-ink-muted hover:text-ink",
            )}
          >
            <BarChart3 className="h-3.5 w-3.5" />
          </button>

          {/* Export dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                disabled={shown.length === 0}
                aria-label={t.logs.exportLabel}
              >
                <Download className="h-3.5 w-3.5" />
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => download("txt")}
              >
                {t.logs.exportTxt}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => download("json")}
              >
                {t.logs.exportJson}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLines([]);
              setFetchError(null);
              setStreaming((s) => !s);
            }}
            className="h-7 text-xs"
            disabled={!hasTarget}
          >
            {streaming ? t.logs.historicalBtn : t.logs.liveBtn}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setLines([])}
            className="h-7 text-xs"
          >
            {t.logs.clearBtn}
          </Button>
        </div>
      </div>

      {/* ── Level filter chips ── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
        {LEVEL_ORDER.map((lvl) => {
          const meta = LEVEL_META[lvl];
          const on = enabledLevels.has(lvl);
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => toggleLevel(lvl)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition-colors",
                on
                  ? "border-line bg-line-soft"
                  : "border-line bg-transparent opacity-45 hover:opacity-80",
              )}
              aria-pressed={on}
            >
              <span className={cx("h-2 w-2 rounded-sm", meta.bar)} />
              <span className={cx("font-medium", meta.text)}>
                {t.logs[meta.labelKey as keyof typeof t.logs] as string}
              </span>
              <span className="tabular-nums text-ink-muted">
                {levelCounts[lvl]}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Volume histogram ── */}
      {showHistogram && histogram && (
        <div className="border-b border-line bg-[#1b1d21]/40 px-3 py-2">
          <div className="flex h-[56px] items-end gap-px overflow-hidden">
            {histogram.buckets.map((b, bi) => {
              const heightPct =
                histogram.peak > 0 ? (b.total / histogram.peak) * 100 : 0;
              const startD = fmtTime(new Date(b.start).toISOString());
              const endD = fmtTime(new Date(b.end).toISOString());
              const perLevel = LEVEL_ORDER.filter(
                (l) => b.counts[l] > 0,
              )
                .map(
                  (l) =>
                    `${t.logs[LEVEL_META[l].labelKey as keyof typeof t.logs] as string}: ${b.counts[l]}`,
                )
                .join(" · ");
              const title =
                t.logs.histogramBucket(startD, endD, b.total) +
                (perLevel ? `\n${perLevel}` : "");
              return (
                <div
                  key={bi}
                  title={title}
                  onClick={() => onBucketClick(b.start, b.end)}
                  className={cx(
                    "flex min-w-0 flex-1 flex-col-reverse justify-start",
                    streaming ? "" : "cursor-pointer hover:opacity-80",
                  )}
                  style={{ height: `${Math.max(heightPct, b.total > 0 ? 4 : 0)}%` }}
                >
                  {LEVEL_ORDER.map((lvl) => {
                    if (b.counts[lvl] === 0) return null;
                    const segPct = (b.counts[lvl] / b.total) * 100;
                    return (
                      <div
                        key={lvl}
                        className={LEVEL_META[lvl].bar}
                        style={{ height: `${segPct}%` }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Log well ── */}
      <div
        ref={wellRef}
        className="logwell h-[480px] overflow-auto bg-[#1b1d21] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#f0f0f0]"
      >
        {shown.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[#8a8d90]">
            {state === "live" || state === "connecting"
              ? t.logs.waitingOutput
              : fetchError
                ? fetchError
                : t.logs.noLines}
          </div>
        ) : (
          shown.map((l, i) => {
            const segments = splitByMatch(l.message, search, isRegex);
            const level = detectLevel(l.message);
            const isOpen = expanded.has(i);
            const json = isOpen ? prettyJson(l.message) : null;
            return (
              <div key={i}>
                <div
                  onClick={() => toggleExpanded(i)}
                  className="flex cursor-pointer gap-3 whitespace-pre-wrap break-all hover:bg-white/5"
                >
                  {/* Level colour bar */}
                  <span
                    title={level}
                    className={cx(
                      "mt-[3px] h-3 w-1 shrink-0 select-none rounded-sm",
                      LEVEL_META[level].bar,
                    )}
                  />
                  {l.timestamp && (
                    <span className="shrink-0 select-none text-[#8a8d90]">
                      {fmtTime(l.timestamp).split(" ")[1] ?? ""}
                    </span>
                  )}
                  {allPods && (
                    <span
                      title={l.pod}
                      className={cx(
                        "shrink-0 select-none font-semibold",
                        podLabelColor(l.pod),
                      )}
                    >
                      {podShortLabel(l.pod)}
                    </span>
                  )}
                  <span className="text-[#d2d2d2]">
                    {segments.map((seg, si) =>
                      seg.match ? (
                        <mark
                          key={si}
                          className="rounded-sm bg-pf-gold/40 px-px text-[#f0f0f0]"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={si}>{seg.text}</span>
                      ),
                    )}
                  </span>
                </div>
                {isOpen && (
                  <div className="my-1 ml-2 rounded border border-white/10 bg-black/30 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="select-none text-[10px] uppercase tracking-wide text-[#8a8d90]">
                        {l.pod}
                        {l.container ? ` · ${l.container}` : ""}
                        {l.timestamp ? ` · ${fmtTime(l.timestamp)}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyMessage(i, l.message);
                        }}
                        className="inline-flex items-center gap-1 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-[#d2d2d2] hover:bg-white/10"
                      >
                        <CopyIcon className="h-3 w-3" />
                        {copiedIdx === i ? t.logs.copied : t.logs.copyBtn}
                      </button>
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[12px] text-[#e6e6e6]">
                      {json ?? l.message}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── Footer status bar ── */}
      <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
        <span className="tabular-nums">
          {t.logs.lineCount(shown.length)}
          {matchCount !== null && search && (
            <span className="ml-2 text-pf-gold">
              · {t.logs.matchCount(matchCount)}
            </span>
          )}
          {footerTimeLabel && (
            <span className="ml-2">· {footerTimeLabel}</span>
          )}
        </span>
        {state === "error" && !fetchError && (
          <span className="text-pf-red">{t.logs.streamDropped}</span>
        )}
        {fetchError && (
          <span className="text-pf-red" title={fetchError}>
            {t.logs.lokiError}
          </span>
        )}
      </div>
    </Card>
  );
}
