import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  BuildJob,
  BuildConfigService,
  Deployment,
  EnvBundle,
  Namespace,
  PodSummary,
} from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { fmtTime, fmtDuration, shortImage, timeAgo } from "@/lib/format";
import { PageHeader, Stat, NamespaceTag, EmptyState } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HealthBadge, BuildBadge } from "@/components/StatusBadge";
import { FavoriteStar } from "@/components/FavoriteStar";
import { ScaleControls } from "@/components/ScaleControls";
import { PodsTable } from "@/components/PodsTable";
import { LogViewer } from "@/components/LogViewer";
import { ManifestViewer } from "@/components/ManifestViewer";
import { DescribePanel } from "@/components/DescribePanel";
import { TopologyPanel } from "@/components/TopologyPanel";
import { KubectlMenu } from "@/components/KubectlMenu";
import { ErrorPanel } from "@/components/ErrorPanel";
import { BranchControl } from "./BranchControl";
import { BuildTriggerPanel } from "./BuildTriggerPanel";

export const dynamic = "force-dynamic";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ ns: string; name: string }>;
}) {
  const { ns: nsRaw, name } = await params;
  const ns = nsRaw as Namespace;
  const api = await getServerApi();

  let dep: Deployment;
  try {
    dep = await api.getDeployment(ns, name);
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) notFound();
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={ns} title={name} />
        <ErrorPanel
          message={e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e)}
        />
      </div>
    );
  }

  // Env bundle, pods, builds, and build catalog are best-effort: render even if one fails.
  const [envRes, podsRes, buildsRes, buildConfigRes] = await Promise.allSettled([
    api.getEnv(ns, name, false),
    api.listPods(ns, undefined, { limit: 500 }),
    api.listBuilds({ limit: 50 }),
    api.listBuildConfig(ns),
  ]);

  const env: EnvBundle | null =
    envRes.status === "fulfilled" ? envRes.value : null;

  const allPods: PodSummary[] =
    podsRes.status === "fulfilled" ? podsRes.value.items : [];
  // Match pods owned by this deployment (ownerRef like "deployment/<name>"
  // or replicaset prefixed with the deployment name).
  const pods = allPods.filter(
    (p) =>
      p.ownerRef?.includes(name) ||
      p.name.startsWith(`${name}-`),
  );

  const allBuilds: BuildJob[] =
    buildsRes.status === "fulfilled" ? buildsRes.value.items : [];

  const buildConfigs: BuildConfigService[] =
    buildConfigRes.status === "fulfilled" ? buildConfigRes.value : [];

  // Find this service's catalog entry (repo, branch)
  const catalogEntry = buildConfigs.find((c) => c.name === name) ?? null;

  // Filter builds to those matching this service's repo
  const serviceBuilds = catalogEntry
    ? allBuilds.filter((b) => b.job === catalogEntry.repo)
    : [];

  // Parse commit sha from the image tag (e.g. "sha-abc1234" or "abc1234")
  const imageShaMatch =
    dep.image.match(/[:/]sha-([0-9a-f]{7,40})(?:@|$)/i) ??
    dep.image.match(/:([0-9a-f]{7,40})(?:@|$)/i);
  const imageGitSha = imageShaMatch?.[1] ?? null;
  const repoUrl = catalogEntry?.repo
    ? `https://github.com/${catalogEntry.repo}`
    : null;
  const commitUrl =
    imageGitSha && repoUrl ? `${repoUrl}/commit/${imageGitSha}` : null;

  const buildsError =
    buildsRes.status === "rejected"
      ? buildsRes.reason instanceof ApiClientError
        ? `${buildsRes.reason.code}: ${buildsRes.reason.message}`
        : String(buildsRes.reason)
      : null;

  const { name: imgName, tag } = shortImage(dep.image);
  const r = dep.resources;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        kicker={
          <Link href="/services" className="hover:text-pf-blue">
            Services
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {dep.name}
            <HealthBadge status={dep.health} />
            <FavoriteStar
              kind="deployment"
              namespace={ns}
              name={name}
              href={`/services/${ns}/${name}`}
            />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <NamespaceTag ns={dep.namespace} />
            <span className="font-mono text-xs text-ink-faint">
              {imgName}
              <span className="text-ink-faint">:</span>
              <span className="text-pf-blue">{tag}</span>
            </span>
            <span className="text-ink-faint">·</span>
            <span className="text-xs text-ink-faint">{dep.strategy}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <ManifestViewer kind="deployment" ns={ns} name={name} />
            <KubectlMenu target="deployment" ns={ns} name={name} />
            <Button asChild variant="outline" size="sm">
              <Link href={`/services/${ns}/${name}/deploy`}>Deploy →</Link>
            </Button>
          </div>
        }
      />

      {/* Rollout stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Desired" value={dep.replicasDesired} />
        <Stat
          label="Ready"
          value={dep.replicasReady}
          accent={dep.replicasReady < dep.replicasDesired ? "amber" : "lime"}
        />
        <Stat label="Updated" value={dep.replicasUpdated} accent="sky" />
        <Stat label="Available" value={dep.replicasAvailable} />
      </div>

      {/* Commit / image info row */}
      <Card className="px-5 py-4">
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <div className="label-kicker mb-1">Image tag</div>
            <span className="font-mono text-sm text-ink">{tag}</span>
          </div>
          <div>
            <div className="label-kicker mb-1">Commit</div>
            {imageGitSha ? (
              commitUrl ? (
                <a
                  href={commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-pf-blue hover:underline"
                >
                  {imageGitSha.slice(0, 12)}
                </a>
              ) : (
                <span className="font-mono text-sm text-ink">
                  {imageGitSha.slice(0, 12)}
                </span>
              )
            ) : (
              <span className="text-sm text-ink-faint">—</span>
            )}
          </div>
          <div>
            <div className="label-kicker mb-1">Catalog branch</div>
            {catalogEntry ? (
              <span className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                {catalogEntry.branch}
              </span>
            ) : (
              <span className="text-sm text-ink-faint">—</span>
            )}
          </div>
        </div>
      </Card>

      {/* Branch control + Build trigger */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <BranchControl
          ns={ns}
          service={name}
          currentBranch={catalogEntry?.branch ?? null}
        />
        <BuildTriggerPanel
          ns={ns}
          serviceName={name}
          repo={catalogEntry?.repo ?? null}
          branch={catalogEntry?.branch ?? null}
        />
      </div>

      {/* Recent builds for this service */}
      <section>
        <h2 className="label-kicker mb-3">Recent builds</h2>
        {buildsError && (
          <ErrorPanel title="Could not load builds" message={buildsError} />
        )}
        {!buildsError && serviceBuilds.length === 0 && (
          <EmptyState
            title="No builds found"
            body={
              catalogEntry
                ? `No recent Argo runs found for ${catalogEntry.repo}.`
                : "This service has no build catalog entry, so builds cannot be matched."
            }
          />
        )}
        {!buildsError && serviceBuilds.length > 0 && (
          <div className="space-y-2">
            {serviceBuilds.map((b) => {
              const id = b.url;
              return (
                <Card
                  key={b.url ?? `${b.job}-${b.startedAt}`}
                  className="flex items-center gap-4 px-4 py-3 transition-colors hover:border-pf-blue/50"
                >
                  <BuildBadge status={b.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      {b.ref && (
                        <span className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                          {b.ref}
                        </span>
                      )}
                      {b.sha ? (
                        repoUrl ? (
                          <a
                            href={`${repoUrl}/commit/${b.sha}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-xs text-pf-blue hover:underline"
                            title={b.sha}
                          >
                            {b.sha.slice(0, 9)}
                          </a>
                        ) : (
                          <span className="font-mono text-xs text-ink-muted" title={b.sha}>
                            {b.sha.slice(0, 9)}
                          </span>
                        )
                      ) : (
                        <span className="font-mono text-xs text-ink-faint">
                          {id ? id.slice(0, 16) : "—"}
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
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScaleControls
          ns={ns}
          name={dep.name}
          desired={dep.replicasDesired}
          ready={dep.replicasReady}
        />

        {/* Resources + conditions */}
        <Card className="p-5">
          <h3 className="label-kicker mb-3">Resources &amp; conditions</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
            <Field k="cpu req" v={r.requestsCpu} />
            <Field k="cpu lim" v={r.limitsCpu} />
            <Field k="mem req" v={r.requestsMemory} />
            <Field k="mem lim" v={r.limitsMemory} />
          </div>
          <div className="mt-4 space-y-1.5">
            {dep.conditions.length === 0 && (
              <div className="text-xs text-ink-faint">No conditions reported.</div>
            )}
            {dep.conditions.map((c) => (
              <div
                key={c.type}
                className="flex items-start justify-between gap-3 border-t border-line pt-1.5 first:border-0 first:pt-0"
              >
                <span className="text-xs text-ink-soft">{c.type}</span>
                <span className="flex-1 truncate text-right text-[11px] text-ink-faint">
                  {c.reason ?? c.message ?? "—"}
                </span>
                <span
                  className={
                    c.status === "True"
                      ? "text-pf-green"
                      : c.status === "False"
                        ? "text-pf-red"
                        : "text-ink-faint"
                  }
                >
                  {c.status}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3 text-[11px] text-ink-faint">
            Created {fmtTime(dep.createdAt)}
          </div>
        </Card>
      </div>

      {/* Environment summary */}
      <section>
        <h2 className="label-kicker mb-3">Environment</h2>
        {env ? (
          <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
              <span className="tabular font-mono text-ink">
                {env.configMaps.length}
              </span>
              <span className="text-ink-faint">configmap</span>
              <span className="text-ink-faint">·</span>
              <span className="tabular font-mono text-ink">
                {env.secrets.length}
              </span>
              <span className="text-ink-faint">secret</span>
              <span className="text-ink-faint">·</span>
              <span className="tabular font-mono text-ink">
                {env.inline.length}
              </span>
              <span className="text-ink-faint">inline</span>
            </div>
            <Button asChild size="sm">
              <Link href={`/services/${ns}/${name}/env`}>Manage environment →</Link>
            </Button>
          </Card>
        ) : (
          <ErrorPanel title="Could not load environment" message={
            envRes.status === "rejected"
              ? envRes.reason instanceof ApiClientError
                ? envRes.reason.message
                : String(envRes.reason)
              : undefined
          } />
        )}
      </section>

      {/* Topology & disruption budget */}
      <section>
        <h2 className="label-kicker mb-3">Topology &amp; disruption budget</h2>
        <TopologyPanel kind="deployment" ns={ns} name={name} />
      </section>

      {/* Events & Describe */}
      <section>
        <h2 className="label-kicker mb-3">Events &amp; describe</h2>
        <DescribePanel kind="deployment" ns={ns} name={name} />
      </section>

      {/* Pods */}
      <section>
        <h2 className="label-kicker mb-3">Pods ({pods.length})</h2>
        <PodsTable ns={ns} pods={pods} />
      </section>

      {/* Logs */}
      <section>
        <h2 className="label-kicker mb-3">Live logs</h2>
        <LogViewer ns={ns} pods={pods} />
      </section>
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-faint">{k}</span>
      <span className={v ? "text-ink-soft" : "text-ink-faint"}>{v ?? "—"}</span>
    </div>
  );
}
