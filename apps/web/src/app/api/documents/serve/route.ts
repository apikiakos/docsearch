import { NextRequest, NextResponse } from "next/server";
import { requireAuth, hasTenantAccess } from "@/lib/auth-helpers";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Serve local files for document preview
 * GET /api/documents/serve?path=/absolute/path/to/file&tenant=tenant-id
 */
export async function GET(request: NextRequest) {
  try {
    let user;
    try {
      user = await requireAuth();
    } catch (error) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const filePath = searchParams.get("path");
    const tenantId = searchParams.get("tenant");

    if (!filePath || !tenantId) {
      return NextResponse.json(
        { error: "Missing path or tenant parameter" },
        { status: 400 }
      );
    }

    // Check tenant access
    // First, get the tenant slug from the tenantId
    // For now, we'll use tenantId as slug (assuming they match)
    // If not, we'd need to query the database to get the slug
    const tenantSlug = tenantId;
    if (!hasTenantAccess(user, tenantSlug)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Security: Only allow files from workers/data directory
    // The path from producer is an absolute path
    // We need to validate it's within the project's workers/data directory
    const { resolve } = require("path");
    
    // Get project root
    // In Next.js, process.cwd() is the project root (where next.config.js is)
    // But in development, it might be apps/web. Let's handle both cases.
    let projectRoot = process.cwd();
    if (projectRoot.endsWith("/apps/web")) {
      projectRoot = projectRoot.replace(/\/apps\/web$/, "");
    }
    const workersDataPath = resolve(projectRoot, "workers", "data");
    
    // Resolve the provided path (handles absolute paths)
    const resolvedFilePath = resolve(filePath);
    const resolvedWorkersDataPath = resolve(workersDataPath);
    
    // Debug logging
    console.log("[serve] Requested path:", filePath);
    console.log("[serve] Resolved file path:", resolvedFilePath);
    console.log("[serve] Workers data path:", resolvedWorkersDataPath);
    console.log("[serve] Path starts with workers/data:", resolvedFilePath.startsWith(resolvedWorkersDataPath));
    console.log("[serve] User authenticated:", user.email, "Tenant:", tenantSlug);
    
    // Ensure the file is within the workers/data directory
    if (!resolvedFilePath.startsWith(resolvedWorkersDataPath)) {
      console.error("[serve] Path validation failed:", {
        requested: filePath,
        resolved: resolvedFilePath,
        expectedPrefix: resolvedWorkersDataPath,
      });
      return NextResponse.json(
        { error: "Invalid path: file must be within workers/data directory" },
        { status: 400 }
      );
    }
    
    const fullPath = resolvedFilePath;

    // Check if file exists
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Read file
    const fileBuffer = await readFile(fullPath);
    
    // Determine content type from file extension
    const ext = fullPath.split(".").pop()?.toLowerCase();
    const contentTypeMap: Record<string, string> = {
      pdf: "application/pdf",
      txt: "text/plain",
      md: "text/markdown",
      html: "text/html",
      htm: "text/html",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      doc: "application/msword",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
    };
    
    const contentType = contentTypeMap[ext || ""] || "application/octet-stream";

    // Return file with appropriate headers
    // For PDFs, ensure proper headers for iframe embedding
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${fullPath.split("/").pop()}"`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    };
    
    // Add CORS headers if needed (for iframe embedding)
    if (contentType === "application/pdf") {
      headers["Content-Security-Policy"] = "frame-ancestors 'self'";
    }
    
    return new NextResponse(fileBuffer, {
      headers,
    });
  } catch (error: unknown) {
    console.error("Error serving file:", error);
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: error.message === "Unauthorized" ? 401 : 403 });
    }
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

