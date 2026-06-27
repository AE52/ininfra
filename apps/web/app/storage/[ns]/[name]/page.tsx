"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  FileContent,
  Namespace,
  Page as ApiPage,
  PvcFile,
} from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { PageHeader, EmptyState } from "@/components/ui";
import { cx, fmtBytes, fmtTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

/** Normalize a path to a single leading slash, no trailing slash (except root). */
function normalizePath(p: string): string {
  if (!p || p === "/") return "/";
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Parent directory of a path ("/a/b/c" → "/a/b", "/a" → "/"). */
function parentPath(p: string): string {
  const norm = normalizePath(p);
  if (norm === "/") return "/";
  const idx = norm.lastIndexOf("/");
  return idx <= 0 ? "/" : norm.slice(0, idx);
}

/** Split a path into [{name, path}] ancestor crumbs (excluding the root). */
function segments(p: string): Array<{ name: string; path: string }> {
  const norm = normalizePath(p);
  if (norm === "/") return [];
  const parts = norm.split("/").filter(Boolean);
  const out: Array<{ name: string; path: string }> = [];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    out.push({ name: part, path: acc });
  }
  return out;
}

type KindMeta = { glyph: string; cls: string };
const kindMeta: Record<PvcFile["kind"], KindMeta> = {
  dir: { glyph: "📁", cls: "text-pf-blue" },
  file: { glyph: "📄", cls: "text-ink-soft" },
  symlink: { glyph: "🔗", cls: "text-pf-gold" },
  other: { glyph: "▪", cls: "text-ink-faint" },
};

export default function PvcBrowserPage() {
  const routeParams = useParams<{ ns: string; name: string }>();
  const ns = routeParams.ns as Namespace;
  const name = routeParams.name;

  const [path, setPath] = useState("/");
  const [page, setPage] = useState<ApiPage<PvcFile> | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  /** Distinguishes "no pod mounts this PVC" (a friendly empty state) from generic errors. */
  const [noMount, setNoMount] = useState(false);
  const [loading, setLoading] = useState(false);

  // Cursor stack: index N holds the cursor used to fetch the page currently shown
  // at depth N. The current page's cursor is the last element (undefined = first page).
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([
    undefined,
  ]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [roleResolved, setRoleResolved] = useState(false);

  // Viewer state.
  const [selected, setSelected] = useState<PvcFile | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState("");
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Resolve the current role once.
  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((m) => {
        if (!cancelled) setIsAdmin(m.role === "admin");
      })
      .catch(() => {
        if (!cancelled) setIsAdmin(false);
      })
      .finally(() => {
        if (!cancelled) setRoleResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchPage = useCallback(
    async (targetPath: string, cursor: string | undefined) => {
      setLoading(true);
      setListError(null);
      setNoMount(false);
      try {
        const res = await api.listPvcFiles(ns, name, {
          path: targetPath,
          cursor,
        });
        setPage(res);
      } catch (e) {
        setPage(null);
        if (e instanceof ApiClientError) {
          // 400 with the "no running pod mounts claim" message → friendly state.
          if (e.status === 400 && /pod|mounts|claim/i.test(e.message)) {
            setNoMount(true);
          } else {
            setListError(`${e.code}: ${e.message}`);
          }
        } else {
          setListError(String(e));
        }
      } finally {
        setLoading(false);
      }
    },
    [ns, name],
  );

  // Re-fetch whenever the path changes; reset cursor stack to the first page.
  useEffect(() => {
    setCursorStack([undefined]);
    setSelected(null);
    setContent(null);
    setViewerError(null);
    fetchPage(path, undefined);
  }, [path, fetchPage]);

  const navigateTo = (p: string) => {
    setNotice(null);
    setPath(normalizePath(p));
  };

  const goNext = () => {
    if (!page?.nextCursor) return;
    const next = page.nextCursor;
    setCursorStack((s) => [...s, next]);
    fetchPage(path, next);
  };

  const goPrev = () => {
    if (cursorStack.length <= 1) return;
    const nextStack = cursorStack.slice(0, -1);
    setCursorStack(nextStack);
    fetchPage(path, nextStack[nextStack.length - 1]);
  };

  const openFile = useCallback(
    async (f: PvcFile) => {
      setSelected(f);
      setContent(null);
      setDraft("");
      setViewerError(null);
      setNotice(null);
      setViewerLoading(true);
      try {
        const fc = await api.readPvcFile(ns, name, f.path);
        setContent(fc);
        setDraft(fc.content);
      } catch (e) {
        setViewerError(
          e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
        );
      } finally {
        setViewerLoading(false);
      }
    },
    [ns, name],
  );

  const onRowClick = (f: PvcFile) => {
    if (f.kind === "dir") {
      navigateTo(f.path);
    } else if (f.kind === "file") {
      openFile(f);
    }
    // symlinks/other: not navigable/openable here.
  };

  const save = async () => {
    if (!selected || !content) return;
    setBusy(true);
    setViewerError(null);
    setNotice(null);
    try {
      await api.writePvcFile(ns, name, selected.path, { content: draft });
      setContent({ ...content, content: draft });
      setNotice(`Saved ${selected.name}`);
    } catch (e) {
      setViewerError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected) return;
    if (
      !window.confirm(
        `Delete "${selected.path}"? This permanently removes the file from the volume.`,
      )
    ) {
      return;
    }
    const deletedName = selected.name;
    setBusy(true);
    setViewerError(null);
    setNotice(null);
    try {
      await api.deletePvcFile(ns, name, selected.path);
      setSelected(null);
      setContent(null);
      setNotice(`Deleted ${deletedName}`);
      // Refresh the listing at the current page.
      await fetchPage(path, cursorStack[cursorStack.length - 1]);
    } catch (e) {
      setViewerError(
        e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const crumbs = segments(path);
  const atRoot = normalizePath(path) === "/";
  const items = page?.items ?? [];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        kicker={
          <Link href="/storage" className="hover:text-pf-blue">
            Storage
          </Link>
        }
        title={name}
        subtitle={
          <span className="font-mono text-xs text-ink-faint">{ns}</span>
        }
      />

      {notice && (
        <Card className="border-pf-green/30 bg-pf-green-50 px-4 py-2.5 text-sm text-pf-green">
          {notice}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---- Listing ---- */}
        <section className="min-w-0 space-y-3">
          {/* Path breadcrumb + up button */}
          <Card className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigateTo(parentPath(path))}
              disabled={atRoot}
              className="h-7 px-2 text-xs"
              title="Up one level"
            >
              ..
            </Button>
            <button
              type="button"
              onClick={() => navigateTo("/")}
              className={cx(
                "rounded px-1.5 py-0.5 font-mono transition-colors hover:bg-line-soft",
                atRoot ? "text-ink" : "text-pf-blue",
              )}
            >
              /
            </button>
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1.5">
                <span className="text-ink-faint">/</span>
                <button
                  type="button"
                  onClick={() => navigateTo(c.path)}
                  className={cx(
                    "rounded px-1.5 py-0.5 font-mono transition-colors hover:bg-line-soft",
                    i === crumbs.length - 1 ? "text-ink" : "text-pf-blue",
                  )}
                >
                  {c.name}
                </button>
              </span>
            ))}
          </Card>

          {listError && (
            <Card className="border-pf-red/30 bg-pf-red-50 px-4 py-3 text-sm text-pf-red">
              <span className="font-mono text-xs">{listError}</span>
            </Card>
          )}

          {noMount && (
            <EmptyState
              title="No live pod mounts this volume"
              body="Browsing files requires a running pod that currently mounts this PersistentVolumeClaim — the console reads the filesystem by executing into that pod. Start or scale up a workload that uses this PVC, then reload."
            />
          )}

          {!listError && !noMount && (
            <>
              <div className="overflow-x-auto rounded-lg border border-line">
                <Table className="text-sm">
                  <TableHeader className="bg-line-soft text-left text-xs uppercase tracking-wider text-ink-faint">
                    <TableRow>
                      <TableHead className="px-4 py-2.5">Name</TableHead>
                      <TableHead className="px-4 py-2.5">Size</TableHead>
                      <TableHead className="px-4 py-2.5">Mode</TableHead>
                      <TableHead className="px-4 py-2.5">Modified</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-line">
                    {items.map((f) => {
                      const meta = kindMeta[f.kind];
                      const clickable = f.kind === "dir" || f.kind === "file";
                      const isSelected =
                        f.kind === "file" && selected?.path === f.path;
                      return (
                        <TableRow
                          key={f.path}
                          onClick={() => clickable && onRowClick(f)}
                          className={cx(
                            "transition-colors",
                            clickable && "cursor-pointer hover:bg-line-soft",
                            isSelected && "bg-pf-blue-50",
                          )}
                        >
                          <TableCell className="px-4 py-2.5">
                            <span className="flex items-center gap-2">
                              <span className={meta.cls} aria-hidden>
                                {meta.glyph}
                              </span>
                              <span className="truncate font-medium text-ink-soft">
                                {f.name}
                                {f.kind === "symlink" && (
                                  <span className="ml-1 font-mono text-[11px] text-ink-faint">
                                    → {f.linkTarget ?? "?"}
                                  </span>
                                )}
                              </span>
                            </span>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 font-mono text-xs text-ink-soft">
                            {f.kind === "file" && f.size != null
                              ? fmtBytes(f.size)
                              : "—"}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 font-mono text-[11px] text-ink-faint">
                            {f.mode || "—"}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-xs text-ink-muted">
                            {fmtTime(f.modifiedAt)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {items.length === 0 && !loading && (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="px-4 py-10 text-center text-sm text-ink-faint"
                        >
                          Empty directory.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between text-xs text-ink-faint">
                <span className="tabular">
                  {loading
                    ? "Loading…"
                    : page?.total != null
                      ? `${items.length} shown · ${page.total} total`
                      : `${items.length} item(s)`}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={goPrev}
                    disabled={cursorStack.length <= 1 || loading}
                    className="h-7 text-xs"
                  >
                    Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={goNext}
                    disabled={!page?.nextCursor || loading}
                    className="h-7 text-xs"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>

        {/* ---- Viewer ---- */}
        <section className="min-w-0">
          {!selected ? (
            <Card className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <div className="text-sm font-semibold text-ink">No file open</div>
              <div className="max-w-xs text-sm text-ink-muted">
                Select a file from the listing to view{" "}
                {isAdmin ? "or edit" : ""} its contents.
              </div>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink-soft">
                  {selected.path}
                </span>
                {roleResolved && !isAdmin && (
                  <Badge
                    variant="outline"
                    className="border-line bg-line-soft font-normal text-ink-muted"
                  >
                    Read-only (viewer)
                  </Badge>
                )}
                {isAdmin &&
                  content &&
                  !content.binary && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={save}
                      disabled={busy || draft === content.content}
                      className="h-7 text-xs"
                    >
                      {busy ? "Saving…" : "Save"}
                    </Button>
                  )}
                {isAdmin && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={remove}
                    disabled={busy}
                    className="h-7 text-xs"
                  >
                    Delete
                  </Button>
                )}
              </div>

              {viewerError && (
                <div className="border-b border-line bg-pf-red-50 px-3 py-2 font-mono text-xs text-pf-red">
                  {viewerError}
                </div>
              )}

              {viewerLoading && (
                <div className="px-4 py-10 text-center text-sm text-ink-faint">
                  Loading file…
                </div>
              )}

              {!viewerLoading && content && (
                <>
                  {content.truncated && (
                    <div className="border-b border-line bg-pf-gold-50 px-3 py-2 text-xs text-[#8a6d00]">
                      File exceeds the read limit — showing a partial view.
                      Saving would overwrite the whole file, so editing is
                      disabled here.
                    </div>
                  )}
                  {content.binary ? (
                    <div className="logwell flex h-[420px] items-center justify-center bg-[#1b1d21] font-mono text-sm text-[#8a8d90]">
                      Binary file — not shown
                    </div>
                  ) : isAdmin && !content.truncated ? (
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck={false}
                      className="logwell h-[420px] w-full resize-y bg-[#1b1d21] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#f0f0f0] focus:outline-none"
                    />
                  ) : (
                    <pre className="logwell h-[420px] overflow-auto whitespace-pre-wrap break-all bg-[#1b1d21] px-4 py-3 font-mono text-[12.5px] leading-relaxed text-[#f0f0f0]">
                      {content.content}
                    </pre>
                  )}
                  <div className="flex items-center justify-between border-t border-line px-3 py-1.5 text-[11px] text-ink-faint">
                    <span className="tabular">{fmtBytes(content.size)}</span>
                    {content.binary && <span>binary</span>}
                  </div>
                </>
              )}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
