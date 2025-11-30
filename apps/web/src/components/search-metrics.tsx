"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Zap, Database, Search as SearchIcon, Network } from "lucide-react";

type SearchMetrics = {
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
  fuzzySearchUsed?: boolean;
  exactSearchMetrics?: { time: number; took: number; hits: number } | null;
  fuzzySearchMetrics?: { time: number; took: number; hits: number } | null;
};

interface SearchMetricsProps {
  metrics?: SearchMetrics;
  className?: string;
}

export function SearchMetrics({ metrics, className }: SearchMetricsProps) {
  if (!metrics || !metrics.totalTime) {
    return null;
  }

  const formatTime = (ms: number | undefined) => {
    if (!ms) return "N/A";
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(3)}s`;
  };

  const browserToApi = metrics.browserToApi || 0;
  const apiToBrowser = metrics.apiToBrowser || 0;
  const totalBrowserTime = browserToApi + (metrics.totalTime || 0) + apiToBrowser;

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Performance Metrics
        </CardTitle>
        <CardDescription className="text-xs">
          Request timing breakdown
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Total Time */}
        <div className="flex items-center justify-between pb-2 border-b">
          <div className="flex items-center gap-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-medium">Total Time</span>
          </div>
          <Badge variant="default" className="font-mono">
            {formatTime(totalBrowserTime)}
          </Badge>
        </div>

        {/* Browser to API */}
        {browserToApi > 0 && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Network className="h-3 w-3" />
              <span>Browser → API</span>
            </div>
            <span className="font-mono text-muted-foreground">{formatTime(browserToApi)}</span>
          </div>
        )}

        {/* API Processing Breakdown */}
        <div className="space-y-1.5 pl-5 border-l-2 border-muted">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Auth</span>
            <span className="font-mono text-muted-foreground">
              {formatTime(metrics.authTime)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Tenant Resolution</span>
            <span className="font-mono text-muted-foreground">
              {formatTime(metrics.tenantResolutionTime)}
            </span>
          </div>
          {metrics.cacheCheckTime !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Cache Check</span>
              <span className="font-mono text-muted-foreground">
                {formatTime(metrics.cacheCheckTime)}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <SearchIcon className="h-3 w-3" />
              <span className="text-muted-foreground">Elasticsearch</span>
            </div>
            <div className="flex flex-col items-end">
              <span className="font-mono text-muted-foreground">
                {formatTime(metrics.elasticsearchTime)}
              </span>
              {metrics.elasticsearchTook && (
                <span className="font-mono text-xs text-muted-foreground/70">
                  (ES: {formatTime(metrics.elasticsearchTook)})
                </span>
              )}
            </div>
          </div>
          
          {/* Exact Search Metrics */}
          {metrics.exactSearchMetrics && (
            <div className="pl-5 space-y-1 border-l-2 border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Exact Search</span>
                <span className="font-mono text-muted-foreground">
                  {formatTime(metrics.exactSearchMetrics.time)}
                </span>
              </div>
              {metrics.exactSearchMetrics.took > 0 && (
                <div className="flex items-center justify-between text-xs pl-2">
                  <span className="text-muted-foreground/70">ES took</span>
                  <span className="font-mono text-muted-foreground/70">
                    {formatTime(metrics.exactSearchMetrics.took)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs pl-2">
                <span className="text-muted-foreground/70">Hits</span>
                <span className="font-mono text-muted-foreground/70">
                  {metrics.exactSearchMetrics.hits}
                </span>
              </div>
            </div>
          )}
          
          {/* Fuzzy Search Metrics */}
          {metrics.fuzzySearchUsed && metrics.fuzzySearchMetrics && (
            <div className="pl-5 space-y-1 border-l-2 border-orange-200 dark:border-orange-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Fuzzy Search</span>
                <span className="font-mono text-muted-foreground">
                  {formatTime(metrics.fuzzySearchMetrics.time)}
                </span>
              </div>
              {metrics.fuzzySearchMetrics.took > 0 && (
                <div className="flex items-center justify-between text-xs pl-2">
                  <span className="text-muted-foreground/70">ES took</span>
                  <span className="font-mono text-muted-foreground/70">
                    {formatTime(metrics.fuzzySearchMetrics.took)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs pl-2">
                <span className="text-muted-foreground/70">Hits</span>
                <span className="font-mono text-muted-foreground/70">
                  {metrics.fuzzySearchMetrics.hits}
                </span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Processing</span>
            <span className="font-mono text-muted-foreground">
              {formatTime(metrics.processingTime)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-1 border-t border-muted/50">
            <span className="font-medium">API Total</span>
            <span className="font-mono font-medium">{formatTime(metrics.totalTime)}</span>
          </div>
        </div>

        {/* API to Browser */}
        {apiToBrowser > 0 && (
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Network className="h-3 w-3" />
              <span>API → Browser</span>
            </div>
            <span className="font-mono text-muted-foreground">{formatTime(apiToBrowser)}</span>
          </div>
        )}

        {/* Cache indicator */}
        {metrics.cached && (
          <div className="pt-2 border-t">
            <Badge variant="secondary" className="text-xs">
              <Database className="h-3 w-3 mr-1" />
              Served from cache
            </Badge>
          </div>
        )}
        
        {/* Fuzzy search indicator */}
        {metrics.fuzzySearchUsed && (
          <div className="pt-2 border-t">
            <Badge variant="outline" className="text-xs border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300">
              <SearchIcon className="h-3 w-3 mr-1" />
              Switched to fuzzy search (no exact matches found)
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

