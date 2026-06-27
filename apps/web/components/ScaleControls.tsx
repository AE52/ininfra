"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Namespace } from "@ininfra/shared-types";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { cx } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";

const MAX = 12;

export function ScaleControls({
  ns,
  name,
  desired,
  ready,
}: {
  ns: Namespace;
  name: string;
  desired: number;
  ready: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState(desired);
  const [saving, startSaving] = useTransition();
  const [restarting, setRestarting] = useState(false);

  const dirty = target !== desired;
  const sliderMax = Math.max(MAX, desired + 2);

  function apply() {
    startSaving(async () => {
      try {
        await api.scaleDeployment(ns, name, { replicas: target });
        toast("success", `Scaling ${name} → ${target} replica(s)`);
        router.refresh();
      } catch (e) {
        const msg = e instanceof ApiClientError ? e.message : String(e);
        toast("error", `Scale failed: ${msg}`);
        setTarget(desired);
      }
    });
  }

  async function restart() {
    setRestarting(true);
    try {
      await api.restartDeployment(ns, name);
      toast("success", `Rollout restart triggered for ${name}`);
      router.refresh();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : String(e);
      toast("error", `Restart failed: ${msg}`);
    } finally {
      setRestarting(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <h3 className="label-kicker">Scale &amp; rollout</h3>
        <span className="tabular font-mono text-xs text-ink-faint">
          {ready}/{desired} ready
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="tabular text-4xl font-semibold text-ink">
          {target}
        </span>
        <span className="text-sm text-ink-faint">replicas</span>
        {dirty && (
          <span className="ml-auto text-xs text-[#8a6d00]">
            from {desired}
          </span>
        )}
      </div>

      <input
        type="range"
        min={0}
        max={sliderMax}
        value={target}
        onChange={(e) => setTarget(Number(e.target.value))}
        className="mt-3 w-full accent-pf-blue"
        aria-label="desired replicas"
      />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>0</span>
        <span>{Math.floor(sliderMax / 2)}</span>
        <span>{sliderMax}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setTarget((t) => Math.max(0, t - 1))}
          aria-label="decrement"
        >
          <Minus />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => setTarget((t) => Math.min(sliderMax, t + 1))}
          aria-label="increment"
        >
          <Plus />
        </Button>
        <Button
          type="button"
          variant={dirty ? "default" : "outline"}
          onClick={apply}
          disabled={!dirty || saving}
        >
          {saving ? "Applying…" : "Apply scale"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={restart}
          disabled={restarting}
          className="ml-auto"
        >
          <RotateCcw className={cx(restarting && "animate-spin")} />
          {restarting ? "Restarting…" : "Restart rollout"}
        </Button>
      </div>
    </Card>
  );
}
