"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ArrowUpDown, Loader2 } from "lucide-react";

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
  const [pagination, setPagination] = useState<Pagination>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

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
  }, [pagination.page, sortBy, sortOrder]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (pagination.page === 1) {
        fetchTenants();
      } else {
        setPagination((prev) => ({ ...prev, page: 1 }));
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [search]);

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  const SortButton = ({ column, children }: { column: string; children: React.ReactNode }) => (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 data-[state=open]:bg-accent"
      onClick={() => handleSort(column)}
    >
      {children}
      <ArrowUpDown className="ml-2 h-4 w-4" />
    </Button>
  );

  if (loading && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Search tenants..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={pagination.limit.toString()}
          onValueChange={(value) =>
            setPagination((prev) => ({ ...prev, limit: parseInt(value), page: 1 }))
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Items per page" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="10">10 per page</SelectItem>
            <SelectItem value="20">20 per page</SelectItem>
            <SelectItem value="50">50 per page</SelectItem>
            <SelectItem value="100">100 per page</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <SortButton column="slug">Slug</SortButton>
              </TableHead>
              <TableHead>
                <SortButton column="name">Name</SortButton>
              </TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Documents</TableHead>
              <TableHead>
                <SortButton column="createdAt">Created</SortButton>
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
              tenants.map((tenant) => (
                <TableRow
                  key={tenant.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/dashboard/tenants/${tenant.slug}`)}
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

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {tenants.length === 0 ? 0 : (pagination.page - 1) * pagination.limit + 1} to{" "}
          {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
          {pagination.total} tenants
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPagination((prev) => ({ ...prev, page: Math.max(1, prev.page - 1) }))
            }
            disabled={pagination.page === 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
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
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

