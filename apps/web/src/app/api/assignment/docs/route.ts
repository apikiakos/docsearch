import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { requireAuth } from "@/lib/auth-helpers";

/**
 * GET /api/assignment/docs
 * List all markdown files in the docs folder
 */
export async function GET() {
  try {
    const user = await requireAuth();
    
    // Check if user is platform admin
    const isPlatformAdmin =
      user.memberships?.some((m) => m.role === "platform_admin") ?? false;

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get the docs folder path (relative to project root)
    const docsPath = join(process.cwd(), "..", "..", "docs");
    
    try {
      const files = await readdir(docsPath);
      const markdownFiles = files
        .filter((file) => file.endsWith(".md"))
        .sort() // Sort by filename
        .map((file) => ({
          filename: file,
          name: file.replace(/\.md$/, ""),
        }));

      return NextResponse.json({ files: markdownFiles });
    } catch (error) {
      console.error("Error reading docs directory:", error);
      return NextResponse.json(
        { error: "Failed to read docs directory" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error fetching docs list:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to fetch docs list" },
      { status: 500 }
    );
  }
}

