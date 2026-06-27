"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BuildSubmit } from "@ininfra/shared-types";
import { api, ApiClientError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";

/**
 * Submit an Argo `cicd` build run. The pipeline only deploys when (repo, branch)
 * is the service's active catalog branch — otherwise the run is a no-op. Pushes
 * trigger builds automatically; this form is for re-running a specific commit.
 */
export function BuildTriggerForm({ repos }: { repos: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [branch, setBranch] = useState("master");
  const [sha, setSha] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body: BuildSubmit = {
      repo: repo.trim(),
      branch: branch.trim(),
      sha: sha.trim(),
    };
    if (!body.repo || !body.branch || !body.sha) {
      toast("error", "repo, branch and commit SHA are all required.");
      return;
    }
    if (!body.repo.includes("/")) {
      toast("error", "repo must be in owner/name form.");
      return;
    }

    setBusy(true);
    try {
      const res = await api.submitBuild(body);
      toast("success", `Submitted build for ${res.job} (${res.status})`);
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
      <h3 className="label-kicker mb-4">Run a build</h3>

      <label className="mb-3 block">
        <span className="mb-1 block text-xs text-ink-muted">Repository (owner/name)</span>
        <Input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="your-org/your-service"
          list="known-repos"
          className="w-full font-mono"
        />
        <datalist id="known-repos">
          {repos.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-muted">Branch</span>
          <Input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="master"
            className="w-full font-mono"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-muted">Commit SHA</span>
          <Input
            value={sha}
            onChange={(e) => setSha(e.target.value)}
            placeholder="full 40-char sha"
            className="w-full font-mono"
          />
        </label>
      </div>

      <p className="mt-3 text-[11px] text-ink-faint">
        Builds only deploy when the branch is the service&apos;s active branch in
        the catalog. Change a service&apos;s branch under Branches.
      </p>

      <Button type="button" onClick={submit} disabled={busy} className="mt-5 w-full">
        {busy ? "Submitting…" : "Run build"}
      </Button>
    </Card>
  );
}
