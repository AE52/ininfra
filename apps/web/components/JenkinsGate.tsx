"use client";

import { useConfig } from "@/components/ConfigProvider";
import { PageHeader, EmptyState } from "@/components/ui";

/**
 * Hides CI/CD UI when the backend has no Jenkins integration configured.
 * When `features.jenkins` is off it renders the same "not configured" empty
 * state the gateway page uses (so the page reads as intentionally disabled
 * rather than broken); otherwise it renders its children unchanged.
 */
export function JenkinsGate({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  const { features } = useConfig();

  if (!features.jenkins) {
    return (
      <div className="animate-fade-in">
        <PageHeader kicker={kicker} title={title} />
        <EmptyState
          title="CI/CD is not configured"
          body="Set the Jenkins integration environment variables on the API to surface build runs, per-commit status, and branch management."
        />
      </div>
    );
  }

  return <>{children}</>;
}
