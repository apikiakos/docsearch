"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import SearchAutocomplete from "@/components/search-autocomplete";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { SearchMetrics } from "@/components/search-metrics";
import { getFileTypeInfo } from "@/lib/file-types";

type SearchResult = {
  id?: string; // Optional since we're grouping by document_id
  document_id: string;
  tenant_id: string;
  title: string;
  fileType: string;
  highlights: string[];
  titleHighlight: string;
  score: number;
  chunkCount?: number; // Number of matching chunks for this document
  highlightCount?: number; // Total number of highlight fragments found
  metadata?: Record<string, unknown>;
};


export default function SearchPage() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialTenant = searchParams.get("tenant") || "";
  const initialBypassCache = searchParams.get("bypassCache") === "true";
  const initialAllowFuzzy = searchParams.get("allowFuzzy") === "true";

  const [query, setQuery] = useState(initialQuery);
  // Default to "all" (empty string) for "All tenants"
  const [tenant, setTenant] = useState(initialTenant || "all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [userTenants, setUserTenants] = useState<Array<{ slug: string; name: string; documentCount: number }>>([]);
  const [totalDocuments, setTotalDocuments] = useState<number>(0);
  const [bypassCache, setBypassCache] = useState(initialBypassCache);
  const [allowFuzzy, setAllowFuzzy] = useState(false);
  const [hasSearched, setHasSearched] = useState(false); // Track if user has performed an explicit search
  const [lastSearchedQuery, setLastSearchedQuery] = useState<string>(""); // Track the last query that was searched
  const [metrics, setMetrics] = useState<{
    apiStart?: number;
    authTime?: number;
    tenantResolutionTime?: number;
    cacheCheckTime?: number;
    elasticsearchTime?: number;
    elasticsearchTook?: number;
    processingTime?: number;
    totalTime?: number;
    cached?: boolean;
    browserToApi?: number;
    apiToBrowser?: number;
    fuzzySearchUsed?: boolean;
    exactSearchMetrics?: { time: number; took: number; hits: number } | null;
    fuzzySearchMetrics?: { time: number; took: number; hits: number } | null;
  } | null>(null);
  
  // Debounced statistics for autocomplete (temporarily disabled)
  // const [debouncedQuery] = useDebounce(query, 300);
  // const [statisticsTotal, setStatisticsTotal] = useState(0);
  // const [statisticsLoading, setStatisticsLoading] = useState(false);
  // const [statisticsQueryTime, setStatisticsQueryTime] = useState<number | null>(null);

  // Fetch user's accessible tenants with document counts
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const response = await fetch("/api/tenants/accessible");
        if (response.ok) {
          const data = await response.json();
          console.log("[DocumentsPage] Fetched tenants:", data);
          setUserTenants(data.tenants || []);
          setTotalDocuments(data.totalDocuments || 0);
        } else {
          const errorText = await response.text();
          console.error("[DocumentsPage] Error fetching tenants:", response.status, errorText);
        }
      } catch (error) {
        console.error("Error fetching tenants:", error);
      }
    };
    fetchTenants();
  }, []);

  // Fetch debounced statistics for autocomplete (temporarily disabled)
  // const fetchStatistics = useCallback(async (searchQuery: string, searchTenant: string) => {
  //   if (!searchQuery.trim() || searchQuery.length < 2) {
  //     setStatisticsTotal(0);
  //     setStatisticsQueryTime(null);
  //     return;
  //   }
  //
  //   setStatisticsLoading(true);
  //   try {
  //     const params = new URLSearchParams({
  //       q: searchQuery,
  //       ...(searchTenant && searchTenant !== "all" && { tenant: searchTenant }),
  //     });
  //
  //     const response = await fetch(`/api/search/autocomplete?${params}`);
  //     if (response.ok) {
  //       const data = await response.json();
  //       const total = data.total ?? 0;
  //       const queryTime = data.metrics?.totalTime ?? null;
  //       
  //       setStatisticsTotal(total);
  //       setStatisticsQueryTime(queryTime);
  //       
  //       // Debug logging
  //       if (total === 0 && searchQuery.length >= 2) {
  //         console.log("[SearchPage] Autocomplete returned 0 documents for query:", searchQuery, {
  //           statistics: data.statistics,
  //           metrics: data.metrics,
  //           total: data.total,
  //         });
  //       }
  //     } else {
  //       const errorText = await response.text();
  //       console.error("[SearchPage] Autocomplete API error:", response.status, errorText);
  //       setStatisticsTotal(0);
  //       setStatisticsQueryTime(null);
  //     }
  //   } catch (error) {
  //     console.error("Error fetching statistics:", error);
  //     setStatisticsTotal(0);
  //     setStatisticsQueryTime(null);
  //   } finally {
  //     setStatisticsLoading(false);
  //   }
  // }, []);

  // Temporarily disabled: Fetch statistics when debounced query changes
  // This was using a different query (old fuzzy logic) and doesn't match the new exact/fuzzy search
  // TODO: Re-enable with updated autocomplete API that uses the same exact/fuzzy logic
  // useEffect(() => {
  //   const tenantParam = tenant === "all" ? "" : tenant;
  //   fetchStatistics(debouncedQuery, tenantParam);
  // }, [debouncedQuery, tenant, fetchStatistics]);

  // Clear results when query changes after a search (user is typing a new query)
  useEffect(() => {
    // If user has searched and is now typing a different query, clear old results
    if (hasSearched && query !== lastSearchedQuery && query.trim() !== lastSearchedQuery.trim()) {
      setResults([]);
      setTotal(0);
      setMetrics(null);
      // Don't set hasSearched to false - we want to keep the "has searched" state
      // but clear the results so they don't see stale data
    }
  }, [query, hasSearched, lastSearchedQuery]);

  // Load last 20 documents on mount if no initial query, or perform search if query exists
  useEffect(() => {
    if (initialQuery) {
      // If tenant is "all", pass empty string to search all tenants
      const tenantParam = tenant === "all" ? "" : tenant;
      setHasSearched(true); // Mark as searched since we have an initial query
      performSearch(initialQuery, tenantParam, initialBypassCache, initialAllowFuzzy);
    } else {
      // No initial query - load last 20 documents
      loadLastDocuments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadLastDocuments = async () => {
    setLoading(true);
    setHasSearched(true);
    const browserStart = performance.now();

    try {
      // Search for all documents using empty query (triggers match_all in API)
      const tenantParam = tenant === "all" ? "" : tenant;
      const params = new URLSearchParams({
        q: "", // Empty query will match all documents
        // Empty tenant param means "All tenants" - search all accessible tenants
        // Only filter if a specific tenant is selected
        ...(tenantParam && tenantParam !== "all" && { tenant: tenantParam }),
        page: "1",
        pageSize: "20",
        ...(bypassCache && { bypassCache: "true" }),
        ...(allowFuzzy && { allowFuzzy: "true" }),
      });

      const fetchStart = performance.now();
      const headers: HeadersInit = bypassCache
        ? { "Cache-Control": "no-cache", Pragma: "no-cache" }
        : {};

      const response = await fetch(`/api/search?${params}`, { headers });
      const fetchEnd = performance.now();
      const browserToApi = fetchStart - browserStart;
      const apiToBrowser = performance.now() - fetchEnd;

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
        setTotal(data.total || 0);

        if (data.metrics) {
          setMetrics({
            ...data.metrics,
            browserToApi,
            apiToBrowser,
            fuzzySearchUsed: data.fuzzySearchUsed || false,
            exactSearchMetrics: data.exactSearchMetrics || null,
            fuzzySearchMetrics: data.fuzzySearchMetrics || null,
          });
        }
      } else {
        const errorText = await response.text();
        console.error("Search API error:", response.status, errorText);
        setResults([]);
        setTotal(0);
        setMetrics(null);
      }
    } catch (error) {
      console.error("Error loading documents:", error);
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (searchQuery: string, searchTenant: string, bypassCacheParam?: boolean, allowFuzzyParam?: boolean) => {
    // If empty query, load last documents instead
    if (!searchQuery.trim()) {
      loadLastDocuments();
      return;
    }
    
    setLoading(true);
    setHasSearched(true); // Mark that an explicit search has been performed
    setLastSearchedQuery(searchQuery.trim()); // Track the query that was searched
    setMetrics(null);
    // Don't clear statistics - keep them visible while typing
    const browserStart = performance.now();
    
    const bypass = bypassCacheParam !== undefined ? bypassCacheParam : bypassCache;
    const fuzzy = allowFuzzyParam !== undefined ? allowFuzzyParam : allowFuzzy;
    
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        // Empty tenant param means "All tenants" - search all accessible tenants
        // Only filter if a specific tenant is selected
        ...(searchTenant && searchTenant !== "all" && { tenant: searchTenant }),
        ...(bypass && { bypassCache: 'true' }),
        ...(fuzzy && { allowFuzzy: 'true' }),
      });

      const fetchStart = performance.now();
      // Add cache-busting header if bypassing cache
      const headers: HeadersInit = bypass 
        ? { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        : {};
      
      const response = await fetch(`/api/search?${params}`, { headers });
      const fetchEnd = performance.now();
      const browserToApi = fetchStart - browserStart;
      const apiToBrowser = performance.now() - fetchEnd;

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
        setTotal(data.total || 0);
        
        // Combine browser and API metrics
        if (data.metrics) {
          setMetrics({
            ...data.metrics,
            browserToApi,
            apiToBrowser,
            fuzzySearchUsed: data.fuzzySearchUsed || false,
            exactSearchMetrics: data.exactSearchMetrics || null,
            fuzzySearchMetrics: data.fuzzySearchMetrics || null,
          });
        }
      } else {
        const errorText = await response.text();
        console.error("Search API error:", response.status, errorText);
        setResults([]);
        setTotal(0);
        setMetrics(null);
      }
    } catch (error) {
      console.error("Error searching:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (searchQuery: string, bypassCacheParam?: boolean, allowFuzzyParam?: boolean) => {
    // Update query state first
    setQuery(searchQuery);
    const bypass = bypassCacheParam !== undefined ? bypassCacheParam : bypassCache;
    const fuzzy = allowFuzzyParam !== undefined ? allowFuzzyParam : allowFuzzy;
    // If tenant is "all", pass empty string to search all tenants
    const tenantParam = tenant === "all" ? "" : tenant;
    // Perform search - this will update results and set hasSearched to true
    performSearch(searchQuery, tenantParam, bypass, fuzzy);
  };

  const handleBypassCacheChange = (checked: boolean) => {
    setBypassCache(checked);
    // Don't trigger search automatically - only update the checkbox state
    // User must click "Search" button to perform search
  };

  const handleAllowFuzzyChange = (checked: boolean) => {
    setAllowFuzzy(checked);
    // Don't trigger search automatically - only update the checkbox state
    // User must click "Search" button to perform search
  };

  const handleTenantChange = (newTenant: string) => {
    setTenant(newTenant);
    // Don't trigger search automatically - only update the tenant selection
    // User must click "Search" button to perform search
  };

  const getDocumentUrl = (result: SearchResult): string => {
    return `/dashboard/documents/${result.document_id}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Documents" },
          ]}
        title="Documents"
        subtitle="Search through indexed documents across your accessible tenants"
      />

      <div className="space-y-4">
        {/* Search Form and Metrics - Two Column Layout */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* Left Column: Search Form */}
          <Card>
            <CardHeader>
              <CardTitle>Search</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tenant select - first */}
              {userTenants.length > 0 && (
                <Select value={tenant} onValueChange={handleTenantChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All Tenants ({totalDocuments.toLocaleString()})
                    </SelectItem>
                    {userTenants.map((t: { slug: string; name: string; documentCount: number }) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.name} ({t.documentCount.toLocaleString()})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              
              {/* Search input, checkbox, and button */}
              <SearchAutocomplete
                value={query}
                onChange={setQuery}
                tenantSlug={tenant === "all" ? undefined : tenant}
                onSearch={handleSearch}
                onBypassCacheChange={handleBypassCacheChange}
                bypassCache={bypassCache}
                onAllowFuzzyChange={handleAllowFuzzyChange}
                allowFuzzy={allowFuzzy}
                isLoading={loading}
              />
              
              {/* Query Statistics below input - temporarily disabled */}
              {/* The debounced statistics use a different query (old fuzzy logic) and don't match the new exact/fuzzy search */}
              {/* TODO: Re-enable with updated autocomplete API that uses the same exact/fuzzy logic */}
              {/* {debouncedQuery.length >= 2 && (
                <div className="pt-2 border-t space-y-2">
                  {statisticsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Loading statistics...</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Documents:</span>
                        <span className="font-medium">{statisticsTotal.toLocaleString()}</span>
                      </div>
                      {statisticsQueryTime !== null && statisticsQueryTime > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Query time:</span>
                          <span className="font-medium">{statisticsQueryTime.toFixed(0)} ms</span>
                        </div>
                      )}
                      {statisticsTotal === 0 && debouncedQuery.length >= 2 && !statisticsLoading && (
                        <p className="text-xs text-muted-foreground">No documents found</p>
                      )}
                      {hasSearched && query !== debouncedQuery && (
                        <p className="text-xs text-muted-foreground italic">
                          Click &quot;Search&quot; to update results
                        </p>
                      )}
                    </>
                  )}
                </div>
              )} */}
            </CardContent>
          </Card>

          {/* Right Column: Performance Metrics Only */}
          {metrics && (
            <SearchMetrics metrics={metrics} />
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {/* Only show results table when we have an explicit search (not just typing) */}
        {!loading && hasSearched && results.length > 0 && (
          <div className="space-y-4">
            {/* Results Summary */}
            <p className="text-sm text-muted-foreground">
              Found {total} document{total !== 1 ? "s" : ""} {query ? "(sorted by relevance)" : "(sorted by creation date)"}
            </p>

            {/* Results Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table className="table-fixed w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">File Type</TableHead>
                          <TableHead className="w-[200px]">Document Name</TableHead>
                          <TableHead className="w-[120px]">Tenant</TableHead>
                          <TableHead className="w-[250px]">Highlights</TableHead>
                          <TableHead className="w-[80px] text-right">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                    <TableBody>
                      {results.map((result: SearchResult) => {
                        const fileTypeInfo = getFileTypeInfo(result.fileType);
                        const FileIcon = fileTypeInfo.icon;
                        return (
                        <TableRow key={result.document_id}>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-xs">{fileTypeInfo.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="w-[200px] max-w-[200px] min-w-[200px] whitespace-normal!">
                            <div className="w-full max-w-full overflow-hidden">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      href={getDocumentUrl(result)}
                                      className="text-primary hover:underline font-medium text-sm block w-full max-w-full"
                                      style={{ 
                                        wordBreak: "break-word", 
                                        overflowWrap: "anywhere",
                                        maxWidth: "100%"
                                      }}
                                    >
                                      <span dangerouslySetInnerHTML={{ __html: result.titleHighlight }} />
                                    </Link>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="max-w-xs break-all">
                                      {getDocumentUrl(result)}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              {result.chunkCount && result.chunkCount > 1 && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {result.chunkCount} matching chunks
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="w-[120px] max-w-[120px] min-w-[120px]">
                            <Badge variant="outline" className="text-xs truncate max-w-full block">
                              {result.tenant_id}
                            </Badge>
                          </TableCell>
                        <TableCell className="w-[250px] max-w-[250px] min-w-[250px] whitespace-normal!">
                          <div className="space-y-1 w-full max-w-full overflow-hidden">
                            {result.highlights.slice(0, 2).map((highlight: string, idx: number) => (
                              <div
                                key={idx}
                                className="text-xs w-full max-w-full"
                                style={{ 
                                  wordBreak: "break-word", 
                                  overflowWrap: "anywhere",
                                  maxWidth: "100%",
                                  overflow: "hidden"
                                }}
                                dangerouslySetInnerHTML={{ __html: highlight }}
                              />
                            ))}
                            {result.highlightCount && result.highlightCount > 2 && (
                              <div className="text-xs text-muted-foreground pt-1">
                                +{result.highlightCount - 2} more match{result.highlightCount - 2 !== 1 ? "es" : ""} in other chunks
                              </div>
                            )}
                          </div>
                        </TableCell>
                          <TableCell className="text-right whitespace-nowrap w-[80px]">
                            <span className="text-sm text-muted-foreground">
                              {result.score.toFixed(2)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Only show "no results" when we have an explicit search (not just typing) */}
        {!loading && hasSearched && results.length === 0 && query && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No results found for &quot;{query}&quot;</p>
            </CardContent>
          </Card>
        )}

                {/* Only show "no documents" when we have searched but found nothing and there's no query */}
                {!loading && hasSearched && results.length === 0 && !query && (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <p className="text-muted-foreground">
                        No documents indexed yet
                      </p>
                    </CardContent>
                  </Card>
                )}
      </div>
    </div>
  );
}
