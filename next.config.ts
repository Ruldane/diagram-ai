import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets extra dev servers run beside your own (NEXT_DIST_DIR=.next-b next dev -p 3001) without sharing build output.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  // Native / Node-oriented packages used by the server-side renderers; load them with require() instead of bundling.
  serverExternalPackages: ["@resvg/resvg-js", "elkjs", "jspdf", "pptxgenjs"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
