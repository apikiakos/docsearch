import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";
import { requireAuth } from "@/lib/auth-helpers";

type Context = {
  params: Promise<{ filename: string }>;
};

/**
 * GET /api/assignment/docs/[filename]
 * Fetch the content of a specific markdown file
 */
export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireAuth();
    
    // Check if user is platform admin
    const isPlatformAdmin =
      user.memberships?.some((m) => m.role === "platform_admin") ?? false;

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { filename } = await context.params;
    
    // Security: Ensure filename doesn't contain path traversal
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    
    // Ensure it's a .md file
    const safeFilename = filename.endsWith(".md") ? filename : `${filename}.md`;
    
    // Get the docs folder path (relative to project root)
    const docsPath = join(process.cwd(), "..", "..", "docs", safeFilename);
    
    try {
      const content = await readFile(docsPath, "utf-8");
      return NextResponse.json({ 
        filename: safeFilename,
        content,
      });
    } catch (error) {
      console.error(`Error reading file ${safeFilename}:`, error);
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("Error fetching doc content:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to fetch doc content" },
      { status: 500 }
    );
  }
}

