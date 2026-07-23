import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "undici", "form-data", "https-proxy-agent"],
};

export default nextConfig;
