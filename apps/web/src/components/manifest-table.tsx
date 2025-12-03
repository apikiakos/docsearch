"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePersistedPageSize } from "@/hooks/use-persisted-page-size";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, Loader2, ChevronLeft, ChevronRight, AlertCircle, RefreshCw } from "lucide-react";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { TablePagination } from "@/components/table-pagination";
import { DocumentActions } from "@/components/document-actions";
import { getFileTypeInfo, normalizeFileType } from "@/lib/file-types";

type ManifestEntry = {
  id: number;
  tenantId: string;
  path: string;
  documentId: string;
  lastMtime: string;
  sizeBytes: number;
  contentHash: string | null;
  etag: string | null;
  lastIndexedAt: string;
  isDeleted: boolean;
  permanentlyDeleted: boolean;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function ManifestTable() {
  const router = useRouter();
  const [entries, setEntries] = useState<ManifestEntry[]>([]);
  const [pageSize, setPageSize] = usePersistedPageSize();
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: pageSize,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("lastIndexedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc"); // Most recent first

  // Update pagination limit when pageSize changes
  useEffect(() => {
    setPagination((prev) => ({ ...prev, limit: pageSize, page: 1 }));
  }, [pageSize]);

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        sortOrder,
        ...(search && { search }),
      });

      const response = await fetch(`/api/manifest?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}: ${response.statusText}` }));
        throw new Error(errorData.error || `Failed to fetch manifest entries: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data || typeof data !== 'object') {
        throw new Error("Invalid response format from API");
      }
      
      setEntries(data.entries || []);
      setPagination(data.pagination || pagination);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to fetch manifest entries";
      console.error("Error fetching manifest entries:", error);
      setError(errorMessage);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, sortBy, sortOrder]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (pagination.page === 1) {
        fetchEntries();
      } else {
        setPagination((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handlePageChange = (newPage: number) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const getStatusBadge = (entry: ManifestEntry) => {
    if (entry.permanentlyDeleted) {
      return (
        <Badge variant="destructive" className="bg-red-600 hover:bg-red-700">
          Permanently Deleted
        </Badge>
      );
    }
    if (entry.isDeleted) {
      return (
        <Badge variant="secondary" className="bg-orange-500 hover:bg-orange-600 text-white">
          Deleted
        </Badge>
      );
    }
    return (
      <Badge variant="default" className="bg-green-500 hover:bg-green-600 text-white">
        Active
      </Badge>
    );
  };

  const getFilename = (path: string) => {
    return path.split("/").pop() || path;
  };

  if (loading && entries.length === 0 && !error) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mb-4" />
            <h3 className="text-lg font-semibold mb-2">Error Loading Manifest</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={() => fetchEntries()} variant="outline">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      {/* Control bar: entry count, per-page selector, filter input, pagination */}
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        {/* Left: Entry count */}
        <div className="text-sm text-muted-foreground">
          {pagination.total.toLocaleString()} entr{pagination.total !== 1 ? "ies" : "y"} found
          {pagination.totalPages > 1 && (
            <span className="ml-2">
              | page {pagination.page} of {pagination.totalPages}
            </span>
          )}
        </div>

        {/* Right: Per-page selector, filter input, and pagination */}
        <div className="flex items-center gap-4">
          {/* Per-page selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => setPageSize(parseInt(value))}
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

          {/* Filter input */}
          <div className="relative">
            <Input
              placeholder="Search by filename or tenant..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 max-w-sm bg-white pr-8"
            />
            {loading && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Pagination buttons */}
          <TablePagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            pageSize={pagination.limit}
            onPageChange={handlePageChange}
            onPageSizeChange={setPageSize}
            itemName="entries"
            showCount={false}
          />
        </div>
      </div>

      {/* Table with white background */}
      <div className="mt-0">
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">File Type</TableHead>
                    <TableHead>
                      <SortableTableHeader
                        column="path"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                      >
                        Filename
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead>
                      <SortableTableHeader
                        column="tenantId"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                      >
                        Tenant
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead>
                      <SortableTableHeader
                        column="lastIndexedAt"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                      >
                        Last Indexed
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead>
                      <SortableTableHeader
                        column="status"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                      >
                        Status
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead className="text-right">
                      <SortableTableHeader
                        column="sizeBytes"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                        className="justify-end"
                      >
                        Size
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-24 text-center">
                        No manifest entries found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    entries.map((entry) => {
                      const filename = getFilename(entry.path);
                      const fileType = normalizeFileType(undefined, filename);
                      const fileTypeInfo = getFileTypeInfo(fileType);
                      const FileIcon = fileTypeInfo.icon;
                      return (
                      <TableRow
                        key={entry.id}
                        className="hover:bg-muted/50"
                      >
                        <TableCell className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium text-xs">{fileTypeInfo.name}</span>
                          </div>
                        </TableCell>
                        <TableCell 
                          className="font-medium max-w-md truncate cursor-pointer"
                          onClick={() => router.push(`/documents/${entry.documentId}`)}
                        >
                          {filename}
                        </TableCell>
                        <TableCell>
                          <Badge 
                            variant="outline" 
                            className="cursor-pointer hover:bg-primary/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/tenants/${entry.tenantId}`);
                            }}
                          >
                            {entry.tenantId}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(entry.lastIndexedAt).toLocaleString()}
                        </TableCell>
                        <TableCell>{getStatusBadge(entry)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {(entry.sizeBytes / 1024).toFixed(1)} KB
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <DocumentActions
                            documentId={entry.documentId}
                            title={getFilename(entry.path)}
                            tenantId={entry.tenantId}
                            onDeleted={() => {
                              fetchEntries();
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

