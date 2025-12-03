"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useDebounce } from "use-debounce";
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
import { SortableTableHeader } from "@/components/sortable-table-header";
import { TablePagination } from "@/components/table-pagination";
import { usePersistedPageSize } from "@/hooks/use-persisted-page-size";

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

  const [query, setQuery] = useState(initialQuery);
  // Default to "all" (empty string) for "All tenants"
  const [tenant, setTenant] = useState(initialTenant || "all");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedPageSize();
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [userTenants, setUserTenants] = useState<Array<{ slug: string; name: string }>>([]);
  const [bypassCache, setBypassCache] = useState(initialBypassCache);
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
  } | null>(null);
  
  // Debounced statistics for autocomplete
  const [debouncedQuery] = useDebounce(query, 300);
  const [statisticsTotal, setStatisticsTotal] = useState(0);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsQueryTime, setStatisticsQueryTime] = useState<number | null>(null);

  // Fetch user's accessible tenants
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const response = await fetch("/api/tenants/accessible");
        if (response.ok) {
          const data = await response.json();
          setUserTenants(data.tenants || []);
        }
      } catch (error) {
        console.error("Error fetching tenants:", error);
      }
    };
    fetchTenants();
  }, []);

  // Fetch debounced statistics for autocomplete
  const fetchStatistics = useCallback(async (searchQuery: string, searchTenant: string) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setStatisticsTotal(0);
      setStatisticsQueryTime(null);
      return;
    }

    setStatisticsLoading(true);
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        ...(searchTenant && searchTenant !== "all" && { tenant: searchTenant }),
      });

      const response = await fetch(`/api/search/autocomplete?${params}`);
      if (response.ok) {
        const data = await response.json();
        const total = data.total ?? 0;
        const queryTime = data.metrics?.totalTime ?? null;
        
        setStatisticsTotal(total);
        setStatisticsQueryTime(queryTime);
        
        // Debug logging
        if (total === 0 && searchQuery.length >= 2) {
          console.log("[SearchPage] Autocomplete returned 0 documents for query:", searchQuery, {
            statistics: data.statistics,
            metrics: data.metrics,
            total: data.total,
          });
        }
      } else {
        const errorText = await response.text();
        console.error("[SearchPage] Autocomplete API error:", response.status, errorText);
        setStatisticsTotal(0);
        setStatisticsQueryTime(null);
      }
    } catch (error) {
      console.error("Error fetching statistics:", error);
      setStatisticsTotal(0);
      setStatisticsQueryTime(null);
    } finally {
      setStatisticsLoading(false);
    }
  }, []);

  // Fetch statistics when debounced query changes
  useEffect(() => {
    const tenantParam = tenant === "all" ? "" : tenant;
    fetchStatistics(debouncedQuery, tenantParam);
  }, [debouncedQuery, tenant, fetchStatistics]);

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

  // Perform search when query or tenant changes (only if query came from URL params)
  useEffect(() => {
    if (initialQuery) {
      // If tenant is "all", pass empty string to search all tenants
      const tenantParam = tenant === "all" ? "" : tenant;
      setHasSearched(true); // Mark as searched since we have an initial query
      performSearch(initialQuery, tenantParam, initialBypassCache);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performSearch = async (searchQuery: string, searchTenant: string, bypassCache?: boolean) => {
    // Only perform search if we have a query
    if (!searchQuery.trim()) {
      return;
    }
    
    setLoading(true);
    setHasSearched(true); // Mark that an explicit search has been performed
    setLastSearchedQuery(searchQuery.trim()); // Track the query that was searched
    setMetrics(null);
    // Don't clear statistics - keep them visible while typing
    const browserStart = performance.now();
    
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        // Empty tenant param means "All tenants" - search all accessible tenants
        // Only filter if a specific tenant is selected
        ...(searchTenant && searchTenant !== "all" && { tenant: searchTenant }),
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(sortBy && { sortBy, sortOrder }),
        ...(bypassCache && { bypassCache: 'true' }),
      });

      const fetchStart = performance.now();
      // Add cache-busting header if bypassing cache
      const headers: HeadersInit = bypassCache 
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

  const handleSearch = (searchQuery: string, bypassCacheParam?: boolean) => {
    // Update query state first
    setQuery(searchQuery);
    const bypass = bypassCacheParam !== undefined ? bypassCacheParam : bypassCache;
    // If tenant is "all", pass empty string to search all tenants
    const tenantParam = tenant === "all" ? "" : tenant;
    // Perform search - this will update results and set hasSearched to true
    performSearch(searchQuery, tenantParam, bypass);
  };

  const handleBypassCacheChange = (checked: boolean) => {
    setBypassCache(checked);
    // Don't trigger search automatically - only update the checkbox state
    // User must click "Search" button to perform search
  };

  const handleTenantChange = (newTenant: string) => {
    setTenant(newTenant);
    // Don't trigger search automatically - only update the tenant selection
    // User must click "Search" button to perform search
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
    setPage(1); // Reset to first page when sorting changes
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Trigger search with new page
    if (query) {
      performSearch(query, tenant === "all" ? "" : tenant, bypassCache);
    }
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1); // Reset to first page when page size changes
    // Trigger search with new page size
    if (query) {
      performSearch(query, tenant === "all" ? "" : tenant, bypassCache);
    }
  };

  // Re-trigger search when sort changes
  useEffect(() => {
    if (hasSearched && query) {
      performSearch(query, tenant === "all" ? "" : tenant, bypassCache);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortOrder]);

  const getDocumentUrl = (result: SearchResult): string => {
    return `/documents/${result.document_id}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Search" },
        ]}
        title="Search Documents"
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
                    <SelectItem value="all">All Tenants</SelectItem>
                    {userTenants.map((t: { slug: string; name: string }) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.name}
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
                isLoading={loading}
              />
              
              {/* Query Statistics below input - show when typing (debounced), even after a search */}
              {debouncedQuery.length >= 2 && (
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
              )}
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
              Found {total} document{total !== 1 ? "s" : ""}
            </p>

            {/* Results Table */}
            <Card>
              <CardContent className="p-0">
                {/* Pagination controls at top right */}
                <TablePagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  totalPages={Math.ceil(total / pageSize)}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                  loading={loading}
                  position="top"
                />
                <div className="overflow-x-auto">
                    <Table className="table-fixed w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">File Type</TableHead>
                          <TableHead className="w-[200px]">
                            <SortableTableHeader
                              column="title"
                              currentSortBy={sortBy}
                              currentSortOrder={sortOrder}
                              onSort={handleSort}
                            >
                              Document Name
                            </SortableTableHeader>
                          </TableHead>
                          <TableHead className="w-[120px]">
                            <SortableTableHeader
                              column="tenant_id"
                              currentSortBy={sortBy}
                              currentSortOrder={sortOrder}
                              onSort={handleSort}
                            >
                              Tenant
                            </SortableTableHeader>
                          </TableHead>
                          <TableHead className="w-[250px]">Highlights</TableHead>
                          <TableHead className="w-[80px] text-right">
                            <SortableTableHeader
                              column="_score"
                              currentSortBy={sortBy}
                              currentSortOrder={sortOrder}
                              onSort={handleSort}
                              className="justify-end"
                            >
                              Score
                            </SortableTableHeader>
                          </TableHead>
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
                          <TableCell className="w-[200px]">
                            <div className="break-words overflow-wrap-anywhere">
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Link
                                      href={getDocumentUrl(result)}
                                      className="text-primary hover:underline font-medium text-sm break-words overflow-wrap-anywhere"
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
                          <TableCell className="w-[120px]">
                            <Badge variant="outline" className="text-xs truncate max-w-full block">
                              {result.tenant_id}
                            </Badge>
                          </TableCell>
                        <TableCell className="w-[250px]">
                          <div className="space-y-1">
                            {result.highlights.slice(0, 2).map((highlight: string, idx: number) => (
                              <div
                                key={idx}
                                className="text-xs break-words overflow-wrap-anywhere"
                                style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
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

        {/* Only show "enter query" when there's no query and no explicit search has been performed */}
        {!query && !hasSearched && !loading && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                Enter a search query to find documents
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
