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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { SortableTableHeader } from "@/components/sortable-table-header";

type Tenant = {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  documentCount: number;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function TenantsTable() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [pageSize, setPageSize] = usePersistedPageSize();
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: pageSize,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Update pagination limit when pageSize changes
  useEffect(() => {
    setPagination((prev) => ({ ...prev, limit: pageSize, page: 1 }));
  }, [pageSize]);

  const fetchTenants = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        sortOrder,
        ...(search && { search }),
      });

      const response = await fetch(`/api/tenants?${params}`);
      if (!response.ok) throw new Error("Failed to fetch tenants");

      const data = await response.json();
      setTenants(data.tenants || []);
      setPagination(data.pagination || pagination);
    } catch (error) {
      console.error("Error fetching tenants:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, sortBy, sortOrder]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (pagination.page === 1) {
        fetchTenants();
      } else {
        setPagination((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleSort = (column: string, order: "asc" | "desc") => {
    setSortBy(column);
    setSortOrder(order);
  };

  if (loading && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      {/* Control bar: document count, per-page selector, filter input */}
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        {/* Left: Tenant count */}
        <div className="text-sm text-muted-foreground">
          {pagination.total.toLocaleString()} tenant{pagination.total !== 1 ? "s" : ""} found
          {pagination.totalPages > 1 && (
            <span className="ml-2">
              | page {pagination.page} of {pagination.totalPages}
            </span>
          )}
        </div>

        {/* Right: Per-page selector and filter input */}
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
              placeholder="Search tenants..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 max-w-sm bg-white pr-8"
            />
            {loading && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Pagination buttons */}
          {pagination.total > pagination.limit && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))
                }
                disabled={pagination.page === 1 || loading}
                className="h-8"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPagination((prev) => ({
                    ...prev,
                    page: Math.min(prev.totalPages, prev.page + 1),
                  }))
                }
                disabled={pagination.page >= pagination.totalPages || loading}
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
              <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortableTableHeader
                  column="slug"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                >
                  Slug
                </SortableTableHeader>
              </TableHead>
              <TableHead>
                <SortableTableHeader
                  column="name"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                >
                  Name
                </SortableTableHeader>
              </TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Documents</TableHead>
              <TableHead>
                <SortableTableHeader
                  column="createdAt"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                >
                  Created
                </SortableTableHeader>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No tenants found.
                </TableCell>
              </TableRow>
            ) : (
              tenants.map((tenant: Tenant) => (
                <TableRow
                  key={tenant.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/tenants/${tenant.slug}`)}
                >
                  <TableCell className="font-medium">{tenant.slug}</TableCell>
                  <TableCell>{tenant.name}</TableCell>
                  <TableCell>{tenant.memberCount}</TableCell>
                  <TableCell>{tenant.documentCount.toLocaleString()}</TableCell>
                  <TableCell>
                    {new Date(tenant.createdAt).toLocaleDateString()}
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

      {/* Pagination buttons */}
      {pagination.total > pagination.limit && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))
            }
            disabled={pagination.page === 1 || loading}
            className="h-8"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPagination((prev) => ({
                ...prev,
                page: Math.min(prev.totalPages, prev.page + 1),
              }))
            }
            disabled={pagination.page >= pagination.totalPages || loading}
            className="h-8"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

