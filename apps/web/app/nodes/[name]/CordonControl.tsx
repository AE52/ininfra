"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2 } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";

/**
 * Admin-only control to cordon / uncordon a node. The button is rendered only
 * for admin-class roles (resolved via `api.me()`, mirroring the Sidebar's
 * client-side gating); the API independently enforces the same gate, so a
 * non-admin who forced the request would still get a 403.
 *
 * `unschedulable` is the node's current schedulable state (from the server
 * component). On success we toast and `router.refresh()` so the server-rendered
 * badge re-reads the live state.
 */
export function CordonControl({
  name,
  unschedulable,
}: {
  name: string;
  unschedulable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [role, setRole] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolve role once; only admin / super_admin may cordon.
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((me) => {
        if (alive) setRole(me.role);
      })
      .catch(() => {
        /* unauthenticated / error → treat as non-admin, hide the control */
      });
    return () => {
      alive = false;
    };
  }, []);

  const isAdmin = role === "admin" || role === "super_admin";
  if (!isAdmin) return null;

  // We are flipping to the opposite of the current state.
  const next = !unschedulable;
  const verb = next ? "Cordon" : "Uncordon";

  async function toggle() {
    const msg = next
      ? `Cordon ${name}? New pods will not be scheduled onto it (existing pods keep running).`
      : `Uncordon ${name}? It becomes schedulable again.`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    try {
      await api.setNodeCordon(name, next);
      toast(
        "success",
        next ? `Cordoned ${name}` : `Uncordoned ${name}`,
      );
      router.refresh();
    } catch (e) {
      const m = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `${verb} failed: ${m}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={next ? "destructive" : "outline"}
      onClick={toggle}
      disabled={busy}
    >
      {next ? <Ban /> : <CheckCircle2 />}
      {busy ? `${verb}ing…` : `${verb} node`}
    </Button>
  );
}
