import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Standalone output for a lean production container (see deploy/Dockerfile.web).
  output: "standalone",
  // shared-types is consumed as TS source from the workspace; transpile it.
  transpilePackages: ["@ininfra/shared-types"],
  // NOTE: do NOT put API_INTERNAL_URL in `env: {}` — that INLINES it at build
  // time (Kaniko builds have no API_INTERNAL_URL, so it would bake the
  // "http://localhost:8080" fallback and SSR would hit localhost → "fetch
  // failed"). server-api.ts reads process.env.API_INTERNAL_URL at RUNTIME
  // (server-only), and the rewrite below resolves it at server startup.
  async rewrites() {
    return [
      {
        // Browser hits /api/* on the same origin; Next proxies to the Rust API.
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:8080"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
