import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM that must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
