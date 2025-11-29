"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import SearchAutocomplete from "@/components/search-autocomplete";
import { Card, CardContent } from "@/components/ui/card";
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

type SearchResult = {
  id: string;
  document_id: string;
  tenant_id: string;
  title: string;
  fileType: string;
  highlights: string[];
  titleHighlight: string;
  score: number;
  chunk_index: number;
  metadata?: Record<string, unknown>;
};

type Facet = {
  type: string;
  count: number;
};

export default function SearchPage() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialTenant = searchParams.get("tenant") || "";

  const [query, setQuery] = useState(initialQuery);
  const [tenant, setTenant] = useState(initialTenant);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [userTenants, setUserTenants] = useState<Array<{ slug: string; name: string }>>([]);
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

  // Fetch user's accessible tenants
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const response = await fetch("/api/tenants/accessible");
        if (response.ok) {
          const data = await response.json();
          setUserTenants(data.tenants || []);
          // Auto-select first tenant if none selected
          if (!tenant && data.tenants && data.tenants.length > 0) {
            const firstTenant = data.tenants[0].slug;
            setTenant(firstTenant);
            // If there's an initial query, search with the first tenant
            if (initialQuery) {
              performSearch(initialQuery, firstTenant);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching tenants:", error);
      }
    };
    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Perform search when query or tenant changes (only if query came from URL params)
  useEffect(() => {
    if (initialQuery && tenant) {
      performSearch(initialQuery, tenant);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const performSearch = async (searchQuery: string, searchTenant: string) => {
    setLoading(true);
    setMetrics(null);
    const browserStart = performance.now();
    
    try {
      const params = new URLSearchParams({
        q: searchQuery,
        // Admin searches all tenants by default (empty tenant param)
        // Only filter if a specific tenant is selected
        ...(searchTenant && { tenant: searchTenant }),
      });

      const fetchStart = performance.now();
      const response = await fetch(`/api/search?${params}`);
      const fetchEnd = performance.now();
      const browserToApi = fetchStart - browserStart;
      const apiToBrowser = performance.now() - fetchEnd;

      if (response.ok) {
        const data = await response.json();
        setResults(data.results || []);
        setFacets(data.facets || []);
        setTotal(typeof data.total === "object" ? data.total.value : data.total || 0);
        
        // Combine browser and API metrics
        if (data.metrics) {
          setMetrics({
            ...data.metrics,
            browserToApi,
            apiToBrowser,
          });
        }
      }
    } catch (error) {
      console.error("Error searching:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
    if (tenant) {
      performSearch(searchQuery, tenant);
    } else if (userTenants.length > 0) {
      // If no tenant selected, use first available
      const firstTenant = userTenants[0].slug;
      setTenant(firstTenant);
      performSearch(searchQuery, firstTenant);
    }
  };

  const getDocumentUrl = (result: SearchResult): string => {
    return `/dashboard/documents/${result.document_id}`;
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
        <div className="flex gap-4">
          <div className="flex-1">
            <SearchAutocomplete
              value={query}
              onChange={setQuery}
              tenantSlug={tenant || undefined}
              onSearch={handleSearch}
            />
          </div>
          {userTenants.length > 0 && (
            <Select value={tenant} onValueChange={setTenant}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select tenant" />
              </SelectTrigger>
              <SelectContent>
                {userTenants.map((t) => (
                  <SelectItem key={t.slug} value={t.slug}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {!loading && query && results.length > 0 && (
          <div className="space-y-4">
            {/* Facet Statistics and Metrics */}
            <div className="grid gap-4 md:grid-cols-3">
              {facets.length > 0 && (
                <Card className="md:col-span-2">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">File Types:</span>
                      {facets.map((facet) => (
                        <Badge key={facet.type} variant="secondary" className="text-xs">
                          {facet.type}: {facet.count}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              {metrics && <SearchMetrics metrics={metrics} />}
            </div>

            {/* Results Summary */}
            <p className="text-sm text-muted-foreground">
              Found {total} result{total !== 1 ? "s" : ""} (sorted by relevance)
            </p>

            {/* Results Table */}
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[120px]">File Type</TableHead>
                      <TableHead>Document Name</TableHead>
                      <TableHead>Highlights</TableHead>
                      <TableHead className="w-[100px] text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((result) => (
                      <TableRow key={result.id}>
                        <TableCell className="font-medium">
                          {result.fileType}
                        </TableCell>
                        <TableCell>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link
                                  href={getDocumentUrl(result)}
                                  className="text-primary hover:underline font-medium"
                                >
                                  {result.titleHighlight}
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs break-all">
                                  {getDocumentUrl(result)}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <div className="text-xs text-muted-foreground mt-1">
                            {result.tenant_id} • Chunk {result.chunk_index}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1 max-w-2xl">
                            {result.highlights.slice(0, 3).map((highlight, idx) => (
                              <div
                                key={idx}
                                className="text-sm"
                                dangerouslySetInnerHTML={{ __html: highlight }}
                              />
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-sm text-muted-foreground">
                            {result.score.toFixed(2)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {!loading && query && results.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No results found for &quot;{query}&quot;</p>
            </CardContent>
          </Card>
        )}

        {!query && (
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
