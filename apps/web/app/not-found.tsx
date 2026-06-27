import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <Card className="flex flex-col items-center gap-4 p-6">
        <div className="font-mono text-5xl font-bold text-ink-faint">404</div>
        <p className="text-sm text-ink-muted">
          That resource isn&apos;t in any managed namespace.
        </p>
        <Button asChild>
          <Link href="/">Back to overview</Link>
        </Button>
      </Card>
    </div>
  );
}
