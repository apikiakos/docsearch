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

type User = {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  memberships: Array<{
    tenantSlug: string;
    tenantName: string;
    role: string;
  }>;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function UsersTable() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
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

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
        sortBy,
        sortOrder,
        ...(search && { search }),
      });

      const response = await fetch(`/api/users?${params}`);
      if (!response.ok) throw new Error("Failed to fetch users");

      const data = await response.json();
      setUsers(data.users || []);
      setPagination(data.pagination || pagination);
    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.limit, sortBy, sortOrder]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (pagination.page === 1) {
        fetchUsers();
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

  if (loading && users.length === 0) {
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
        {/* Left: User count */}
        <div className="text-sm text-muted-foreground">
          {pagination.total.toLocaleString()} user{pagination.total !== 1 ? "s" : ""} found
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
              placeholder="Search users..."
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
                  column="email"
                  currentSortBy={sortBy}
                  currentSortOrder={sortOrder}
                  onSort={handleSort}
                >
                  Email
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
              <TableHead>Tenants</TableHead>
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
            {users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user: User) => (
                <TableRow
                  key={user.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/users/${user.id}`)}
                >
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.name || "-"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {user.memberships.map((m: { tenantSlug: string; tenantName: string; role: string }, idx: number) => (
                        <span
                          key={idx}
                          className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium"
                        >
                          {m.tenantSlug} ({m.role})
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(user.createdAt).toLocaleDateString()}
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

