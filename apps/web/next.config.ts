import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Marca del upgrade de seguridad aplicado con `next upgrade --agent=security`
  // (16.4.4 → 16.4.6 por un advisory publicado). Ver el commit de esa versión.
  experimental: {
    agentUpgrade: "security",
  },
  reactCompiler: true,
  transpilePackages: ["@workspace/ui"],
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  allowedDevOrigins: ["*.hackw.tech"],
};

export default nextConfig;
