"use client";

import { useState, useEffect } from "react";
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
}

export function TenantDocuments({ tenantSlug }: TenantDocumentsProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [bypassCache, setBypassCache] = useState(false);
  const [allowFuzzy, setAllowFuzzy] = useState(false);
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

  // Load last 20 documents on mount
  useEffect(() => {
    loadLastDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  const loadLastDocuments = async () => {
    setLoading(true);
    setHasSearched(true);
    const browserStart = performance.now();

    try {
      // Search for all documents using a match_all query (empty string triggers match_all in our API)
      const params = new URLSearchParams({
        q: "", // Empty query will match all documents
        tenant: tenantSlug,
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
      console.error("Error searching:", error);
    } finally {
      setLoading(false);
    }
  };

  const performSearch = async (
    searchQuery: string,
    bypassCacheParam?: boolean,
    allowFuzzyParam?: boolean
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
    const fuzzy = allowFuzzyParam !== undefined ? allowFuzzyParam : allowFuzzy;

    try {
      const params = new URLSearchParams({
        q: searchQuery,
        tenant: tenantSlug, // Always use this tenant
        ...(bypass && { bypassCache: "true" }),
        ...(fuzzy && { allowFuzzy: "true" }),
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
    bypassCacheParam?: boolean,
    allowFuzzyParam?: boolean
  ) => {
    setQuery(searchQuery);
    const bypass = bypassCacheParam !== undefined ? bypassCacheParam : bypassCache;
    const fuzzy = allowFuzzyParam !== undefined ? allowFuzzyParam : allowFuzzy;
    performSearch(searchQuery, bypass, fuzzy);
  };

  const handleBypassCacheChange = (checked: boolean) => {
    setBypassCache(checked);
  };

  const handleAllowFuzzyChange = (checked: boolean) => {
    setAllowFuzzy(checked);
  };

  const getDocumentUrl = (result: SearchResult) => {
    return `/dashboard/documents/${result.document_id}`;
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
                onAllowFuzzyChange={handleAllowFuzzyChange}
                allowFuzzy={allowFuzzy}
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
      {!loading && hasSearched && results.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Found {total} document{total !== 1 ? "s" : ""} (sorted by relevance)
          </p>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table className="table-fixed w-full">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">File Type</TableHead>
                      <TableHead className="w-[200px]">Document Name</TableHead>
                      <TableHead className="w-[250px]">Highlights</TableHead>
                      <TableHead className="w-[80px] text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((result) => {
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
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
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
                          <TableCell className="w-[250px] max-w-[250px] min-w-[250px] whitespace-normal!">
                            <div className="space-y-1 w-full max-w-full overflow-hidden">
                              {result.highlights.slice(0, 2).map((highlight, idx) => (
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

