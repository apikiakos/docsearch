import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    
    // Only allow platform admins
    const isPlatformAdmin = user.memberships.some(
      (m) => m.role === "platform_admin"
    );

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "lastIndexedAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    // Validate sortBy to prevent SQL injection
    const validSortColumns = ["path", "tenantId", "lastIndexedAt", "lastMtime", "sizeBytes", "status"];
    const safeSortBy = validSortColumns.includes(sortBy) ? sortBy : "lastIndexedAt";
    const safeSortOrder = sortOrder === "asc" ? "ASC" : "DESC";
    
    // Build sort column expression
    let sortColumn: string;
    if (safeSortBy === "tenantId") {
      sortColumn = '"tenantId"';
    } else if (safeSortBy === "lastIndexedAt") {
      sortColumn = '"lastIndexedAt"';
    } else if (safeSortBy === "lastMtime") {
      sortColumn = '"lastMtime"';
    } else if (safeSortBy === "sizeBytes") {
      sortColumn = '"sizeBytes"';
    } else if (safeSortBy === "status") {
      // Status: 0 = Active, 1 = Deleted, 2 = Permanently Deleted
      sortColumn = `CASE 
        WHEN "permanentlyDeleted" = true THEN 2
        WHEN "isDeleted" = true THEN 1
        ELSE 0
      END`;
    } else {
      sortColumn = "path";
    }

    // Build WHERE clause with parameterized query
    const searchPattern = search ? `%${search}%` : null;
    
    // Get total count
    let countQuery: string;
    let countParams: unknown[];
    
    if (searchPattern) {
      countQuery = `SELECT COUNT(*)::int as count FROM file_manifest WHERE (path ILIKE $1 OR "tenantId" ILIKE $1)`;
      countParams = [searchPattern];
    } else {
      countQuery = `SELECT COUNT(*)::int as count FROM file_manifest`;
      countParams = [];
    }
    
    const countResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      countQuery,
      ...countParams
    );
    const total = countResult[0]?.count || 0;

    // Get paginated results
    const offset = (page - 1) * limit;
    let query: string;
    let queryParams: unknown[];
    
    if (searchPattern) {
      query = `
        SELECT 
          id,
          "tenantId",
          path,
          "documentId",
          "lastMtime",
          "sizeBytes",
          "contentHash",
          etag,
          "lastIndexedAt",
          "isDeleted",
          "permanentlyDeleted"
        FROM file_manifest
        WHERE (path ILIKE $1 OR "tenantId" ILIKE $1)
        ORDER BY ${sortColumn} ${safeSortOrder}
        LIMIT $2 OFFSET $3
      `;
      queryParams = [searchPattern, limit, offset];
    } else {
      query = `
        SELECT 
          id,
          "tenantId",
          path,
          "documentId",
          "lastMtime",
          "sizeBytes",
          "contentHash",
          etag,
          "lastIndexedAt",
          "isDeleted",
          "permanentlyDeleted"
        FROM file_manifest
        ORDER BY ${sortColumn} ${safeSortOrder}
        LIMIT $1 OFFSET $2
      `;
      queryParams = [limit, offset];
    }

    const entries = await prisma.$queryRawUnsafe<Array<{
      id: number;
      tenantId: string;
      path: string;
      documentId: string;
      lastMtime: Date;
      sizeBytes: bigint;
      contentHash: string | null;
      etag: string | null;
      lastIndexedAt: Date;
      isDeleted: boolean;
      permanentlyDeleted: boolean;
    }>>(query, ...queryParams);

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      entries: entries.map((entry) => ({
        id: entry.id,
        tenantId: entry.tenantId,
        path: entry.path,
        documentId: entry.documentId,
        lastMtime: entry.lastMtime.toISOString(),
        sizeBytes: Number(entry.sizeBytes),
        contentHash: entry.contentHash,
        etag: entry.etag,
        lastIndexedAt: entry.lastIndexedAt.toISOString(),
        isDeleted: entry.isDeleted,
        permanentlyDeleted: entry.permanentlyDeleted,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error fetching manifest:", error);
    return NextResponse.json(
      { error: "Failed to fetch manifest entries" },
      { status: 500 }
    );
  }
}

