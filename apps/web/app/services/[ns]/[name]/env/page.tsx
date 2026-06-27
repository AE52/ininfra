import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import type { EnvBundle, EnvObject, Namespace } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { PageHeader, Stat, EmptyState } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { ErrorPanel } from "@/components/ErrorPanel";

export const dynamic = "force-dynamic";

export default async function EnvOverviewPage({
  params,
}: {
  params: Promise<{ ns: string; name: string }>;
}) {
  const { ns: nsRaw, name } = await params;
  const ns = nsRaw as Namespace;
  const base = `/services/${ns}/${name}`;
  const api = await getServerApi();

  let env: EnvBundle;
  try {
    env = await api.getEnv(ns, name, false);
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) notFound();
    return (
      <div className="animate-fade-in">
        <PageHeader
          kicker={
            <Link href={base} className="hover:text-pf-blue">
              {name}
            </Link>
          }
          title="Environment"
        />
        <ErrorPanel
          message={e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e)}
        />
      </div>
    );
  }

  const cmVars = env.configMaps.reduce((n, o) => n + o.data.length, 0);
  const secretVars = env.secrets.reduce((n, o) => n + o.data.length, 0);
  const totalVars = cmVars + secretVars + env.inline.length;
  const nothing =
    env.configMaps.length === 0 &&
    env.secrets.length === 0 &&
    env.inline.length === 0;

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        kicker={
          <Link href={base} className="hover:text-pf-blue">
            {name}
          </Link>
        }
        title="Environment"
        subtitle={
          <span className="text-sm text-ink-muted">
            ConfigMaps, Secrets and inline variables backing this workload.
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Variables" value={totalVars} />
        <Stat label="ConfigMaps" value={env.configMaps.length} accent="sky" />
        <Stat label="Secrets" value={env.secrets.length} accent="amber" />
        <Stat label="Inline" value={env.inline.length} />
      </div>

      {nothing ? (
        <EmptyState
          title="No environment"
          body="This workload mounts no ConfigMaps or Secrets and declares no inline env."
        />
      ) : (
        <div className="space-y-2">
          {env.configMaps.map((o) => (
            <ObjectRow key={`cm/${o.name}`} base={base} object={o} />
          ))}
          {env.secrets.map((o) => (
            <ObjectRow key={`secret/${o.name}`} base={base} object={o} />
          ))}
          {env.inline.length > 0 && (
            <Link
              href={`${base}/env/inline`}
              className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 shadow text-card-foreground transition-colors hover:bg-line-soft"
            >
              <span className="flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-ink-faint" />
                <span className="font-mono text-sm text-ink">inline</span>
                <Badge
                  variant="outline"
                  className="border-line bg-line-soft text-ink-muted"
                >
                  Inline
                </Badge>
              </span>
              <span className="flex items-center gap-3 text-xs text-ink-faint">
                <span className="tabular">{env.inline.length} keys</span>
                <ChevronRight className="h-4 w-4" />
              </span>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function ObjectRow({ base, object }: { base: string; object: EnvObject }) {
  const isSecret = object.source === "secret";
  return (
    <Link
      href={`${base}/env/${object.name}`}
      className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3.5 shadow text-card-foreground transition-colors hover:bg-line-soft"
    >
      <span className="flex items-center gap-3">
        <span className={cxDot(isSecret ? "bg-pf-gold" : "bg-pf-blue")} />
        <span className="font-mono text-sm text-ink">{object.name}</span>
        <Badge
          variant="outline"
          className={
            isSecret
              ? "border-pf-gold/30 bg-pf-gold-50 text-[#8a6d00]"
              : "border-pf-blue/30 bg-pf-blue-50 text-pf-blue"
          }
        >
          {isSecret ? "Secret" : "ConfigMap"}
        </Badge>
      </span>
      <span className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="tabular">{object.data.length} keys</span>
        <ChevronRight className="h-4 w-4" />
      </span>
    </Link>
  );
}

function cxDot(color: string) {
  return `h-2 w-2 rounded-full ${color}`;
}
