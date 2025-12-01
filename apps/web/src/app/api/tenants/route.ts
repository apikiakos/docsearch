import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { elasticsearch, getTenantIndex } from "@/lib/elasticsearch";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const isPlatformAdmin = user.memberships.some(
      (m) => m.role === "platform_admin"
    );

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "10", 10);
    const sortBy = url.searchParams.get("sortBy") || "createdAt";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";
    const search = url.searchParams.get("search") || "";

    const skip = (page - 1) * limit;

    // Get admin-visible tenant list from environment (for demo purposes)
    // If ADMIN_TENANTS_LIST is set, only show those tenants in admin interface
    const adminTenantsList = process.env.ADMIN_TENANTS_LIST;
    const allowedSlugs = adminTenantsList
      ? adminTenantsList.split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0)
      : null; // null means show all tenants

    // Build where clause: combine search filter with admin tenants list filter
    const where: {
      slug?: { in: string[] } | { contains: string; mode: "insensitive" } | { AND: Array<{ in: string[] } | { contains: string; mode: "insensitive" }> };
      OR?: Array<{ slug: { contains: string; mode: "insensitive" } } | { name: { contains: string; mode: "insensitive" } }>;
    } = {};

    if (allowedSlugs && allowedSlugs.length > 0) {
      // Filter by admin tenants list
      if (search) {
        // Combine search with allowed slugs: tenant must be in allowed list AND match search
        where.OR = [
          {
            slug: {
              in: allowedSlugs,
            },
            name: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
          {
            slug: {
              in: allowedSlugs,
            },
            slug: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
        ];
        // Actually, we need to filter by allowed slugs first, then search within those
        // Let's use a simpler approach: filter by slug in allowed list, then apply search
        where.slug = {
          in: allowedSlugs.filter((slug: string) =>
            slug.toLowerCase().includes(search.toLowerCase())
          ),
        };
        // Also search by name within allowed tenants
        where.OR = [
          {
            slug: {
              in: allowedSlugs,
            },
            name: {
              contains: search,
              mode: "insensitive" as const,
            },
          },
        ];
      } else {
        // Just filter by allowed slugs
        where.slug = {
          in: allowedSlugs,
        };
      }
    } else if (search) {
      // No admin filter, just search
      where.OR = [
        {
          slug: {
            contains: search,
            mode: "insensitive" as const,
          },
        },
        {
          name: {
            contains: search,
            mode: "insensitive" as const,
          },
        },
      ];
    }

    const [tenants, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder,
        },
        include: {
          _count: {
            select: {
              memberships: true,
            },
          },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    // Get document counts from Elasticsearch for each tenant
    const tenantsWithCounts = await Promise.all(
      tenants.map(async (t: { id: string; slug: string; name: string; createdAt: Date; updatedAt: Date; _count: { memberships: number } }) => {
        let documentCount = 0;
        try {
          const indexName = getTenantIndex(t.slug);
          // Check if index exists first
          const indexExists = await elasticsearch.indices.exists({ index: indexName });
          if (!indexExists) {
            // Index doesn't exist yet - this is normal for new tenants
            documentCount = 0;
          } else {
            // Count unique documents by using a cardinality aggregation on document_id
            const aggResult = await elasticsearch.search({
              index: indexName,
              size: 0,
              aggs: {
                unique_documents: {
                  cardinality: {
                    field: "document_id",
                  },
                },
              },
            });
            documentCount = (aggResult.aggregations?.unique_documents as { value: number })?.value || 0;
          }
        } catch (error) {
          // If index doesn't exist or there's an error, documentCount remains 0
          // This is expected for tenants that haven't been indexed yet
          // Only log non-index-not-found errors to avoid noise
          if (error && typeof error === "object" && "meta" in error) {
            const meta = (error as { meta?: { body?: { error?: { type?: string } } } }).meta;
            const errorType = meta?.body?.error?.type;
            if (errorType !== "index_not_found_exception") {
              console.error(`Error getting document count for tenant ${t.slug}:`, error);
            }
          }
        }

        return {
          id: t.id,
          slug: t.slug,
          name: t.name,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          memberCount: t._count.memberships,
          documentCount,
        };
      })
    );

    return NextResponse.json({
      tenants: tenantsWithCounts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching tenants:", error);
    return NextResponse.json(
      { error: "Failed to fetch tenants" },
      { status: 500 }
    );
  }
}

