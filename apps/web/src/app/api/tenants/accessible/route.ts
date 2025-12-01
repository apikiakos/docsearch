import { NextResponse } from "next/server";
import { requireAuth, getUserAccessibleTenants } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { elasticsearch, getTenantIndex } from "@/lib/elasticsearch";

export async function GET() {
  try {
    const user = await requireAuth();
    const accessibleSlugs = await getUserAccessibleTenants(user);

    // Fetch tenant details
    const tenants = await prisma.tenant.findMany({
      where: {
        slug: {
          in: accessibleSlugs,
        },
      },
      select: {
        id: true,
        slug: true,
        name: true,
      },
    });

    // Get document counts for each tenant from Elasticsearch
    const tenantsWithCounts = await Promise.all(
      tenants.map(async (t: { id: string; slug: string; name: string }) => {
        let documentCount = 0;
        try {
          const indexName = getTenantIndex(t.slug);
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
        } catch (error) {
          // If index doesn't exist or there's an error, documentCount remains 0
          console.error(`Error getting document count for tenant ${t.slug}:`, error);
        }

        return {
          ...t,
          documentCount,
        };
      })
    );

    // Calculate total document count across all accessible tenants
    // Also query all accessible indices at once for accuracy
    let totalDocuments = 0;
    try {
      if (accessibleSlugs.length > 0) {
        const indexPattern = accessibleSlugs.map(slug => getTenantIndex(slug)).join(",");
        const totalResult = await elasticsearch.search({
          index: indexPattern,
          size: 0,
          aggs: {
            unique_documents: {
              cardinality: {
                field: "document_id",
              },
            },
          },
        });
        totalDocuments = (totalResult.aggregations?.unique_documents as { value: number })?.value || 0;
      }
    } catch (error) {
      // Fallback to summing individual counts if multi-index query fails
      console.error("Error getting total document count:", error);
      totalDocuments = tenantsWithCounts.reduce((sum: number, t: { id: string; slug: string; name: string; documentCount: number }) => sum + t.documentCount, 0);
    }

    return NextResponse.json({ 
      tenants: tenantsWithCounts,
      totalDocuments,
    });
  } catch (error) {
    console.error("Error fetching accessible tenants:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to fetch tenants" },
      { status: 500 }
    );
  }
}

