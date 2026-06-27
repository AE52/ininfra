import Link from "next/link";
import { notFound } from "next/navigation";
import type { EnvBundle, EnvObject, Namespace } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { PageHeader } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { ErrorPanel } from "@/components/ErrorPanel";
import { EnvObjectEditor } from "@/components/EnvObjectEditor";
import { InlineEnvViewer } from "@/components/InlineEnvViewer";

export const dynamic = "force-dynamic";

export default async function EnvObjectPage({
  params,
}: {
  params: Promise<{ ns: string; name: string; object: string }>;
}) {
  const { ns: nsRaw, name, object: objectRaw } = await params;
  const ns = nsRaw as Namespace;
  const objectName = decodeURIComponent(objectRaw);
  const base = `/services/${ns}/${name}`;
  const envBase = `${base}/env`;
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
            <Link href={envBase} className="hover:text-pf-blue">
              Environment
            </Link>
          }
          title={objectName}
        />
        <ErrorPanel
          message={e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e)}
        />
      </div>
    );
  }

  const kicker = (
    <Link href={envBase} className="hover:text-pf-blue">
      {name} · Environment
    </Link>
  );

  if (objectName === "inline") {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader
          kicker={kicker}
          title={
            <span className="flex items-center gap-3">
              inline
              <Badge
                variant="outline"
                className="border-line bg-line-soft text-ink-muted"
              >
                Inline
              </Badge>
            </span>
          }
          subtitle={
            <span className="text-sm text-ink-muted">
              {env.inline.length} variable(s) declared directly on the container.
            </span>
          }
        />
        <InlineEnvViewer ns={ns} workload={name} initial={env.inline} />
      </div>
    );
  }

  const object: EnvObject | undefined =
    env.configMaps.find((o) => o.name === objectName) ??
    env.secrets.find((o) => o.name === objectName);

  if (!object) notFound();

  const isSecret = object.source === "secret";

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        kicker={kicker}
        title={
          <span className="flex items-center gap-3">
            <span className="font-mono">{object.name}</span>
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
        }
        subtitle={
          <span className="text-sm text-ink-muted">
            {object.data.length} key(s) backing this workload&apos;s environment.
          </span>
        }
      />
      <EnvObjectEditor ns={ns} workload={name} object={object} />
    </div>
  );
}
