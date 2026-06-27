import * as React from "react";
import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative rounded-2xl border border-hairline bg-panel/80",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
