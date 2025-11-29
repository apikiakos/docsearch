import { NextResponse } from "next/server";
import { requireAuth, hasTenantAccess, getUserAccessibleTenants } from "@/lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "@/lib/elasticsearch";

function getFileType(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "Unknown";
  
  // Try mime type first
  if (metadata.mime && typeof metadata.mime === "string") {
    const mimeParts = metadata.mime.split("/");
    if (mimeParts.length > 1) {
      return mimeParts[1].toUpperCase();
    }
    return metadata.mime.toUpperCase();
  }
  
  // Try filename extension
  if (metadata.filename && typeof metadata.filename === "string") {
    const parts = metadata.filename.split(".");
    if (parts.length > 1) {
      return parts[parts.length - 1].toUpperCase();
    }
  }
  
  return "Unknown";
}

export async function GET(request: Request) {
  const startTime = performance.now();
  const metrics = {
    apiStart: startTime,
    authTime: 0,
    tenantResolutionTime: 0,
    elasticsearchTime: 0,
    processingTime: 0,
    totalTime: 0,
  };

  try {
    const authStart = performance.now();
    const user = await requireAuth();
    metrics.authTime = performance.now() - authStart;

    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const tenantSlug = url.searchParams.get("tenant") || "";

    if (!q.trim() || q.length < 2) {
      return NextResponse.json({ statistics: [], total: 0, metrics });
    }

    // Get accessible tenants - admin gets all by default
    const tenantStart = performance.now();
    const accessibleTenants = await getUserAccessibleTenants(user);
    metrics.tenantResolutionTime = performance.now() - tenantStart;

    if (accessibleTenants.length === 0) {
      return NextResponse.json({ statistics: [], total: 0, metrics });
    }

    // If tenant specified, check access; otherwise search all accessible tenants
    const tenantsToSearch = tenantSlug
      ? hasTenantAccess(user, tenantSlug)
        ? [tenantSlug]
        : []
      : accessibleTenants;

    if (tenantsToSearch.length === 0) {
      return NextResponse.json({ statistics: [], total: 0, metrics });
    }

    // Search across all accessible tenants with aggregations
    const indexPattern = tenantsToSearch.map((t) => getTenantIndex(t)).join(",");
    
    const esStart = performance.now();
    const searchResult = await elasticsearch.search({
      index: indexPattern,
      query: {
        multi_match: {
          query: q,
          fields: ["title^3", "content"],
          type: "best_fields",
          fuzziness: "AUTO",
        },
      },
      aggs: {
        file_types: {
          terms: {
            field: "metadata.mime",
            size: 20,
            missing: "unknown",
          },
        },
      },
      size: 0, // We only want aggregations for autocomplete
    });
    metrics.elasticsearchTime = performance.now() - esStart;

    // Process aggregations to get file type statistics
    const processStart = performance.now();
    const fileTypeStats: Record<string, number> = {};
    
    if (searchResult.aggregations) {
      const fileTypesAgg = searchResult.aggregations.file_types as {
        buckets: Array<{ key: string; doc_count: number }>;
      };
      
      if (fileTypesAgg && fileTypesAgg.buckets) {
        for (const bucket of fileTypesAgg.buckets) {
          const fileType = getFileType({ mime: bucket.key });
          fileTypeStats[fileType] = (fileTypeStats[fileType] || 0) + bucket.doc_count;
        }
      }
    }

    // If no mime aggregations, we need to search documents to get file types
    if (Object.keys(fileTypeStats).length === 0) {
      const docSearchResult = await elasticsearch.search({
        index: indexPattern,
        query: {
          multi_match: {
            query: q,
            fields: ["title^3", "content"],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        },
        size: 100, // Get sample to determine file types
      });

      for (const hit of docSearchResult.hits.hits) {
        const source = hit._source as {
          metadata?: Record<string, unknown>;
        };
        const fileType = getFileType(source.metadata);
        fileTypeStats[fileType] = (fileTypeStats[fileType] || 0) + 1;
      }
    }

    const statistics = Object.entries(fileTypeStats)
      .map(([type, count]) => ({
        type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    metrics.processingTime = performance.now() - processStart;
    metrics.totalTime = performance.now() - startTime;

    return NextResponse.json({ 
      statistics,
      total: typeof searchResult.hits.total === "object" 
        ? searchResult.hits.total.value 
        : searchResult.hits.total || 0,
      metrics: {
        ...metrics,
        elasticsearchTook: searchResult.took || 0,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Error autocomplete:", error);
    return NextResponse.json({ statistics: [] });
  }
}
