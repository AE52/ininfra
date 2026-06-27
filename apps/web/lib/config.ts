import "server-only";
import { cache } from "react";
import type { AppConfig } from "@ininfra/shared-types";
import { getServerApi } from "@/lib/server-api";

/**
 * Safe fallback used when the public config endpoint is briefly unreachable
 * during SSR, so rendering never crashes. Intentionally deployment-neutral.
 */
const FALLBACK: AppConfig = {
  productName: "inInfra",
  clusterName: "kubernetes",
  managedNamespaces: [],
  features: { ecr: false, jenkins: false, gateway: false },
};

/**
 * Server-side public app config (cluster name, managed namespaces, feature
 * flags), fetched from the API's unauthenticated `GET /api/config`. Wrapped in
 * React `cache()` so a single render tree only fetches it once per request.
 * Falls back to a neutral default if the API is unreachable.
 */
export const getAppConfig = cache(async (): Promise<AppConfig> => {
  try {
    const api = await getServerApi();
    return await api.getConfig();
  } catch {
    return FALLBACK;
  }
});
