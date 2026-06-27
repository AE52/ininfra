"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import type {
  DeployInfo,
  EcrImage,
  Namespace,
  Page,
  RevisionInfo,
} from "@ininfra/shared-types";
import { Trash2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { fmtBytes, fmtTime, timeAgo } from "@/lib/format";
import { PageHeader, EmptyState } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/Toast";

const IMAGES_PAGE_SIZE = 25;

function errMsg(e: unknown): string {
  return e instanceof ApiClientError ? e.message : String(e);
}

/** Truncate a digest like "sha256:abcdef…" to a compact mono form. */
function shortDigest(digest: string | null): string {
  if (!digest) return "—";
  const hex = digest.includes(":") ? digest.split(":")[1] : digest;
  return hex.slice(0, 12);
}

/**
 * Build a commit URL from a repoUrl, when it looks like a GitHub repo.
 * Strips a trailing ".git". Returns null when no useful link can be built.
 */
function commitUrl(repoUrl: string | null, commit: string | null): string | null {
  if (!repoUrl || !commit) return null;
  const base = repoUrl.replace(/\.git$/, "").replace(/\/$/, "");
  if (!/github\.com/i.test(base)) return null;
  return `${base}/commit/${commit}`;
}

export default function DeployPage() {
  const params = useParams<{ ns: string; name: string }>();
  const ns = params.ns as Namespace;
  const name = params.name;
  const toast = useToast();

  const [role, setRole] = useState<string | null>(null);
  const [meReady, setMeReady] = useState(false);

  const [info, setInfo] = useState<DeployInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadDeploy = useCallback(async () => {
    setLoadErr(null);
    try {
      const di = await api.getDeploy(ns, name);
      setInfo(di);
    } catch (e) {
      setLoadErr(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [ns, name]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const me = await api.me();
        if (alive) setRole(me.role);
      } catch {
        /* role stays null → read-only */
      } finally {
        if (alive) setMeReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void loadDeploy();
  }, [loadDeploy]);

  const isAdmin = role === "admin";

  const header = (
    <PageHeader
      kicker={
        <Link href={`/services/${ns}/${name}`} className="hover:text-pf-blue">
          {name}
        </Link>
      }
      title="Deploy"
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{name}</span>
          <span className="text-ink-faint">·</span>
          <span className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
            {ns}
          </span>
        </span>
      }
    />
  );

  if (loading || !meReady) {
    return (
      <div className="animate-fade-in">
        {header}
        <Card className="p-12 text-center text-sm text-ink-faint">
          Loading…
        </Card>
      </div>
    );
  }

  if (loadErr || !info) {
    return (
      <div className="animate-fade-in">
        {header}
        <div className="rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-3 text-sm text-pf-red">
          {loadErr ?? "Deploy information is unavailable."}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      {!isAdmin && (
        <div className="rounded-pf border border-line bg-line-soft px-4 py-2 text-xs text-ink-muted">
          Read-only (viewer) — release actions are disabled.
        </div>
      )}

      <CurrentRelease info={info} isAdmin={isAdmin} toast={toast} />

      <RevisionHistory
        ns={ns}
        name={name}
        revisions={info.revisions}
        isAdmin={isAdmin}
        toast={toast}
        onChanged={loadDeploy}
      />

      <ImagesSection
        ns={ns}
        name={name}
        ecrEnabled={info.ecrEnabled}
        isAdmin={isAdmin}
        toast={toast}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Current release                                                   */
/* ---------------------------------------------------------------- */

function CurrentRelease({
  info,
  isAdmin,
  toast,
}: {
  info: DeployInfo;
  isAdmin: boolean;
  toast: (tone: "success" | "error" | "info", text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const link = commitUrl(info.repoUrl, info.commit);

  async function trigger() {
    setBusy(true);
    try {
      const ack = await api.triggerDeployBuild(info.namespace, info.workload);
      toast(
        "success",
        ack.message ?? `Build triggered for ${info.workload}`,
      );
    } catch (e) {
      toast("error", `Trigger build failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 className="label-kicker">Current release</h2>
        {isAdmin ? (
          <Button type="button" size="sm" onClick={trigger} disabled={busy}>
            {busy ? "Triggering…" : "Trigger build"}
          </Button>
        ) : (
          <span className="text-xs text-ink-faint">Read-only (viewer)</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <Field label="Commit">
          {info.commit ? (
            link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm text-pf-blue hover:underline"
              >
                {info.commit.slice(0, 12)}
              </a>
            ) : (
              <span className="font-mono text-sm text-ink">
                {info.commit.slice(0, 12)}
              </span>
            )
          ) : (
            <span className="flex flex-wrap items-baseline gap-2">
              <span className="text-ink-faint">—</span>
              {!info.ecrEnabled && (
                <span className="text-[11px] text-ink-faint">
                  connect ECR to resolve commit
                </span>
              )}
            </span>
          )}
        </Field>

        <Field label="Image tag">
          {info.imageTag ? (
            <span className="font-mono text-sm text-ink">{info.imageTag}</span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Field>

        <Field label="Image digest">
          {info.imageDigest ? (
            <span
              className="font-mono text-sm text-ink"
              title={info.imageDigest}
            >
              {shortDigest(info.imageDigest)}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Field>

        <Field label="Revision">
          {info.revision != null ? (
            <span className="tabular font-mono text-sm text-ink">
              #{info.revision}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Field>

        <Field label="Jenkins job">
          <span className="font-mono text-sm text-ink">{info.jenkinsJob}</span>
        </Field>

        <Field label="Registry">
          {info.registry ? (
            <span
              className="truncate font-mono text-xs text-ink-soft"
              title={info.repo ? `${info.registry}/${info.repo}` : info.registry}
            >
              {info.repo ?? info.registry}
            </span>
          ) : (
            <span className="text-ink-faint">—</span>
          )}
        </Field>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="label-kicker mb-1">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Revision history                                                  */
/* ---------------------------------------------------------------- */

function RevisionHistory({
  ns,
  name,
  revisions,
  isAdmin,
  toast,
  onChanged,
}: {
  ns: Namespace;
  name: string;
  revisions: RevisionInfo[];
  isAdmin: boolean;
  toast: (tone: "success" | "error" | "info", text: string) => void;
  onChanged: () => Promise<void>;
}) {
  return (
    <section>
      <h2 className="label-kicker mb-3">Revision history</h2>
      {revisions.length === 0 ? (
        <EmptyState title="No revisions" body="No rollout history is available." />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Revision</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Commit / Tag</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Image digest</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Created</TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium text-ink-faint">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.map((r) => (
                  <RevisionRow
                    key={r.revision}
                    ns={ns}
                    name={name}
                    rev={r}
                    isAdmin={isAdmin}
                    toast={toast}
                    onChanged={onChanged}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </section>
  );
}

function RevisionRow({
  ns,
  name,
  rev,
  isAdmin,
  toast,
  onChanged,
}: {
  ns: Namespace;
  name: string;
  rev: RevisionInfo;
  isAdmin: boolean;
  toast: (tone: "success" | "error" | "info", text: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function rollback() {
    if (
      !window.confirm(
        `Roll back ${name} to revision #${rev.revision}? This redeploys the prior image.`,
      )
    )
      return;
    setBusy(true);
    try {
      const ack = await api.rollbackDeploy(ns, name, rev.revision);
      toast(
        "success",
        ack.message ?? `Rolled back to revision #${rev.revision}`,
      );
      await onChanged();
    } catch (e) {
      toast("error", `Rollback failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3">
        <span className="flex items-center gap-2">
          <span className="tabular font-mono text-ink">#{rev.revision}</span>
          {rev.current && (
            <Badge
              variant="outline"
              className="border-pf-green/30 bg-pf-green-50 text-pf-green"
            >
              current
            </Badge>
          )}
        </span>
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-ink">
            {rev.commit ?? <span className="text-ink-faint">—</span>}
          </span>
          {rev.imageTag && (
            <span className="font-mono text-[11px] text-ink-faint">
              {rev.imageTag}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 font-mono text-xs text-ink-muted" title={rev.imageDigest ?? undefined}>
        {shortDigest(rev.imageDigest)}
      </TableCell>
      <TableCell className="px-4 py-3 text-xs text-ink-muted" title={fmtTime(rev.createdAt)}>
        {timeAgo(rev.createdAt)}
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {rev.current ? (
            <span className="text-xs text-ink-faint">—</span>
          ) : isAdmin ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2"
              onClick={rollback}
              disabled={busy}
            >
              {busy ? "Rolling back…" : "Rollback to this"}
            </Button>
          ) : (
            <span className="text-xs text-ink-faint">Read-only (viewer)</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ---------------------------------------------------------------- */
/* Images (ECR)                                                      */
/* ---------------------------------------------------------------- */

function ImagesSection({
  ns,
  name,
  ecrEnabled,
  isAdmin,
  toast,
}: {
  ns: Namespace;
  name: string;
  ecrEnabled: boolean;
  isAdmin: boolean;
  toast: (tone: "success" | "error" | "info", text: string) => void;
}) {
  if (!ecrEnabled) {
    return (
      <section>
        <h2 className="label-kicker mb-3">Images (ECR)</h2>
        <Card className="px-4 py-3 text-sm text-ink-muted">
          ECR access is not configured — image inventory and delete are
          unavailable.
        </Card>
      </section>
    );
  }
  return (
    <ImagesTable
      ns={ns}
      name={name}
      isAdmin={isAdmin}
      toast={toast}
    />
  );
}

function ImagesTable({
  ns,
  name,
  isAdmin,
  toast,
}: {
  ns: Namespace;
  name: string;
  isAdmin: boolean;
  toast: (tone: "success" | "error" | "info", text: string) => void;
}) {
  const [items, setItems] = useState<EcrImage[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Stack of cursors to reach the current page (last entry = current).
  const [stack, setStack] = useState<Array<string | null>>([null]);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      setLoading(true);
      setListErr(null);
      try {
        const page: Page<EcrImage> = await api.listDeployImages(ns, name, {
          cursor: cursor ?? undefined,
          limit: IMAGES_PAGE_SIZE,
        });
        setItems(page.items);
        setNextCursor(page.nextCursor);
      } catch (e) {
        setListErr(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    [ns, name],
  );

  const reload = useCallback(() => {
    return load(stack[stack.length - 1]);
  }, [load, stack]);

  useEffect(() => {
    void load(null);
  }, [load]);

  function goNext() {
    if (!nextCursor) return;
    const cursor = nextCursor;
    setStack((s) => [...s, cursor]);
    void load(cursor);
  }

  function goPrev() {
    if (stack.length <= 1) return;
    const next = stack.slice(0, -1);
    setStack(next);
    void load(next[next.length - 1]);
  }

  const hasPrev = stack.length > 1;

  return (
    <section>
      <h2 className="label-kicker mb-3">Images (ECR)</h2>

      {listErr && (
        <div className="mb-3 rounded-pf border border-pf-red/30 bg-pf-red-50 px-4 py-2.5 text-sm text-pf-red">
          {listErr}
        </div>
      )}

      {items.length === 0 && !loading && !listErr ? (
        <EmptyState
          title="No images"
          body="No images were found in the ECR repository."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-faint hover:bg-transparent">
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Tag(s)</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Commit</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Pushed</TableHead>
                  <TableHead className="px-4 py-2.5 font-medium text-ink-faint">Size</TableHead>
                  <TableHead className="px-4 py-2.5 text-right font-medium text-ink-faint">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((img) => (
                  <ImageRow
                    key={img.digest}
                    ns={ns}
                    name={name}
                    img={img}
                    isAdmin={isAdmin}
                    toast={toast}
                    onChanged={reload}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-faint">
          {loading ? "Loading…" : `${items.length} shown`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goPrev}
            disabled={!hasPrev || loading}
          >
            Prev
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goNext}
            disabled={!nextCursor || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </section>
  );
}

function ImageRow({
  ns,
  name,
  img,
  isAdmin,
  toast,
  onChanged,
}: {
  ns: Namespace;
  name: string;
  img: EcrImage;
  isAdmin: boolean;
  toast: (tone: "success" | "error" | "info", text: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (
      !window.confirm(
        `Delete image ${shortDigest(img.digest)} from ECR? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    try {
      const ack = await api.deleteDeployImage(ns, name, img.digest);
      toast("success", ack.message ?? `Deleted image ${shortDigest(img.digest)}`);
      onChanged();
    } catch (e) {
      toast("error", `Delete failed: ${errMsg(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow className="border-b border-line transition-colors last:border-0 hover:bg-line-soft">
      <TableCell className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {img.tags.length > 0 ? (
            img.tags.map((t) => (
              <span
                key={t}
                className="rounded border border-line bg-line-soft px-1.5 py-0.5 font-mono text-[11px] text-ink-soft"
              >
                {t}
              </span>
            ))
          ) : (
            <span className="font-mono text-xs text-ink-faint" title={img.digest}>
              {shortDigest(img.digest)}
            </span>
          )}
          {img.deployed && (
            <Badge
              variant="outline"
              className="border-pf-blue/30 bg-pf-blue-50 text-pf-blue"
            >
              deployed
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="px-4 py-3 font-mono text-xs text-ink">
        {img.commit ?? <span className="text-ink-faint">—</span>}
      </TableCell>
      <TableCell className="px-4 py-3 text-xs text-ink-muted" title={img.pushedAt ? fmtTime(img.pushedAt) : undefined}>
        {img.pushedAt ? timeAgo(img.pushedAt) : "—"}
      </TableCell>
      <TableCell className="px-4 py-3 tabular font-mono text-xs text-ink-muted">
        {img.sizeBytes != null ? fmtBytes(img.sizeBytes ?? 0) : "—"}
      </TableCell>
      <TableCell className="px-4 py-3">
        <div className="flex items-center justify-end gap-1.5">
          {isAdmin ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-7 px-2"
              onClick={remove}
              disabled={busy || img.deployed}
              title={
                img.deployed
                  ? "Refusing to delete the currently deployed image"
                  : undefined
              }
            >
              <Trash2 />
              Delete
            </Button>
          ) : (
            <span className="text-xs text-ink-faint">Read-only (viewer)</span>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}
