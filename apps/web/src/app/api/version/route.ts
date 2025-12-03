import { NextResponse } from "next/server";

/**
 * Get the current git version/commit hash and date
 * The version is set as an environment variable during build (GIT_COMMIT_SHA)
 * In development, it falls back to trying to get it from git directly
 */
export async function GET() {
  let version = "unknown";
  let date = "";
  
  // Try to get from environment variable first (set during build/deploy)
  if (process.env.GIT_COMMIT_SHA) {
    version = process.env.GIT_COMMIT_SHA;
    date = process.env.GIT_COMMIT_DATE || "";
  } else {
    // Fallback: try to get from git directly (only works in dev/local)
    try {
      const { execSync } = require("child_process");
      version = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
      date = execSync("git log -1 --format=%ci", { encoding: "utf-8" }).trim();
    } catch (error) {
      // Git not available or not a git repo
      version = "dev";
      date = "";
    }
  }
  
  return NextResponse.json({ version, date });
}

