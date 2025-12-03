"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "table-page-size";
const DEFAULT_PAGE_SIZE = 20;

export function usePersistedPageSize() {
  // Initialize from localStorage immediately if available (SSR-safe)
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0) {
          return parsed;
        }
      }
    }
    return DEFAULT_PAGE_SIZE;
  });

  useEffect(() => {
    // Only run on client side - sync with localStorage on mount
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed !== pageSize) {
          setPageSize(parsed);
        }
      }
    }
  }, [pageSize]);

  const updatePageSize = (newSize: number) => {
    setPageSize(newSize);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, newSize.toString());
    }
  };

  return [pageSize, updatePageSize] as const;
}

