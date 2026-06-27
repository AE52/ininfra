"use client";

import { ChevronDown, ClipboardCopy, Terminal } from "lucide-react";
import type { Namespace } from "@ininfra/shared-types";
import { cx } from "@/lib/format";
import { useToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

type KubectlItem = {
  /** Short human label, e.g. "Logs (follow)". */
  label: string;
  /** The raw kubectl command copied to the clipboard. */
  command: string;
};

/**
 * Copy-kubectl-command helper. Renders a small "kubectl" button that opens a
 * dropdown of equivalent kubectl commands for a Deployment, a StatefulSet, or a
 * Pod. Clicking an item copies the raw command to the clipboard — nothing is
 * executed and the cluster is never mutated by this component. Reuses the shared
 * Radix dropdown primitive (keyboard + focus handled by Radix) and the app's
 * toast.
 */
export function KubectlMenu(
  props:
    | { target: "deployment"; ns: Namespace; name: string; compact?: boolean }
    | { target: "statefulset"; ns: Namespace; name: string; compact?: boolean }
    | { target: "pod"; ns: Namespace; name: string; compact?: boolean },
) {
  const { target, ns, name, compact = false } = props;
  const toast = useToast();

  const items: KubectlItem[] =
    target === "deployment"
      ? [
          { label: "Get YAML", command: `kubectl -n ${ns} get deployment ${name} -o yaml` },
          { label: "Describe", command: `kubectl -n ${ns} describe deployment ${name}` },
          { label: "Logs (follow, all containers)", command: `kubectl -n ${ns} logs deployment/${name} -f --all-containers` },
          { label: "Rollout restart", command: `kubectl -n ${ns} rollout restart deployment/${name}` },
          { label: "Rollout status", command: `kubectl -n ${ns} rollout status deployment/${name}` },
          { label: "Scale to 3", command: `kubectl -n ${ns} scale deployment/${name} --replicas=3` },
        ]
      : target === "statefulset"
        ? [
            { label: "Get YAML", command: `kubectl -n ${ns} get statefulset ${name} -o yaml` },
            { label: "Describe", command: `kubectl -n ${ns} describe statefulset ${name}` },
            { label: "Logs (follow, all containers)", command: `kubectl -n ${ns} logs statefulset/${name} -f --all-containers` },
            { label: "Rollout restart", command: `kubectl -n ${ns} rollout restart statefulset/${name}` },
            { label: "Rollout status", command: `kubectl -n ${ns} rollout status statefulset/${name}` },
            { label: "Scale to 3", command: `kubectl -n ${ns} scale statefulset/${name} --replicas=3` },
          ]
        : [
            { label: "Logs (follow)", command: `kubectl -n ${ns} logs ${name} -f` },
            { label: "Exec shell", command: `kubectl -n ${ns} exec -it ${name} -- sh` },
            { label: "Describe", command: `kubectl -n ${ns} describe pod ${name}` },
            { label: "Get YAML", command: `kubectl -n ${ns} get pod ${name} -o yaml` },
            { label: "Port-forward", command: `kubectl -n ${ns} port-forward ${name} 8080:80` },
            { label: "Delete pod", command: `kubectl -n ${ns} delete pod ${name}` },
          ];

  async function copy(item: KubectlItem) {
    try {
      await navigator.clipboard.writeText(item.command);
      toast("success", "Copied to clipboard");
    } catch {
      // Clipboard API unavailable (e.g. insecure context).
      toast("error", "Could not copy to clipboard");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-pf-blue"
            aria-label="Copy kubectl command"
          >
            <Terminal className="size-3" />
            kubectl
          </button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            aria-label="Copy kubectl command"
          >
            <Terminal className="size-3.5" />
            kubectl
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <DropdownMenuLabel className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          <ClipboardCopy className="size-3" />
          Copy command
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            onSelect={() => void copy(item)}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="text-xs font-medium text-ink">{item.label}</span>
            <span
              className={cx(
                "block w-full truncate font-mono text-[11px] text-ink-faint",
              )}
              title={item.command}
            >
              {item.command}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
