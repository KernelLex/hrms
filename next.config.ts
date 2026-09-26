import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Resume uploads go through a Server Function. Files are capped at 4 MB
      // in src/lib/storage.ts; this leaves room for the multipart overhead
      // while staying under Vercel's 4.5 MB request limit.
      bodySizeLimit: "4.4mb",
    },
  },
};

export default nextConfig;
