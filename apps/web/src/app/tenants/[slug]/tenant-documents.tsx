"use client";

import { useState, useEffect, useMemo } from "react";
import SearchAutocomplete from "@/components/search-autocomplete";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { SearchMetrics } from "@/components/search-metrics";
import { getFileTypeInfo } from "@/lib/file-types";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { TablePagination } from "@/components/table-pagination";
import { usePersistedPageSize } from "@/hooks/use-persisted-page-size";
import { DocumentActions } from "@/components/document-actions";

type SearchResult = {
  document_id: string;
  tenant_id: string;
  title: string;
  fileType: string;
  highlights: string[];
  titleHighlight: string;
  score: number;
  chunkCount?: number;
  highlightCount?: number;
  metadata?: Record<string, unknown>;
};

interface TenantDocumentsProps {
  tenantSlug: string;
  userRole?: "platform_admin" | "tenant_admin" | "tenant_user";
}

export function TenantDocuments({ tenantSlug, userRole }: TenantDocumentsProps) {
  const [query, setQuery] = useState("");
  const [filenameFilter, setFilenameFilter] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePersistedPageSize();
  const [sortBy, setSortBy] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [bypassCache, setBypassCache] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
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

  // Load last documents on mount
  useEffect(() => {
    loadLastDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug, pageSize]);

  const loadLastDocuments = async (forceBypassCache?: boolean) => {
    setLoading(true);
    setHasSearched(true);
    const browserStart = performance.now();

    try {
      // Search for all documents using a match_all query (empty string triggers match_all in our API)
      const shouldBypassCache = forceBypassCache !== undefined ? forceBypassCache : bypassCache;
      const params = new URLSearchParams({
        q: "", // Empty query will match all documents
        tenant: tenantSlug,
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(sortBy && { sortBy, sortOrder }),
        ...(shouldBypassCache && { bypassCache: "true" }),
      });

      const fetchStart = performance.now();
      const headers: HeadersInit = shouldBypassCache
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
      console.error("Error searching:", error);
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (
    searchQuery: string,
    bypassCacheParam?: boolean
  ) => {
    if (!searchQuery.trim()) {
      // If empty query, load last documents
      loadLastDocuments();
      return;
    }

    setLoading(true);
    setHasSearched(true);
    setMetrics(null);
    const browserStart = performance.now();

    const bypass = bypassCacheParam !== undefined ? bypassCacheParam : bypassCache;

    try {
      const params = new URLSearchParams({
        q: searchQuery,
        tenant: tenantSlug, // Always use this tenant
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(sortBy && { sortBy, sortOrder }),
        ...(bypass && { bypassCache: "true" }),
      });

      const fetchStart = performance.now();
      const headers: HeadersInit = bypass
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
      console.error("Error searching:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (
    searchQuery: string,
    bypassCacheParam?: boolean
  ) => {
    setQuery(searchQuery);
    const bypass = bypassCacheParam !== undefined ? bypassCacheParam : bypassCache;
    performSearch(searchQuery, bypass);
  };

  const handleBypassCacheChange = (checked: boolean) => {
    setBypassCache(checked);
    // Trigger reload when bypass cache is toggled
    if (query.trim()) {
      performSearch(query, checked);
    } else {
      setPage(1);
      loadLastDocuments();
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    // Reload data with new page (only if not filtering by filename)
    if (query.trim() || !filenameFilter.trim()) {
      if (query.trim()) {
        performSearch(query, bypassCache);
      } else {
        loadLastDocuments();
      }
    }
  };

  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setPage(1); // Reset to first page when changing page size
    // Reload data with new page size (only if not filtering by filename)
    if (query.trim() || !filenameFilter.trim()) {
      if (query.trim()) {
        performSearch(query, bypassCache);
      } else {
        loadLastDocuments();
      }
    }
  };

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column);
    setSortOrder(order);
    setPage(1); // Reset to first page when sorting
  };

  // Filter results by filename when not doing keyword search (query is empty)
  const filteredResults = useMemo(() => {
    if (!query.trim() && filenameFilter.trim()) {
      const filterLower = filenameFilter.toLowerCase();
      return results.filter((result) =>
        result.title.toLowerCase().includes(filterLower)
      );
    }
    return results;
  }, [results, query, filenameFilter]);

  // Recalculate pagination for filtered results
  const filteredTotal = useMemo(() => {
    if (!query.trim() && filenameFilter.trim()) {
      return filteredResults.length;
    }
    return total;
  }, [filteredResults, query, filenameFilter, total]);

  const filteredTotalPages = Math.ceil(filteredTotal / pageSize);
  const paginatedResults = useMemo(() => {
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    return filteredResults.slice(start, end);
  }, [filteredResults, page, pageSize]);

  // Reload when sortBy or sortOrder changes (always bypass cache for sorting to see results)
  useEffect(() => {
    if (hasSearched) {
      if (query.trim()) {
        performSearch(query, true); // Always bypass cache when sorting
      } else {
        loadLastDocuments(true); // Always bypass cache when sorting
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortOrder]);

  const getDocumentUrl = (result: SearchResult) => {
    return `/documents/${result.document_id}`;
  };

  return (
    <div className="space-y-6">
      {/* Search Form and Metrics - Two Column Layout */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Left Column: Search Form */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <SearchAutocomplete
                value={query}
                onChange={setQuery}
                onSearch={handleSearch}
                onBypassCacheChange={handleBypassCacheChange}
                bypassCache={bypassCache}
                isLoading={loading}
              />
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Performance Metrics */}
        {metrics && <SearchMetrics metrics={metrics} />}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Results Table */}
      {!loading && hasSearched && (results.length > 0 || (filteredResults.length > 0 && !query.trim())) && (
        <div>
          {/* Control bar: document count, filename filter (when applicable), per-page selector, pagination buttons */}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            {/* Left: Document count */}
            <div className="text-sm text-muted-foreground">
              {filteredTotal.toLocaleString()} document{filteredTotal !== 1 ? "s" : ""} found
              {filteredTotalPages > 1 && (
                <span className="ml-2">
                  | page {page} of {filteredTotalPages}
                </span>
              )}
            </div>

            {/* Middle: Filename filter (only when not doing keyword search) */}
            {!query.trim() && (
              <div className="flex-1 max-w-sm mx-4">
                <Input
                  placeholder="Filter by filename..."
                  value={filenameFilter}
                  onChange={(e) => {
                    setFilenameFilter(e.target.value);
                    setPage(1); // Reset to first page when filtering
                  }}
                  className="h-8 bg-white"
                />
              </div>
            )}

            {/* Right: Per-page selector and pagination buttons */}
            <div className="flex items-center gap-4">
              {/* Per-page selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => handlePageSizeChange(parseInt(value))}
                  disabled={loading}
                >
                  <SelectTrigger className="h-8 w-[85px] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="25">25</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Pagination buttons */}
              {filteredTotal > pageSize && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(page - 1)}
                    disabled={page === 1 || loading}
                    className="h-8"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handlePageChange(page + 1)}
                    disabled={page >= filteredTotalPages || loading}
                    className="h-8"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Table with white background */}
          <div className="mt-0">
            <Card>
              <CardContent className="p-0">
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
                      <TableHead className="w-[60px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedResults.map((result: SearchResult) => {
                      const fileTypeInfo = getFileTypeInfo(result.fileType);
                      const FileIcon = fileTypeInfo.icon;
                      return (
                        <TableRow key={result.document_id}>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium text-xs">
                                {fileTypeInfo.name}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="w-[200px] max-w-[200px] min-w-[200px] whitespace-normal!">
                            <div className="w-full max-w-full overflow-hidden">
                              <Link
                                href={getDocumentUrl(result)}
                                className="text-primary hover:underline font-medium text-sm block w-full max-w-full"
                                style={{
                                  wordBreak: "break-word",
                                  overflowWrap: "anywhere",
                                  maxWidth: "100%",
                                }}
                              >
                                <span
                                  dangerouslySetInnerHTML={{
                                    __html: result.titleHighlight,
                                  }}
                                />
                              </Link>
                              {result.chunkCount && result.chunkCount > 1 && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {result.chunkCount} matching chunks
                                </div>
                              )}
                            </div>
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
                                    overflow: "hidden",
                                  }}
                                  dangerouslySetInnerHTML={{ __html: highlight }}
                                />
                              ))}
                              {result.highlightCount && result.highlightCount > 2 && (
                                <div className="text-xs text-muted-foreground pt-1">
                                  +{result.highlightCount - 2} more match
                                  {result.highlightCount - 2 !== 1 ? "es" : ""} in other
                                  chunks
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap w-[80px]">
                            <span className="text-sm text-muted-foreground">
                              {result.score.toFixed(2)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right w-[60px]">
                            <DocumentActions
                              documentId={result.document_id}
                              title={result.title}
                              tenantId={result.tenant_id}
                              showReindex={userRole === "platform_admin" || userRole === "tenant_admin"}
                              showDelete={userRole === "platform_admin" || userRole === "tenant_admin"}
                              onDeleted={() => {
                                // Refresh results after deletion
                                if (query.trim()) {
                                  performSearch(query, bypassCache);
                                } else {
                                  loadLastDocuments();
                                }
                              }}
                            />
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
        </div>
      )}

      {/* No Results */}
      {!loading && hasSearched && results.length === 0 && query && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              No results found for &quot;{query}&quot;
            </p>
          </CardContent>
        </Card>
      )}

      {/* Initial State - Last 20 Documents */}
      {!loading && hasSearched && results.length === 0 && !query && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              No documents indexed for this tenant yet
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

