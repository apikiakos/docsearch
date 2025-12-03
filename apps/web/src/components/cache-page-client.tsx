"use client";

import { CacheTable } from "@/components/cache-table";
import { CacheDumpButton } from "@/components/cache-dump-button";
import { useState } from "react";

export function CachePageClient() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleDumped = () => {
    // Force refresh of the cache table
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-6">
      {/* Dump Cache button at top right */}
      <div className="flex justify-end">
        <CacheDumpButton onDumped={handleDumped} />
      </div>
      
      {/* Cache table */}
      <CacheTable refreshTrigger={refreshKey} />
    </div>
  );
}

