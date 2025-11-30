import { NextResponse } from "next/server";
import { requireAuth, hasTenantAccess, getUserAccessibleTenants } from "../../../lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "../../../lib/elasticsearch";
import { redis, getSearchCacheKey, checkRateLimit, getRateLimitKey } from "../../../lib/redis";
import { getFileType } from "../../../lib/file-types";

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
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const pageSize = parseInt(url.searchParams.get("pageSize") || "10", 10);
    const bypassCache = url.searchParams.get("bypassCache") === "true";
    const allowFuzzy = url.searchParams.get("allowFuzzy") === "true";

    // Allow empty query for "match all" (loading last documents)
    const isEmptyQuery = !q.trim();

    // Filter out common stop words from the query
    // These are words that don't add semantic meaning and can cause noise in search results
    const STOP_WORDS = new Set([
      "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
      "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
      "to", "was", "were", "will", "with", "the", "this", "they", "them",
      "these", "those", "what", "which", "who", "whom", "whose", "why",
      "how", "when", "where", "can", "could", "should", "would", "may",
      "might", "must", "shall", "do", "does", "did", "done", "have", "had",
      "has", "having", "been", "being", "become", "becomes", "became",
    ]);

    // Split query into terms and filter out stop words
    const queryTerms = isEmptyQuery 
      ? [] 
      : q.trim().split(/\s+/).filter(term => {
          const lowerTerm = term.toLowerCase().replace(/[^\w]/g, ''); // Remove punctuation
          return lowerTerm.length > 0 && !STOP_WORDS.has(lowerTerm);
        });

    // If all terms were stop words, use original query (edge case)
    const filteredQuery = isEmptyQuery 
      ? "" 
      : (queryTerms.length > 0 ? queryTerms.join(' ') : q.trim());
    const searchTerms = isEmptyQuery 
      ? [] 
      : (queryTerms.length > 0 ? queryTerms : [q.trim()]); // Use original if all filtered

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

    // Rate limiting - use first tenant or "all" if searching all tenants
    const rateLimitKey = getRateLimitKey(tenantsToSearch[0] || "all", user.id);
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


    // Check cache (skip if bypassCache is true)
    // Use filtered query for cache key to avoid duplicate caching
    const cacheStart = performance.now();
    let cached = null;
    let cacheKey: string | null = null;
    if (!bypassCache) {
      cacheKey = getSearchCacheKey(tenantsToSearch.join(","), filteredQuery);
      cached = await redis.get(cacheKey);
    }
    metrics.cacheCheckTime = performance.now() - cacheStart;
    
    if (cached && !bypassCache) {
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

    /**
     * Search Strategy: Chunk-level search with document-level grouping
     * 
     * Architecture:
     * - Each logical document is indexed as multiple overlapping chunks
     * - At query time, we search at chunk level to maximize recall
     * - Then group hits by document_id, collapsing multiple matching chunks into a single document result
     * - Document score = max chunk score (best matching chunk defines document relevance)
     * - Document snippet = highlighted content from the best scoring chunk
     * 
     * Implementation: App-Side Grouping
     * - We use app-side grouping (not ES collapsing) for flexibility
     * - ES returns chunk hits, we group by document_id in the API
     * - This gives us full control over aggregation logic
     * - Alternative: ES collapsing (see docs/SEARCH_GROUPING_STRATEGY.md)
     * 
     * This approach:
     * - Maximizes recall (finds matches even if query spans chunk boundaries)
     * - Presents clean document-level results to users (not chunks)
     * - Uses best chunk score for ranking (most relevant chunk = document relevance)
     */
    const indexPattern = tenantsToSearch.map((t) => getTenantIndex(t)).join(",");
    
    if (!indexPattern) {
      // No indices to search - return empty results
      metrics.elasticsearchTime = 0;
      metrics.processingTime = 0;
      metrics.totalTime = performance.now() - startTime;
      return NextResponse.json({
        results: [],
        facets: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        cached: false,
        metrics: {
          ...metrics,
        },
      });
    }
    
    // Two-phase search: exact match first, then fuzzy if no results
    const esStart = performance.now();
    let searchResult;
    let fuzzySearchUsed = false;
    const exactSearchMetrics = { time: 0, took: 0, hits: 0 };
    const fuzzySearchMetrics = { time: 0, took: 0, hits: 0 };
    
    const searchConfig = {
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
      size: isEmptyQuery 
        ? Math.max(1000, pageSize * 50) // For empty queries, fetch more chunks to ensure we get enough unique documents
        : Math.max(100, pageSize * 10), // For search queries, smaller size is fine
      sort: isEmptyQuery 
        ? [{ created_at: { order: "desc" } }] // Sort by creation date for empty query
        : [{ _score: { order: "desc" } }], // Sort by relevance for search queries
      collapse: isEmptyQuery 
        ? {
            field: "document_id", // Collapse to one chunk per document
            inner_hits: {
              name: "chunks",
              size: 1, // Only need one chunk per document for display
              sort: [{ chunk_index: { order: "asc" } }], // Get the first chunk
            },
          }
        : undefined, // Don't collapse for search queries - we want all matching chunks
      allow_no_indices: true,
      ignore_unavailable: true,
    };

    try {
      let exactResult;
      const exactSearchStart = performance.now();
      
      if (isEmptyQuery) {
        // Match all documents when query is empty
        exactResult = await elasticsearch.search({
          index: indexPattern,
          query: {
            match_all: {},
          },
          ...searchConfig,
        });
      } else {
        // Phase 1: Exact match with high title boost (with prefix matching for partial words like "dic" -> "dick")
        // This is NOT fuzzy - it only matches exact terms or prefixes, no character substitutions
        // Use filtered query (stop words removed) for better relevance
        
        exactResult = await elasticsearch.search({
          index: indexPattern,
          query: {
            bool: {
              should: [
              {
                // Exact phrase match in title (highest priority)
                match_phrase: {
                  title: {
                    query: filteredQuery,
                    boost: 20,
                  },
                },
              },
              {
                // Prefix match for each term in title (for "dic" -> "dick" type matches)
                // This allows partial word matching but is still "exact" (no character substitution)
                bool: {
                  must: searchTerms.map((term: string) => ({
                    prefix: {
                      title: {
                        value: term.toLowerCase(),
                        boost: 15,
                      },
                    },
                  })),
                },
              },
              {
                // Term match in title (high priority) - all terms must match exactly
                match: {
                  title: {
                    query: filteredQuery,
                    boost: 10,
                    operator: "and", // All terms must match
                  },
                },
              },
              {
                // Prefix match for each term in content
                bool: {
                  must: searchTerms.map((term: string) => ({
                    prefix: {
                      content: {
                        value: term.toLowerCase(),
                        boost: 2,
                      },
                    },
                  })),
                },
              },
              {
                // Term match in content (lower priority) - all terms must match exactly
                match: {
                  content: {
                    query: filteredQuery,
                    boost: 1,
                    operator: "and", // All terms must match
                  },
                },
              },
            ],
            minimum_should_match: 1,
          },
        },
        ...searchConfig,
      });
      }
      exactSearchMetrics.time = performance.now() - exactSearchStart;
      exactSearchMetrics.took = exactResult.took || 0;
      exactSearchMetrics.hits = typeof exactResult.hits.total === "object" 
        ? exactResult.hits.total.value 
        : exactResult.hits.total || 0;

      // For empty query, always use the match_all result
      // Note: When using collapse, ES returns one hit per document_id, so we need to handle inner_hits
      if (isEmptyQuery) {
        searchResult = exactResult;
        metrics.elasticsearchTime = exactSearchMetrics.time;
        
        // If collapse was used, expand the inner_hits to get the actual chunk data
        if (exactResult.hits.hits.length > 0 && exactResult.hits.hits[0].inner_hits) {
          // Replace collapsed hits with their inner_hits
          const expandedHits: typeof exactResult.hits.hits = [];
          for (const hit of exactResult.hits.hits) {
            const innerHits = (hit.inner_hits as { chunks?: { hits?: { hits?: typeof exactResult.hits.hits } } })?.chunks?.hits?.hits || [];
            if (innerHits.length > 0) {
              // Use the first inner hit (chunk) as the representative
              // Copy the _source and other properties from the inner hit
              expandedHits.push({
                ...innerHits[0],
                _source: innerHits[0]._source,
                _id: innerHits[0]._id,
                _score: hit._score || 1.0, // Use the collapsed hit's score
              } as typeof exactResult.hits.hits[0]);
            } else {
              // Fallback to the collapsed hit itself
              expandedHits.push(hit);
            }
          }
          exactResult.hits.hits = expandedHits;
          searchResult = exactResult;
        }
      } else {
        // Check if exact match found any results (after grouping by document_id)
        const exactDocumentMap = new Map<string, unknown>();
        for (const hit of exactResult.hits.hits) {
          const source = hit._source as { document_id: string; tenant_id: string };
          const documentKey = `${source.tenant_id}:${source.document_id}`;
          exactDocumentMap.set(documentKey, true);
        }

        if (exactDocumentMap.size > 0) {
          // Exact match found results - use it
          searchResult = exactResult;
          metrics.elasticsearchTime = exactSearchMetrics.time;
        } else if (allowFuzzy) {
          // No exact match and fuzzy is allowed - try fuzzy search
          // Fuzzy search allows character substitutions (e.g., "dack" -> "dick", "dick" -> "dock")
          // This is different from exact search which only allows prefix matching
          fuzzySearchUsed = true;
          const fuzzySearchStart = performance.now();
          const fuzzyResult = await elasticsearch.search({
            index: indexPattern,
            query: {
              bool: {
                should: [
                  {
                    // Fuzzy match in title with character substitution (AUTO fuzziness)
                    // Use "or" operator to be more lenient - at least one term should match
                    multi_match: {
                      query: filteredQuery,
                      fields: ["title^10", "content"],
                      type: "best_fields",
                      fuzziness: "AUTO", // Allows 0-2 character edits based on term length
                      operator: "or", // At least one term should match (more lenient than "and")
                    },
                  },
                  ...(searchTerms.length > 0 ? [{
                    // Also try individual fuzzy matches for each term in both title and content (more flexible)
                    bool: {
                      should: searchTerms.flatMap((term: string) => [
                        {
                          match: {
                            title: {
                              query: term,
                              fuzziness: "AUTO",
                              boost: 8,
                            },
                          },
                        },
                        {
                          match: {
                            content: {
                              query: term,
                              fuzziness: "AUTO",
                              boost: 1,
                            },
                          },
                        },
                      ]),
                      minimum_should_match: 1,
                    },
                  }] : []),
                  ...(searchTerms.length > 0 ? [{
                    // Also try prefix matching in fuzzy mode (for partial words like "dic" -> "dick")
                    bool: {
                      should: searchTerms.map((term: string) => ({
                        prefix: {
                          title: {
                            value: term.toLowerCase(),
                            boost: 5,
                          },
                        },
                      })),
                      minimum_should_match: 1,
                    },
                  }] : []),
                ],
                minimum_should_match: 1,
              },
            },
            ...searchConfig,
          });
          fuzzySearchMetrics.time = performance.now() - fuzzySearchStart;
          fuzzySearchMetrics.took = fuzzyResult.took || 0;
          fuzzySearchMetrics.hits = typeof fuzzyResult.hits.total === "object" 
            ? fuzzyResult.hits.total.value 
            : fuzzyResult.hits.total || 0;
          
          searchResult = fuzzyResult;
          metrics.elasticsearchTime = exactSearchMetrics.time + fuzzySearchMetrics.time;
        } else {
          // No exact match and fuzzy not allowed - return empty results
          searchResult = exactResult; // Use exact result (empty)
          metrics.elasticsearchTime = exactSearchMetrics.time;
        }
      }
    } catch (esError: unknown) {
      metrics.elasticsearchTime = performance.now() - esStart;
      console.error("Elasticsearch search error:", esError);
      if (esError instanceof Error) {
        console.error("Elasticsearch error details:", {
          message: esError.message,
          stack: esError.stack,
          indexPattern,
        });
      }
      // Return empty results instead of failing
      metrics.processingTime = 0;
      metrics.totalTime = performance.now() - startTime;
      return NextResponse.json({
        results: [],
        facets: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        cached: false,
        fuzzySearchUsed: false,
        exactSearchMetrics: null,
        fuzzySearchMetrics: null,
        metrics: {
          ...metrics,
        },
      });
    }

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

    /**
     * Group chunk hits by document_id to return documents, not chunks.
     * 
     * Mental model: Result = one logical document
     * - Score: max(_score) of all matching chunks (best chunk defines document relevance)
     * - Snippet: highlighted content from the best scoring chunk
     * - Multiple chunks: aggregate highlights from top chunks
     * 
     * Pipeline: ES returns chunks → group by document_id → compute one document result per group
     */
    const documentMap = new Map<
      string, // Key: `${tenant_id}:${document_id}` to ensure uniqueness across tenants
      {
        document_id: string;
        tenant_id: string;
        title: string;
        fileType: string;
        highlights: string[];
        titleHighlight: string;
        score: number; // Document score = max chunk score
        bestChunkScore: number;
        chunkCount: number;
        highlightCount: number; // Total number of highlight fragments found
        metadata?: Record<string, unknown>;
      }
    >();

    for (const hit of searchResult.hits.hits) {
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
      const score = hit._score || 0;
      
      // Use composite key to ensure uniqueness across tenants
      // (document_id might not be globally unique, but tenant_id + document_id is)
      const documentKey = `${source.tenant_id}:${source.document_id}`;

      if (!documentMap.has(documentKey)) {
        // First chunk for this document - initialize
        const contentHighlights = highlights.content || [];
        documentMap.set(documentKey, {
          document_id: source.document_id,
          tenant_id: source.tenant_id,
          title: source.title,
          fileType: getFileType(source.metadata),
          highlights: contentHighlights.slice(0, 2), // Limit to 2 highlights
          titleHighlight: highlights.title?.[0] || source.title,
          score: score, // Document score = max chunk score
          bestChunkScore: score,
          chunkCount: 1,
          highlightCount: contentHighlights.length, // Track total highlight count
          metadata: source.metadata,
        });
      } else {
        // Additional chunk for this document - aggregate
        const existing = documentMap.get(documentKey)!;
        existing.chunkCount += 1;
        
        const contentHighlights = highlights.content || [];
        existing.highlightCount += contentHighlights.length; // Accumulate highlight count
        
        // Document score = max chunk score (best matching chunk defines document relevance)
        if (score > existing.bestChunkScore) {
          existing.score = score; // Update document score
          existing.bestChunkScore = score;
          
          // Update snippet with best chunk's highlights (limit to 2)
          if (contentHighlights.length > 0) {
            existing.highlights = contentHighlights.slice(0, 2);
          }
          if (highlights.title && highlights.title.length > 0) {
            existing.titleHighlight = highlights.title[0];
          }
        } else {
          // Merge highlights from other high-scoring chunks (limit to 2 total)
          // This gives users context from multiple parts of the document
          if (contentHighlights.length > 0) {
            // Combine all highlights, remove duplicates, then take first 2
            const allHighlights = [
              ...existing.highlights,
              ...contentHighlights,
            ]
              .filter((h, i, arr) => arr.indexOf(h) === i); // Remove duplicates
            
            existing.highlights = allHighlights.slice(0, 2); // Limit to 2 highlights
          }
        }
      }
    }

    // Convert map to array and sort by document score (descending)
    // This ensures documents with the best matching chunks appear first
    const allResults = Array.from(documentMap.values()).sort((a, b) => b.score - a.score);
    
    // Paginate at document level (not chunk level)
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const results = allResults.slice(startIndex, endIndex);

    const facets = Object.entries(fileTypeFacets)
      .map(([type, count]) => ({
        type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    metrics.processingTime = performance.now() - processStart;
    metrics.totalTime = performance.now() - startTime;

    /**
     * Response format: documents, not chunks
     * - total: total number of unique documents (after grouping, before pagination)
     * - totalChunks: total chunk hits from ES (for reference/debugging)
     * - results: paginated array of document results, each with:
     *   - document_id, title, score (max chunk score), snippet (from best chunk)
     * - page: current page number
     * - pageSize: documents per page
     */
    const responseData = {
      results,
      facets,
      total: allResults.length, // Total unique documents (before pagination)
      totalChunks: typeof searchResult.hits.total === "object" 
        ? searchResult.hits.total.value 
        : searchResult.hits.total || 0, // Total chunk hits from ES (for reference)
      page,
      pageSize,
      totalPages: Math.ceil(allResults.length / pageSize),
      cached: false,
      fuzzySearchUsed,
      exactSearchMetrics: fuzzySearchUsed ? {
        time: exactSearchMetrics.time,
        took: exactSearchMetrics.took,
        hits: exactSearchMetrics.hits,
      } : null,
      fuzzySearchMetrics: fuzzySearchUsed ? {
        time: fuzzySearchMetrics.time,
        took: fuzzySearchMetrics.took,
        hits: fuzzySearchMetrics.hits,
      } : null,
      metrics: {
        ...metrics,
        elasticsearchTook: searchResult.took || 0, // ES internal timing
      },
    };

    // Cache results for 5 minutes (without metrics for consistency)
    if (!bypassCache && cacheKey) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { metrics: _metrics, ...dataToCache } = responseData;
      await redis.setex(cacheKey, 300, JSON.stringify(dataToCache));
    }

    return NextResponse.json(responseData);
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error searching:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        message: error.message,
        stack: error.stack,
      });
    }
    return NextResponse.json(
      { 
        error: "Failed to search documents",
        ...(process.env.NODE_ENV === "development" && error instanceof Error && {
          details: error.message,
        }),
      },
      { status: 500 }
    );
  }
}
