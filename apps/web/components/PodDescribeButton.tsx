"use client";

import { useState } from "react";
import { Stethoscope } from "lucide-react";
import type { Namespace } from "@ininfra/shared-types";
import { DescribePanel } from "@/components/DescribePanel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Compact per-pod "describe" affordance for the pods table: opens a modal with
 * the pod's container statuses (ready / restartCount / state + reason like
 * CrashLoopBackOff / OOMKilled), conditions, and recent events.
 *
 * The DescribePanel inside fetches on mount, and we only mount it once the
 * dialog is open, so the data is fetched lazily the first time it's opened.
 */
export function PodDescribeButton({
  ns,
  name,
}: {
  ns: Namespace;
  name: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="text-xs text-ink-faint hover:text-pf-blue"
        >
          describe
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl gap-3 border-line bg-background">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Stethoscope className="size-4 text-ink-faint" />
            <span className="font-mono">pod/{name}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Read-only container status, conditions, and recent events ({ns}).
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-auto">
          {open && <DescribePanel kind="pod" ns={ns} name={name} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
