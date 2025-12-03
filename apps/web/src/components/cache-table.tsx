"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2 } from "lucide-react";
import { SortableTableHeader } from "@/components/sortable-table-header";
import { TablePagination } from "@/components/table-pagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type CacheEntry = {
  key: string;
  tenant: string;
  query: string;
  date: string;
  ttl: number;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

interface CacheTableProps {
  refreshTrigger?: number;
}

export function CacheTable({ refreshTrigger }: CacheTableProps) {
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [pageSize, setPageSize] = usePersistedPageSize();
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: pageSize,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast } = useToast();

  // Update pagination limit when pageSize changes
  useEffect(() => {
    setPagination((prev) => ({ ...prev, limit: pageSize, page: 1 }));
  }, [pageSize]);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        sortOrder,
        ...(search && { search }),
      });

      const response = await fetch(`/api/cache?${params}`);
      if (!response.ok) throw new Error("Failed to fetch cache entries");

      const data = await response.json();
      setEntries(data.entries || []);
      setPagination(data.pagination || pagination);
    } catch (error) {
      console.error("Error fetching cache entries:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, sortBy, sortOrder, refreshTrigger]);

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

  const handleDelete = async (key: string) => {
    setDeleteKey(key);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteKey) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/cache?key=${encodeURIComponent(deleteKey)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete cache entry");
      }

      toast({
        title: "Cache entry deleted",
        description: "The cache entry has been deleted successfully.",
      });

      setDeleteDialogOpen(false);
      setDeleteKey(null);
      fetchEntries();
    } catch (error) {
      console.error("Error deleting cache entry:", error);
      toast({
        title: "Failed to delete cache entry",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
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
              placeholder="Search by keyword or tenant..."
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
                    <TableHead>
                      <SortableTableHeader
                        column="keyword"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                      >
                        Keyword
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead>
                      <SortableTableHeader
                        column="tenant"
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
                        column="date"
                        currentSortBy={sortBy}
                        currentSortOrder={sortOrder}
                        onSort={(col, order) => {
                          setSortBy(col);
                          setSortOrder(order);
                          setPagination((prev) => ({ ...prev, page: 1 }));
                        }}
                      >
                        Date
                      </SortableTableHeader>
                    </TableHead>
                    <TableHead className="text-right w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="h-24 text-center">
                        No cache entries found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    entries.map((entry) => (
                      <TableRow key={entry.key}>
                        <TableCell className="font-medium max-w-md truncate">
                          {entry.query || "(empty query)"}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{entry.tenant}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(entry.date).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleDelete(entry.key)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Cache Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this cache entry? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

