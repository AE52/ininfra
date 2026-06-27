import Link from "next/link";
import type { BuildJob } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { fmtDuration, timeAgo } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { BuildBadge } from "@/components/StatusBadge";
import { ErrorPanel } from "@/components/ErrorPanel";

export const dynamic = "force-dynamic";

export default async function BuildDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let build: BuildJob | null = null;
  let logs = "";
  let error: string | null = null;
  try {
    const api = await getServerApi();
    build = await api.getBuild(id);
    try {
      logs = await api.buildLogs(id);
    } catch (e) {
      // Logs expire when the workflow pods are garbage-collected; the run
      // record still shows status/timing.
      logs = e instanceof ApiClientError ? `(logs unavailable: ${e.message})` : String(e);
    }
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Continuous delivery"
        title="Build run"
        subtitle={id}
      />

      <Link href="/builds" className="mb-4 inline-block text-xs text-ink-faint hover:text-pf-blue">
        ← all runs
      </Link>

      {error && <ErrorPanel message={error} />}

      {build && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded border border-line bg-line-soft px-4 py-3">
          <BuildBadge status={build.status} />
          <span className="font-medium text-ink">{build.job}</span>
          {build.ref && (
            <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
              {build.ref}
            </span>
          )}
          <span className="text-[11px] text-ink-faint">
            by {build.triggeredBy} · {timeAgo(build.startedAt)} · {fmtDuration(build.durationMs)}
          </span>
        </div>
      )}

      <pre className="max-h-[70vh] overflow-auto rounded border border-line bg-black/90 p-4 font-mono text-xs leading-relaxed text-green-200">
        {logs || "(no logs)"}
      </pre>
    </div>
  );
}
