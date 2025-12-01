import { NextResponse } from "next/server";
import { requireAuth, hasTenantAccess, getUserAccessibleTenants } from "@/lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "@/lib/elasticsearch";
import { normalizeFileType } from "@/lib/file-types";

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
    
    if (!indexPattern) {
      // No indices to search
      metrics.elasticsearchTime = 0;
      metrics.processingTime = 0;
      metrics.totalTime = performance.now() - startTime;
      return NextResponse.json({ 
        statistics: [], 
        total: 0, 
        metrics: {
          ...metrics,
          elasticsearchTook: 0,
        },
      });
    }
    
    const esStart = performance.now();
    let searchResult;
    try {
      // Fetch chunk hits to group by document_id
      searchResult = await elasticsearch.search({
        index: indexPattern,
        allow_no_indices: true,
        ignore_unavailable: true,
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
        size: 100, // Fetch chunks to group by document_id
      });
    } catch (esError: unknown) {
      metrics.elasticsearchTime = performance.now() - esStart;
      console.error("Elasticsearch autocomplete error:", esError);
      // Return empty results instead of failing
      metrics.processingTime = 0;
      metrics.totalTime = performance.now() - startTime;
      return NextResponse.json({ 
        statistics: [], 
        total: 0, 
        metrics: {
          ...metrics,
          elasticsearchTook: 0,
        },
      });
    }
    metrics.elasticsearchTime = performance.now() - esStart;

    // Process aggregations and group by document_id to count documents, not chunks
    const processStart = performance.now();
    
    // Group chunks by document_id to count unique documents
    const documentMap = new Map<string, {
      tenant_id: string;
      document_id: string;
      metadata?: Record<string, unknown>;
    }>();
    
    for (const hit of searchResult.hits.hits) {
      const source = hit._source as {
        document_id: string;
        tenant_id: string;
        metadata?: Record<string, unknown>;
      };
      const documentKey = `${source.tenant_id}:${source.document_id}`;
      
      // Only store once per document (we just need to count unique documents)
      if (!documentMap.has(documentKey)) {
        documentMap.set(documentKey, {
          tenant_id: source.tenant_id,
          document_id: source.document_id,
          metadata: source.metadata,
        });
      }
    }
    
    // Count file types by documents (not chunks)
    const fileTypeStats: Record<string, number> = {};
    
    // Use aggregation if available (but note: it counts chunks, not documents)
    if (searchResult.aggregations) {
      const fileTypesAgg = searchResult.aggregations.file_types as {
        buckets: Array<{ key: string; doc_count: number }>;
      };
      
      if (fileTypesAgg && fileTypesAgg.buckets) {
        // Aggregation counts chunks, so we need to recalculate from grouped documents
        // But we can use it as a hint for which file types exist
        for (const bucket of fileTypesAgg.buckets) {
          const fileType = normalizeFileType(bucket.key, undefined);
          fileTypeStats[fileType] = 0; // Initialize
        }
      }
    }
    
    // Count file types from unique documents
    for (const doc of documentMap.values()) {
      const mime = doc.metadata?.mime as string | undefined;
      const filename = doc.metadata?.filename as string | undefined;
      const fileType = normalizeFileType(mime, filename);
      fileTypeStats[fileType] = (fileTypeStats[fileType] || 0) + 1;
    }

    const statistics = Object.entries(fileTypeStats)
      .filter(([, count]: [string, number]) => count > 0) // Only include file types that have documents
      .map(([type, count]: [string, number]) => ({
        type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Total is number of unique documents, not chunks
    const totalDocuments = documentMap.size;

    metrics.processingTime = performance.now() - processStart;
    metrics.totalTime = performance.now() - startTime;

    const responseMetrics = {
      ...metrics,
      elasticsearchTook: searchResult.took || 0,
    };

    // Debug logging
    console.log("[autocomplete] Query:", q, "Total documents:", totalDocuments, "Chunk hits:", searchResult.hits.hits.length, "Indices:", indexPattern);

    return NextResponse.json({ 
      statistics,
      total: totalDocuments, // Number of unique documents, not chunks
      metrics: responseMetrics,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    console.error("Error autocomplete:", error);
    metrics.totalTime = performance.now() - startTime;
    return NextResponse.json({ 
      statistics: [], 
      total: 0,
      metrics: {
        ...metrics,
        elasticsearchTook: 0,
      },
    });
  }
}
