import type { NextConfig } from "next";

// GitHub project Pages serves under https://ae52.github.io/ininfra/
// basePath is overridable via NEXT_PUBLIC_BASE_PATH but defaults to '/ininfra'.
const basePath =
  process.env.NEXT_PUBLIC_BASE_PATH !== undefined
    ? process.env.NEXT_PUBLIC_BASE_PATH
    : "/ininfra";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  reactStrictMode: true,
};

export default nextConfig;
