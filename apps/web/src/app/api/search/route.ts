import { NextResponse } from "next/server";
import { requireAuth, hasTenantAccess, getUserAccessibleTenants } from "../../../lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "../../../lib/elasticsearch";
import { redis, getSearchCacheKey, checkRateLimit, getRateLimitKey } from "../../../lib/redis";

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
    cacheCheckTime: 0,
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
    const tenantSlug = url.searchParams.get("tenant") || url.searchParams.get("tenantId") || "";

    if (!q.trim()) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    // Get accessible tenants
    const tenantStart = performance.now();
    const accessibleTenants = await getUserAccessibleTenants(user);
    metrics.tenantResolutionTime = performance.now() - tenantStart;

    if (accessibleTenants.length === 0) {
      return NextResponse.json({ error: "No accessible tenants" }, { status: 403 });
    }

    // Determine which tenants to search - admin searches all by default
    let tenantsToSearch: string[] = [];
    if (tenantSlug) {
      if (!hasTenantAccess(user, tenantSlug)) {
        return NextResponse.json(
          { error: "Forbidden: No access to this tenant" },
          { status: 403 }
        );
      }
      tenantsToSearch = [tenantSlug];
    } else {
      // Default: search all accessible tenants (admin gets all tenants)
      tenantsToSearch = accessibleTenants;
    }

    // Rate limiting
    const rateLimitKey = getRateLimitKey(tenantsToSearch[0], user.id);
    const rateLimit = await checkRateLimit(rateLimitKey, 100, 60);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          resetAt: rateLimit.resetAt,
        },
        { status: 429 }
      );
    }

    // Check cache
    const cacheStart = performance.now();
    const cacheKey = getSearchCacheKey(tenantsToSearch.join(","), q);
    const cached = await redis.get(cacheKey);
    metrics.cacheCheckTime = performance.now() - cacheStart;
    
    if (cached) {
      const cachedData = JSON.parse(cached);
      metrics.totalTime = performance.now() - startTime;
      return NextResponse.json({
        ...cachedData,
        cached: true,
        metrics: {
          ...metrics,
          cached: true,
        },
      });
    }

    // Search across all accessible tenants
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
      highlight: {
        fields: {
          title: {
            fragment_size: 200,
            number_of_fragments: 1,
          },
          content: {
            fragment_size: 200,
            number_of_fragments: 3,
            pre_tags: ["<mark>"],
            post_tags: ["</mark>"],
          },
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
      size: 100, // Get more results for datatable
      sort: [{ _score: { order: "desc" } }], // Sort by Elasticsearch score
    });
    metrics.elasticsearchTime = performance.now() - esStart;

    // Process file type facets
    const processStart = performance.now();
    const fileTypeFacets: Record<string, number> = {};
    
    if (searchResult.aggregations) {
      const fileTypesAgg = searchResult.aggregations.file_types as {
        buckets: Array<{ key: string; doc_count: number }>;
      };
      
      if (fileTypesAgg && fileTypesAgg.buckets) {
        for (const bucket of fileTypesAgg.buckets) {
          const fileType = getFileType({ mime: bucket.key });
          fileTypeFacets[fileType] = (fileTypeFacets[fileType] || 0) + bucket.doc_count;
        }
      }
    }

    // If no mime aggregations, calculate from results
    if (Object.keys(fileTypeFacets).length === 0) {
      for (const hit of searchResult.hits.hits) {
        const source = hit._source as {
          metadata?: Record<string, unknown>;
        };
        const fileType = getFileType(source.metadata);
        fileTypeFacets[fileType] = (fileTypeFacets[fileType] || 0) + 1;
      }
    }

    const results = searchResult.hits.hits.map((hit) => {
      const source = hit._source as {
        id: string;
        document_id: string;
        tenant_id: string;
        title: string;
        content: string;
        chunk_index: number;
        metadata?: Record<string, unknown>;
      };
      const highlights = (hit.highlight as Record<string, string[]> | undefined) || {};
      
      return {
        id: source.id,
        document_id: source.document_id,
        tenant_id: source.tenant_id,
        title: source.title,
        fileType: getFileType(source.metadata),
        highlights: highlights.content || [],
        titleHighlight: highlights.title?.[0] || source.title,
        score: hit._score || 0,
        chunk_index: source.chunk_index,
        metadata: source.metadata,
      };
    });

    // Sort by score (already sorted by ES, but ensure it)
    results.sort((a, b) => b.score - a.score);

    const facets = Object.entries(fileTypeFacets)
      .map(([type, count]) => ({
        type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    metrics.processingTime = performance.now() - processStart;
    metrics.totalTime = performance.now() - startTime;

    const responseData = {
      results,
      facets,
      total: typeof searchResult.hits.total === "object" 
        ? searchResult.hits.total.value 
        : searchResult.hits.total || 0,
      cached: false,
      metrics: {
        ...metrics,
        elasticsearchTook: searchResult.took || 0, // ES internal timing
      },
    };

    // Cache results for 5 minutes (without metrics for consistency)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { metrics: _metrics, ...dataToCache } = responseData;
    await redis.setex(cacheKey, 300, JSON.stringify(dataToCache));

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error searching:", error);
    return NextResponse.json(
      { error: "Failed to search documents" },
      { status: 500 }
    );
  }
}
