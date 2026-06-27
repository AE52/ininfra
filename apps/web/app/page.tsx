import type { NodeInfo, Service } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";
import { getAppConfig } from "@/lib/config";
import { ApiClientError } from "@/lib/api";
import { DashboardClient } from "@/components/DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let services: Service[] = [];
  let nodes: NodeInfo[] = [];
  let serviceCount = 0;
  let error: string | null = null;

  const config = await getAppConfig();

  try {
    const api = await getServerApi();
    const [servicesPage, nodesPage] = await Promise.all([
      api.listServices(undefined, { limit: 500 }),
      api.listNodes({ limit: 500 }),
    ]);
    services = servicesPage.items;
    nodes = nodesPage.items;
    serviceCount = servicesPage.total ?? servicesPage.items.length;
  } catch (e) {
    error = e instanceof ApiClientError ? `${e.code}: ${e.message}` : String(e);
  }

  return (
    <DashboardClient
      services={services}
      nodes={nodes}
      serviceCount={serviceCount}
      error={error}
      clusterName={config.clusterName}
      managedNamespaces={config.managedNamespaces}
    />
  );
}
