import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const rootPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Match the backup API's 512 MiB limit; middleware otherwise truncates at 10 MiB.
    middlewareClientMaxBodySize: 512 * 1024 * 1024,
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPackage.version,
  },
  transpilePackages: ["@traderjourney/core", "@traderjourney/importers"],
  serverExternalPackages: ["better-sqlite3"],
  // Runtime journal files belong on the user's disk, never in a deployable bundle.
  outputFileTracingExcludes: {
    "/*": ["./data/**/*", "../../outputs/**/*", "../../.runtime-backup*/**/*"],
  },
};

export default nextConfig;
