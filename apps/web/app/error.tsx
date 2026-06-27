"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <Card className="flex flex-col items-center gap-4 p-6">
        <div className="text-sm font-semibold text-pf-red">
          Something broke rendering this view
        </div>
        <pre className="max-w-lg overflow-x-auto rounded bg-line-soft p-3 font-mono text-xs text-pf-red">
          {error.message}
        </pre>
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
      </Card>
    </div>
  );
}
