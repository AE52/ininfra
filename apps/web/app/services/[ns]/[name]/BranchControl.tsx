"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/Toast";

/**
 * Shows the current deploy branch for a service (from the build catalog) and
 * lets an admin change it via PATCH /api/build-config/:ns/:service.
 */
export function BranchControl({
  ns,
  service,
  currentBranch,
}: {
  ns: string;
  service: string;
  currentBranch: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [branch, setBranch] = useState(currentBranch ?? "");
  const [busy, setBusy] = useState(false);
  const isDirty = branch.trim() !== (currentBranch ?? "").trim();

  async function save() {
    const newBranch = branch.trim();
    if (!newBranch) {
      toast("error", "Branch cannot be empty.");
      return;
    }
    setBusy(true);
    try {
      await api.changeBranch(ns, service, { branch: newBranch });
      toast("success", `Branch changed to ${newBranch}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Change branch failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="label-kicker mb-3">Deploy branch</h3>

      {currentBranch === null && (
        <p className="mb-3 text-xs text-ink-faint">
          This service has no catalog entry — branch control is unavailable.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Input
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="master"
          className="flex-1 font-mono"
          disabled={currentBranch === null}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isDirty) void save();
          }}
        />
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!isDirty || busy || currentBranch === null}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>

      {currentBranch !== null && (
        <p className="mt-2 text-[11px] text-ink-faint">
          Only builds on this branch trigger a deploy for this service.
        </p>
      )}
    </Card>
  );
}
