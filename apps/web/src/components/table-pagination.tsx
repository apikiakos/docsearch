"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

interface TablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  loading?: boolean;
  pageSizeOptions?: number[];
  showPageSizeSelector?: boolean;
  showCount?: boolean;
  position?: "top" | "bottom";
}

export function TablePagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  loading = false,
  pageSizeOptions = [10, 25, 50, 100],
  showPageSizeSelector = true,
  showCount = true,
  position = "bottom",
  itemName = "items",
}: TablePaginationProps & { itemName?: string }) {
  // Hide pagination buttons when results fit in one page
  const showPaginationButtons = (total || 0) > pageSize;

  return (
    <div className="flex items-center justify-between px-2 py-4">
      {/* Left: Count text */}
      {showCount && (
        <div className="text-sm text-muted-foreground">
          {(total || 0).toLocaleString()} {itemName} found
          {totalPages > 1 && (
            <span className="ml-2">
              | page {page} of {totalPages}
            </span>
          )}
        </div>
      )}

      {/* Middle: Page size selector */}
      {showPageSizeSelector && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => onPageSizeChange(parseInt(value))}
            disabled={loading}
          >
            <SelectTrigger className="h-8 w-[85px] bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Right: Previous/Next buttons */}
      {showPaginationButtons && (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1 || loading}
            className="h-8"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || loading}
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

