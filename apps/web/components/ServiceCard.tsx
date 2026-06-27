import Link from "next/link";
import type { Service } from "@ininfra/shared-types";
import { cx, shortImage, timeAgo } from "@/lib/format";
import { HealthBadge } from "@/components/StatusBadge";
import { FavoriteStar } from "@/components/FavoriteStar";
import { Meter, NamespaceTag } from "@/components/ui";
import { Card } from "@/components/ui/card";

/**
 * Parses an image ref that may contain a digest (`@sha256:<hex>`) or a plain
 * tag, and renders it in a compact, overflow-safe way.
 *
 * Examples handled:
 *   my-service@sha256:5cc2f1de52d5246b85252...  → name + @sha256:5cc2f1de…
 *   123456789.dkr.ecr.eu-west-1.amazonaws.com/foo:bar → foo:bar
 */
function ImageRef({ image }: { image: string }) {
  // Digest form: <repo>@sha256:<hex>
  const digestMatch = image.match(/^(.+)@sha256:([0-9a-f]+)$/i);
  if (digestMatch) {
    const repoPath = digestMatch[1];
    const digest = digestMatch[2];
    const repoName = repoPath.split("/").pop() ?? repoPath;
    const shortDigest = digest.slice(0, 12);
    return (
      <span className="break-all">
        <span className="text-ink-soft">{repoName}</span>
        <span className="text-ink-faint">@sha256:</span>
        <span className="text-pf-blue">{shortDigest}</span>
        <span className="text-ink-faint">…</span>
      </span>
    );
  }

  // Plain tag form (shortImage handles registry stripping)
  const { name, tag } = shortImage(image);
  return (
    <span className="break-all">
      <span className="text-ink-soft">{name}</span>
      <span className="text-ink-faint">:</span>
      <span className="text-pf-blue">{tag}</span>
    </span>
  );
}

export function ServiceCard({ svc }: { svc: Service }) {
  const ratio = svc.replicasDesired > 0 ? svc.replicasReady / svc.replicasDesired : 0;
  const tone =
    svc.health === "degraded"
      ? "rose"
      : svc.health === "progressing"
        ? "amber"
        : "lime";

  return (
    <Link
      href={`/services/${svc.namespace}/${svc.name}`}
      className="group block h-full"
    >
      <Card className="relative flex h-full flex-col gap-3 p-4 transition-all group-hover:border-pf-blue/50 group-hover:shadow-card-hover">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold tracking-tight text-ink group-hover:text-pf-blue">
              {svc.name}
            </div>
            <div className="mt-1">
              <NamespaceTag ns={svc.namespace} />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <FavoriteStar
              kind="deployment"
              namespace={svc.namespace}
              name={svc.name}
              href={`/services/${svc.namespace}/${svc.name}`}
              className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 data-[favorited=true]:opacity-100 [&_svg]:h-3.5 [&_svg]:w-3.5"
            />
            <HealthBadge status={svc.health} />
          </div>
        </div>

        <div className="min-w-0 overflow-hidden font-mono text-xs text-ink-muted">
          <ImageRef image={svc.image} />
        </div>

        <div className="mt-auto space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-muted">replicas</span>
            <span className="tabular font-mono text-ink-soft">
              <span className={cx(ratio < 1 && "text-[#8a6d00]")}>
                {svc.replicasReady}
              </span>
              <span className="text-ink-faint"> / {svc.replicasDesired}</span>
            </span>
          </div>
          <Meter ratio={ratio} tone={tone} />
        </div>

        <div className="flex items-center justify-between text-[11px] text-ink-faint">
          <span>{svc.ports.length ? `${svc.ports.length} port(s)` : "no ports"}</span>
          <span>{timeAgo(svc.createdAt)}</span>
        </div>

        {svc.url && (
          <span className="absolute right-3 top-3 hidden h-2 w-2 rounded-full bg-pf-blue group-hover:block" title={svc.url} />
        )}
      </Card>
    </Link>
  );
}
