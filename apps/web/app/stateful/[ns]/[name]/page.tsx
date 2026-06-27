import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  EnvBundle,
  Namespace,
  PodSummary,
  StatefulSetSummary,
} from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { fmtTime, shortImage } from "@/lib/format";
import { PageHeader, Stat, NamespaceTag, EmptyState } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HealthBadge } from "@/components/StatusBadge";
import { FavoriteStar } from "@/components/FavoriteStar";
import { ScaleControls } from "@/components/ScaleControls";
import { PodsTable } from "@/components/PodsTable";
import { LogViewer } from "@/components/LogViewer";
import { ManifestViewer } from "@/components/ManifestViewer";
import { DescribePanel } from "@/components/DescribePanel";
import { TopologyPanel } from "@/components/TopologyPanel";
import { DriftPanel } from "@/components/DriftPanel";
import { KubectlMenu } from "@/components/KubectlMenu";
import { ErrorPanel } from "@/components/ErrorPanel";

export const dynamic = "force-dynamic";

export default async function StatefulSetDetailPage({
  params,
}: {
  params: Promise<{ ns: string; name: string }>;
}) {
  const { ns: nsRaw, name } = await params;
  const ns = nsRaw as Namespace;
  const api = await getServerApi();

  let sts: StatefulSetSummary;
  try {
    sts = await api.getStatefulSet(ns, name);
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

  // Env bundle and pods are best-effort: render even if one fails. The env
  // endpoint is keyed by workload name and works for any workload that mounts
  // configmaps/secrets — if it 404s for this StatefulSet we degrade gracefully.
  const [envRes, podsRes] = await Promise.allSettled([
    api.getEnv(ns, name, false),
    api.listPods(ns, undefined, { limit: 500 }),
  ]);

  const env: EnvBundle | null =
    envRes.status === "fulfilled" ? envRes.value : null;
  // A 404 just means this workload has no env-bearing config — not an error.
  const envMissing =
    envRes.status === "rejected" &&
    envRes.reason instanceof ApiClientError &&
    envRes.reason.status === 404;

  const allPods: PodSummary[] =
    podsRes.status === "fulfilled" ? podsRes.value.items : [];
  // Match pods owned by this StatefulSet (ownerRef like "statefulset/<name>",
  // or the stable "<name>-<ordinal>" pod naming the controller uses).
  const pods = allPods.filter(
    (p) => p.ownerRef?.includes(name) || p.name.startsWith(`${name}-`),
  );

  const { name: imgName, tag } = shortImage(sts.image);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        kicker={
          <Link href="/stateful" className="hover:text-pf-blue">
            StatefulSets
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            {sts.name}
            <HealthBadge status={sts.health} />
            <FavoriteStar
              kind="statefulset"
              namespace={ns}
              name={name}
              href={`/stateful/${ns}/${name}`}
            />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <NamespaceTag ns={sts.namespace} />
            <span className="font-mono text-xs text-ink-faint">
              {imgName}
              <span className="text-ink-faint">:</span>
              <span className="text-pf-blue">{tag}</span>
            </span>
            {sts.updateStrategy && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="text-xs text-ink-faint">{sts.updateStrategy}</span>
              </>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <ManifestViewer kind="statefulset" ns={ns} name={name} />
            <KubectlMenu target="statefulset" ns={ns} name={name} />
          </div>
        }
      />

      {/* Rollout stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Desired" value={sts.replicasDesired} />
        <Stat
          label="Ready"
          value={sts.replicasReady}
          accent={sts.replicasReady < sts.replicasDesired ? "amber" : "lime"}
        />
        <Stat
          label="Service"
          value={
            <span className="font-mono text-base">{sts.serviceName ?? "—"}</span>
          }
          accent="sky"
        />
        <Stat
          label="Strategy"
          value={
            <span className="text-base">{sts.updateStrategy ?? "—"}</span>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ScaleControls
          kind="statefulset"
          ns={ns}
          name={sts.name}
          desired={sts.replicasDesired}
          ready={sts.replicasReady}
        />

        {/* Resources + conditions.
         *  The StatefulSet summary doesn't carry per-container resource
         *  requests/limits or status conditions — those live in the live spec
         *  and the describe endpoint. We surface what the summary provides here
         *  and the full conditions + events below in "Events & describe". */}
        <Card className="p-5">
          <h3 className="label-kicker mb-3">Resources &amp; conditions</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-xs">
            <Field k="replicas" v={`${sts.replicasReady}/${sts.replicasDesired}`} />
            <Field k="health" v={sts.health} />
            <Field k="service" v={sts.serviceName} />
            <Field k="strategy" v={sts.updateStrategy} />
          </div>
          <div className="mt-4 border-t border-line pt-3 text-[11px] text-ink-faint">
            Conditions and per-container resources are shown in the manifest and
            in the &ldquo;Events &amp; describe&rdquo; panel below.
          </div>
          <div className="mt-3 border-t border-line pt-3 text-[11px] text-ink-faint">
            Created {fmtTime(sts.createdAt)}
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
        ) : envMissing ? (
          <EmptyState
            title="No environment configuration"
            body="This StatefulSet references no env-bearing ConfigMaps or Secrets."
          />
        ) : (
          <ErrorPanel
            title="Could not load environment"
            message={
              envRes.status === "rejected"
                ? envRes.reason instanceof ApiClientError
                  ? envRes.reason.message
                  : String(envRes.reason)
                : undefined
            }
          />
        )}
      </section>

      {/* Topology & disruption budget */}
      <section>
        <h2 className="label-kicker mb-3">Topology &amp; disruption budget</h2>
        <TopologyPanel kind="statefulset" ns={ns} name={name} />
      </section>

      {/* Configuration drift (live spec vs last-applied) */}
      <section>
        <h2 className="label-kicker mb-3">Drift</h2>
        <DriftPanel kind="statefulset" ns={ns} name={name} />
      </section>

      {/* Events & Describe */}
      <section>
        <h2 className="label-kicker mb-3">Events &amp; describe</h2>
        <DescribePanel kind="statefulset" ns={ns} name={name} />
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
