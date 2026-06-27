"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon } from "lucide-react";
import type { SearchKind, SearchResult } from "@ininfra/shared-types";
import { api } from "@/lib/api";
import { cx } from "@/lib/format";
import {
  ALL_KINDS,
  KIND_ICON,
  KIND_LABEL,
  KIND_ORDER,
  statusTone,
} from "@/lib/search-kind";
import { useConfig } from "@/components/ConfigProvider";
import { PageHeader, EmptyState } from "@/components/ui";
import { FavoriteStar } from "@/components/FavoriteStar";
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

const DEBOUNCE_MS = 200;
const ALL = "__all__";

export default function SearchPage() {
  const { managedNamespaces } = useConfig();

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>(ALL);
  const [namespace, setNamespace] = useState<string>(ALL);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(() => {
      api
        .search(q, {
          kind: kind === ALL ? undefined : kind,
          namespace: namespace === ALL ? undefined : namespace,
        })
        .then((res) => setResults(res))
        .catch(() => setResults([]))
        .finally(() => {
          setLoading(false);
          setSearched(true);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, kind, namespace]);

  // Sort results by canonical kind order, then by name, for a stable list.
  const sorted = useMemo(
    () =>
      [...results].sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
          a.name.localeCompare(b.name),
      ),
    [results],
  );

  const hasQuery = query.trim().length > 0;

  return (
    <div className="animate-fade-in">
      <PageHeader
        kicker="Home"
        title="Search"
        subtitle="Find any workload, pod, service, node, build, or user across the cluster."
      />

      {/* Filters. */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            autoFocus
            className="h-10 pl-9"
            aria-label="Search query"
          />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-10 sm:w-44" aria-label="Filter by kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All kinds</SelectItem>
            {ALL_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={namespace} onValueChange={setNamespace}>
          <SelectTrigger className="h-10 sm:w-52" aria-label="Filter by namespace">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All namespaces</SelectItem>
            {managedNamespaces.map((ns) => (
              <SelectItem key={ns} value={ns}>
                {ns}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!hasQuery ? (
        <EmptyState
          title="Start typing to search"
          body="Search by name across deployments, statefulsets, pods, services, nodes, builds and users. Narrow results with the kind and namespace filters."
        />
      ) : loading && sorted.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-faint">Searching…</Card>
      ) : searched && sorted.length === 0 ? (
        <EmptyState
          title="No results"
          body={`Nothing matched "${query.trim()}" with the current filters.`}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[720px] text-sm">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                  <TableHead className="w-10 px-4 py-2.5 font-medium" />
                  <TableHead className="px-4 py-2.5 font-medium">Name</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Kind</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Namespace</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium">Status</TableHead>
                  <TableHead className="w-12 px-4 py-2.5 text-right font-medium" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r) => (
                  <ResultRow
                    key={`${r.kind}/${r.namespace ?? ""}/${r.name}`}
                    r={r}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: SearchResult }) {
  const Icon = KIND_ICON[r.kind as SearchKind];
  const tone = statusTone(r.status);
  return (
    <TableRow className="group border-b border-line transition-colors last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3">
        <Icon className="h-4 w-4 text-ink-faint" />
      </TableCell>
      <TableCell className="px-4 py-3">
        <Link
          href={r.href}
          className="font-mono text-[13px] font-medium text-ink group-hover:text-pf-blue"
        >
          {r.name}
        </Link>
        {r.detail && (
          <div className="text-[11px] text-ink-faint">{r.detail}</div>
        )}
      </TableCell>
      <TableCell className="px-4 py-3 text-xs text-ink-muted">
        {KIND_LABEL[r.kind].replace(/s$/, "")}
      </TableCell>
      <TableCell className="px-4 py-3">
        {r.namespace ? (
          <span className="font-mono text-[11px] text-ink-muted">
            {r.namespace}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3">
        {r.status ? (
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[11px] font-medium",
              tone.bg,
              tone.text,
            )}
          >
            <span className={cx("h-1.5 w-1.5 rounded-full", tone.dot)} />
            {r.status}
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </TableCell>
      <TableCell className="px-4 py-3 text-right">
        <FavoriteStar
          kind={r.kind}
          namespace={r.namespace}
          name={r.name}
          href={r.href}
        />
      </TableCell>
    </TableRow>
  );
}
