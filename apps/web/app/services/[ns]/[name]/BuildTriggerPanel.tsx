"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";

/**
 * Two-mode build trigger for a specific service:
 *
 * 1. Quick trigger — calls `triggerDeployBuild(ns, name)` which re-runs the
 *    last deployed commit.  No form needed.
 *
 * 2. Custom trigger — calls `submitBuild({ repo, branch, sha })` which lets
 *    you pick an exact commit sha. Repo and branch are pre-filled from the
 *    build catalog.
 */
export function BuildTriggerPanel({
  ns,
  serviceName,
  repo,
  branch,
}: {
  ns: string;
  serviceName: string;
  repo: string | null;
  branch: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [showCustom, setShowCustom] = useState(false);
  const [customRepo, setCustomRepo] = useState(repo ?? "");
  const [customBranch, setCustomBranch] = useState(branch ?? "master");
  const [sha, setSha] = useState("");
  const [busy, setBusy] = useState(false);

  async function quickTrigger() {
    setBusy(true);
    try {
      const ack = await api.triggerDeployBuild(ns, serviceName);
      toast("success", ack.message ?? `Build triggered for ${serviceName}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Trigger failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitCustom() {
    const r = customRepo.trim();
    const b = customBranch.trim();
    const s = sha.trim();
    if (!r || !b || !s) {
      toast("error", "Repository, branch, and commit SHA are all required.");
      return;
    }
    if (!r.includes("/")) {
      toast("error", "Repository must be in owner/name form.");
      return;
    }
    setBusy(true);
    try {
      const job = await api.submitBuild({ repo: r, branch: b, sha: s });
      toast("success", `Submitted: ${job.job} (${job.status})`);
      setSha("");
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Submit failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="label-kicker">Trigger build</h3>
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          className="text-[11px] text-ink-faint hover:text-pf-blue"
        >
          {showCustom ? "Quick trigger" : "Custom commit…"}
        </button>
      </div>

      {!showCustom ? (
        <>
          <p className="mb-4 text-xs text-ink-muted">
            Re-runs the build for the current deploy branch. The pipeline
            redeploys only if the branch matches the catalog entry.
          </p>
          <Button
            type="button"
            onClick={quickTrigger}
            disabled={busy}
            className="w-full"
          >
            {busy ? "Triggering…" : "Trigger build now"}
          </Button>
        </>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="mb-1 block text-xs text-ink-muted">
              Repository (owner/name)
            </span>
            <Input
              value={customRepo}
              onChange={(e) => setCustomRepo(e.target.value)}
              placeholder="mytech-technology/journal-settings"
              className="w-full font-mono"
            />
          </label>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-muted">Branch</span>
              <Input
                value={customBranch}
                onChange={(e) => setCustomBranch(e.target.value)}
                placeholder="master"
                className="w-full font-mono"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-ink-muted">
                Commit SHA
              </span>
              <Input
                value={sha}
                onChange={(e) => setSha(e.target.value)}
                placeholder="full 40-char sha"
                className="w-full font-mono"
              />
            </label>
          </div>

          <Button
            type="button"
            onClick={submitCustom}
            disabled={busy}
            className="w-full"
          >
            {busy ? "Submitting…" : "Submit build"}
          </Button>
        </>
      )}
    </Card>
  );
}
