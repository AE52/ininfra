import Link from "next/link";
import type { BuildJob } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { fmtDuration, timeAgo } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { BuildBadge } from "@/components/StatusBadge";
import { BuildTriggerForm } from "@/components/BuildTriggerForm";
import { ErrorPanel } from "@/components/ErrorPanel";
import { CursorPager } from "@/components/Pager";
import { JenkinsGate } from "@/components/JenkinsGate";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function BuildsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  const cursor = c?.split(",").filter(Boolean).at(-1);

  let builds: BuildJob[] = [];
  let nextCursor: string | null = null;
  let total: number | null | undefined;
  let error: string | null = null;
  try {
    const api = await getServerApi();
    const page = await api.listBuilds({ cursor });
    builds = page.items;
    nextCursor = page.nextCursor;
    total = page.total;
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  // Repo suggestions for the trigger form, derived from recent run history.
  const repos = Array.from(new Set(builds.map((b) => b.job))).sort();

  return (
    <JenkinsGate kicker="Continuous delivery" title="Builds">
    <div className="animate-fade-in">
      <PageHeader
        kicker="Continuous delivery"
        title="Builds"
        subtitle="Argo CI/CD runs — build, deploy, and per-commit status."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <BuildTriggerForm repos={repos} />
        </div>

        <div>
          <h2 className="label-kicker mb-3">Recent runs</h2>
          {error && <div className="mb-4"><ErrorPanel message={error} /></div>}
          {builds.length === 0 && !error ? (
            <EmptyState
              title="No runs yet"
              body="Push to a service's active branch, or run one from the form."
            />
          ) : (
            <div className="space-y-2">
              {builds.map((b) => (
                <BuildRow key={b.url ?? `${b.job}-${b.startedAt}`} b={b} />
              ))}
            </div>
          )}
          {!error && builds.length > 0 && (
            <CursorPager nextCursor={nextCursor} total={total} shown={builds.length} />
          )}
        </div>
      </div>
    </div>
    </JenkinsGate>
  );
}

function BuildRow({ b }: { b: BuildJob }) {
  // `url` carries the Argo Workflow name = the run id for the logs view.
  const id = b.url;
  return (
    <Card className="flex items-center gap-4 px-4 py-3 transition-colors hover:border-pf-blue/50">
      <BuildBadge status={b.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate font-medium text-ink">{b.job}</span>
          {b.ref && (
            <span className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
              {b.ref}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-faint">
          by {b.triggeredBy} · {timeAgo(b.startedAt)}
        </div>
      </div>
      <div className="text-right">
        <div className="tabular font-mono text-xs text-ink-muted">
          {fmtDuration(b.durationMs)}
        </div>
        {id && (
          <Link
            href={`/builds/${id}`}
            className="text-[11px] text-ink-faint hover:text-pf-blue"
          >
            logs →
          </Link>
        )}
      </div>
    </Card>
  );
}
