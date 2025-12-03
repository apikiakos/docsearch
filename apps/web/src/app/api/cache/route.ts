import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { redis } from "@/lib/redis";

/**
 * GET /api/cache - List all cache entries with pagination and filtering
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    
    // Only allow platform admins
    const isPlatformAdmin = user.memberships?.some(
      (m) => m.role === "platform_admin"
    ) ?? false;

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const sortBy = searchParams.get("sortBy") || "date";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const search = searchParams.get("search") || "";

    // Get all cache keys matching the pattern
    const allKeys = await redis.keys("search:*");
    
    // Parse cache entries
    const cacheEntries: Array<{
      key: string;
      tenant: string;
      query: string;
      date: Date;
      ttl: number;
    }> = [];

    for (const key of allKeys) {
      // Parse key format: search:tenantId:base64Query
      const parts = key.split(":");
      if (parts.length >= 3) {
        const tenant = parts[1];
        const base64Query = parts.slice(2).join(":"); // In case query contains colons
        let query = "";
        
        try {
          query = Buffer.from(base64Query, "base64").toString("utf-8");
        } catch {
          query = base64Query; // Fallback if decoding fails
        }

        // Get TTL to calculate creation date (approximate)
        // Cache entries have a default TTL of 300 seconds (5 minutes)
        const ttl = await redis.ttl(key);
        // If TTL is -1 (no expiration) or -2 (key doesn't exist), use current time
        // Otherwise, approximate creation time: current time - (max_ttl - current_ttl)
        const maxTtl = 300; // Default cache TTL in seconds (5 minutes)
        const date = ttl > 0 
          ? new Date(Date.now() - (maxTtl - ttl) * 1000)
          : new Date(); // Fallback to current time if TTL is invalid

        // Filter by search term (keyword or tenant)
        if (!search || 
            query.toLowerCase().includes(search.toLowerCase()) ||
            tenant.toLowerCase().includes(search.toLowerCase())) {
          cacheEntries.push({
            key,
            tenant,
            query,
            date,
            ttl,
          });
        }
      }
    }

    // Sort entries
    cacheEntries.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "keyword":
          comparison = a.query.localeCompare(b.query);
          break;
        case "tenant":
          comparison = a.tenant.localeCompare(b.tenant);
          break;
        case "date":
        default:
          comparison = a.date.getTime() - b.date.getTime();
          break;
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    // Paginate
    const total = cacheEntries.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginatedEntries = cacheEntries.slice(start, end);

    return NextResponse.json({
      entries: paginatedEntries.map(entry => ({
        ...entry,
        date: entry.date.toISOString(), // Serialize date to ISO string
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Error fetching cache entries:", error);
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to fetch cache entries" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/cache - Delete cache entries
 * Query params:
 *   - key: specific cache key to delete
 *   - tenant: delete all cache for a tenant (or "all" for all tenants)
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireAuth();
    
    // Only allow platform admins
    const isPlatformAdmin = user.memberships?.some(
      (m) => m.role === "platform_admin"
    ) ?? false;

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");
    const tenant = searchParams.get("tenant");

    if (key) {
      // Delete specific cache key
      await redis.del(key);
      return NextResponse.json({ success: true, deleted: key });
    } else if (tenant) {
      // Delete all cache for a tenant or all tenants
      if (tenant === "all") {
        const allKeys = await redis.keys("search:*");
        if (allKeys.length > 0) {
          await redis.del(...allKeys);
        }
        return NextResponse.json({ 
          success: true, 
          deleted: allKeys.length,
          message: `Deleted ${allKeys.length} cache entries for all tenants`
        });
      } else {
        const tenantKeys = await redis.keys(`search:${tenant}:*`);
        if (tenantKeys.length > 0) {
          await redis.del(...tenantKeys);
        }
        return NextResponse.json({ 
          success: true, 
          deleted: tenantKeys.length,
          message: `Deleted ${tenantKeys.length} cache entries for tenant ${tenant}`
        });
      }
    } else {
      return NextResponse.json(
        { error: "Either 'key' or 'tenant' parameter is required" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("Error deleting cache entries:", error);
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to delete cache entries" },
      { status: 500 }
    );
  }
}

