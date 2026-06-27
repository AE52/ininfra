"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Generic Prev/Next pager. Callback-driven so it works for both client-state
 * pages and (via {@link CursorPager}) URL-driven SSR pages.
 */
export function Pager({
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  total,
  shown,
}: {
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Total rows across all pages, when known. */
  total?: number | null;
  /** Rows shown on the current page. */
  shown?: number;
}) {
  if (!hasPrev && !hasNext) return null;

  const label =
    shown != null && total != null
      ? `${shown} of ${total}`
      : shown != null
        ? `showing ${shown}`
        : null;

  return (
    <div className="mt-4 flex items-center justify-center gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasPrev}
        onClick={onPrev}
      >
        ← Prev
      </Button>
      {label && <span className="text-xs text-ink-muted">{label}</span>}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!hasNext}
        onClick={onNext}
      >
        Next →
      </Button>
    </div>
  );
}

/**
 * URL-driven pager for SSR (`force-dynamic`) pages. Tracks a cursor stack in
 * the `?c=` search param (comma-joined offsets) so Prev is functional without
 * client state. The current page's cursor is the last entry in the stack; Next
 * pushes `nextCursor`, Prev pops the stack.
 */
export function CursorPager({
  nextCursor,
  total,
  shown,
}: {
  nextCursor?: string | null;
  total?: number | null;
  shown?: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const stack = (params.get("c") ?? "").split(",").filter(Boolean);
  const hasPrev = stack.length > 0;
  const hasNext = !!nextCursor;

  const withStack = (next: string[]) => {
    const sp = new URLSearchParams(params.toString());
    if (next.length) sp.set("c", next.join(","));
    else sp.delete("c");
    const qs = sp.toString();
    router.push(qs ? `?${qs}` : "?");
  };

  return (
    <Pager
      hasPrev={hasPrev}
      hasNext={hasNext}
      total={total}
      shown={shown}
      onPrev={() => withStack(stack.slice(0, -1))}
      onNext={() => nextCursor && withStack([...stack, nextCursor])}
    />
  );
}
