import { Card } from "@/components/ui/card";

export function ErrorPanel({
  title = "Could not reach the API",
  message,
}: {
  title?: string;
  message?: string;
}) {
  return (
    <Card className="border-pf-red/30 bg-pf-red-50 px-5 py-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-pf-red">
        <span className="h-2 w-2 rounded-full bg-pf-red" />
        {title}
      </div>
      {message && (
        <p className="mt-1.5 font-mono text-xs text-pf-red">{message}</p>
      )}
      <p className="mt-2 text-xs text-ink-faint">
        The Rust API (devops-api) may be unreachable or starting up. Cluster
        state will reappear once it responds.
      </p>
    </Card>
  );
}
