import { withPostHogConfig } from "@posthog/nextjs-config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
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

// Generate and upload browser source maps so error tracking can turn minified
// production stack traces back into real component frames. The wrapper only runs
// the upload when both build-time secrets are set, so local and preview builds
// without them build unchanged. Source maps are deleted after upload by default,
// so they are never served to users.
const personalApiKey = process.env.POSTHOG_API_KEY;
const projectId = process.env.POSTHOG_PROJECT_ID;

export default personalApiKey && projectId
  ? withPostHogConfig(nextConfig, {
      personalApiKey,
      projectId,
      host: "https://us.posthog.com",
    })
  : nextConfig;
