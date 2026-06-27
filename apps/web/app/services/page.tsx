import Link from "next/link";
import type { Service, Namespace } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { getAppConfig } from "@/lib/config";
import { ApiClientError } from "@/lib/api";
import { cx, shortImage, timeAgo } from "@/lib/format";
import { PageHeader, EmptyState, NamespaceTag } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { HealthBadge } from "@/components/StatusBadge";
import { ErrorPanel } from "@/components/ErrorPanel";
import { CursorPager } from "@/components/Pager";

export const dynamic = "force-dynamic";

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ ns?: string; c?: string }>;
}) {
  const { ns, c } = await searchParams;
  const { managedNamespaces } = await getAppConfig();
  const filterNs: Namespace | undefined =
    ns && managedNamespaces.includes(ns) ? ns : undefined;
  const cursor = c?.split(",").filter(Boolean).at(-1);

  let services: Service[] = [];
  let nextCursor: string | null = null;
  let total: number | null | undefined;
  let error: string | null = null;
  try {
    const api = await getServerApi();
    const page = await api.listServices(filterNs, { cursor });
    services = page.items;
    nextCursor = page.nextCursor;
    total = page.total;
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Workloads"
        title="Services"
        subtitle="Every Deployment + Service the console can operate."
      />

      {/* Namespace filter */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button
          asChild
          size="sm"
          variant={!filterNs ? "default" : "outline"}
        >
          <Link href="/services">All namespaces</Link>
        </Button>
        {managedNamespaces.map((n) => (
          <Button
            key={n}
            asChild
            size="sm"
            variant={filterNs === n ? "default" : "outline"}
            className="font-mono"
          >
            <Link href={`/services?ns=${n}`}>{n}</Link>
          </Button>
        ))}
      </div>

      {error && <div className="mb-5"><ErrorPanel message={error} /></div>}

      {services.length === 0 && !error ? (
        <EmptyState title="No services" body="Nothing to show for this filter." />
      ) : (
        <Card className="overflow-hidden">
          <Table className="min-w-[720px] text-sm">
            <TableHeader>
              <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                <TableHead className="h-auto px-4 py-2.5 font-medium text-ink-faint">Service</TableHead>
                <TableHead className="h-auto px-4 py-2.5 font-medium text-ink-faint">Namespace</TableHead>
                <TableHead className="h-auto px-4 py-2.5 font-medium text-ink-faint">Image</TableHead>
                <TableHead className="h-auto px-4 py-2.5 font-medium text-ink-faint">Health</TableHead>
                <TableHead className="h-auto px-4 py-2.5 text-right font-medium text-ink-faint">Replicas</TableHead>
                <TableHead className="h-auto px-4 py-2.5 text-right font-medium text-ink-faint">Age</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => {
                const digestMatch = s.image.match(/^(.+)@sha256:([0-9a-f]+)$/i);
                const imageNode = digestMatch ? (
                  <span className="break-all">
                    <span>{digestMatch[1].split("/").pop() ?? digestMatch[1]}</span>
                    <span className="text-ink-faint">@sha256:</span>
                    <span className="text-pf-blue">{digestMatch[2].slice(0, 12)}</span>
                    <span className="text-ink-faint">…</span>
                  </span>
                ) : (() => {
                  const { name, tag } = shortImage(s.image);
                  return (
                    <span className="break-all">
                      <span>{name}</span>
                      <span className="text-ink-faint">:</span>
                      <span className="text-pf-blue">{tag}</span>
                    </span>
                  );
                })();
                return (
                  <TableRow
                    key={`${s.namespace}/${s.name}`}
                    className="border-b border-line transition-colors last:border-0 hover:bg-line-soft"
                  >
                    <TableCell className="px-4 py-3">
                      <Link
                        href={`/services/${s.namespace}/${s.name}`}
                        className="font-medium text-ink hover:text-pf-blue"
                      >
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <NamespaceTag ns={s.namespace} />
                    </TableCell>
                    <TableCell className="max-w-[220px] px-4 py-3 font-mono text-xs text-ink-muted">
                      {imageNode}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <HealthBadge status={s.health} />
                    </TableCell>
                    <TableCell className="tabular px-4 py-3 text-right font-mono text-xs">
                      <span className={cx(s.replicasReady < s.replicasDesired && "text-[#8a6d00]")}>
                        {s.replicasReady}
                      </span>
                      <span className="text-ink-faint">/{s.replicasDesired}</span>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-xs text-ink-faint">
                      {timeAgo(s.createdAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {!error && services.length > 0 && (
        <CursorPager nextCursor={nextCursor} total={total} shown={services.length} />
      )}
    </div>
  );
}
