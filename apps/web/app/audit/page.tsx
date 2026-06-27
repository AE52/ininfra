import type { AuditEntry, Page } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { ApiClientError } from "@/lib/api";
import { AuditPageClient } from "@/components/AuditPageClient";
import { ErrorPanel } from "@/components/ErrorPanel";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  let page: Page<AuditEntry> = { items: [], nextCursor: null };
  let error: string | null = null;
  try {
    const api = await getServerApi();
    page = await api.listAudit({ limit: 50 });
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  return (
    <div className="animate-fade-in">
      {error ? <ErrorPanel message={error} /> : <AuditPageClient initial={page} />}
    </div>
  );
}
