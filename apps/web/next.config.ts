import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (two levels up from apps/web/next.config.ts)
config({ path: resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
