import "server-only";
import { cookies } from "next/headers";
import { createApiClient } from "@/lib/api";

/** Live cluster state must never be cached by Next's data layer. */
const liveFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

/**
 * Per-request server-side API client. Talks directly to the Rust API (no
 * same-origin proxy during SSR/RSC) via API_INTERNAL_URL, and FORWARDS the
 * caller's `session` cookie so the API can authenticate the request — without
 * this, SSR calls would hit the auth middleware unauthenticated and 401.
 *
 * Must be called per request (it reads the incoming cookies); do not hoist the
 * result to module scope. Use `api` from lib/api.ts in browser components.
 */
export async function getServerApi() {
  const cookieHeader = (await cookies()).toString();
  return createApiClient({
    baseUrl: process.env.API_INTERNAL_URL ?? "http://localhost:8080",
    fetch: liveFetch,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}
