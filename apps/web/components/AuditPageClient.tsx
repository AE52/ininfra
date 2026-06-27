"use client";

import type { AuditEntry, Page } from "@ininfra/shared-types";
import { useT } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { AuditTable } from "@/components/AuditTable";

export function AuditPageClient({ initial }: { initial: Page<AuditEntry> }) {
  const t = useT();
  return (
    <>
      <PageHeader
        kicker={t.audit.kicker}
        title={t.audit.title}
        subtitle={t.audit.subtitle}
      />
      <AuditTable initial={initial} />
    </>
  );
}
