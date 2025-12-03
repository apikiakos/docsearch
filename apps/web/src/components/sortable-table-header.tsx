"use client";

import { Button } from "@/components/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableTableHeaderProps {
  column: string;
  currentSortBy: string;
  currentSortOrder: "asc" | "desc";
  onSort: (column: string, order: "asc" | "desc") => void;
  children: React.ReactNode;
  className?: string;
}

export function SortableTableHeader({
  column,
  currentSortBy,
  currentSortOrder,
  onSort,
  children,
  className,
}: SortableTableHeaderProps) {
  const isActive = currentSortBy === column;
  const Icon = isActive
    ? currentSortOrder === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  const handleClick = () => {
    if (isActive) {
      // Toggle order if clicking the same column
      onSort(column, currentSortOrder === "asc" ? "desc" : "asc");
    } else {
      // Set to descending when clicking a new column
      onSort(column, "desc");
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "h-8 data-[state=open]:bg-accent -ml-3 hover:bg-accent/80 transition-colors",
        isActive && "bg-accent font-semibold text-foreground",
        className
      )}
      onClick={handleClick}
    >
      <span className={cn(isActive && "text-foreground")}>{children}</span>
      <Icon 
        className={cn(
          "ml-2 h-4 w-4 transition-colors",
          isActive 
            ? "text-primary" 
            : "text-muted-foreground"
        )} 
      />
    </Button>
  );
}

