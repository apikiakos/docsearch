"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Database, HardDrive, Copy, CheckCircle2, XCircle, FileCode, AlertCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";

type IndexInfo = {
  indexName: string;
  exists: boolean;
  shards: {
    primary: number;
    replicas: number;
    total: number;
  } | null;
  documentCount: number;
  chunkCount: number;
  size: number;
  mapping?: any;
  mappingCompatible?: boolean;
  standardMapping?: any;
};

interface IndexInfoProps {
  tenantSlug: string;
}

export function IndexInfo({ tenantSlug }: IndexInfoProps) {
  const [indexInfo, setIndexInfo] = useState<IndexInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [mappingOpen, setMappingOpen] = useState(false);
  const [standardMappingOpen, setStandardMappingOpen] = useState(false);

  useEffect(() => {
    const fetchIndexInfo = async () => {
      try {
        const response = await fetch(`/api/tenants/${tenantSlug}/index`);
        if (response.ok) {
          const data = await response.json();
          setIndexInfo(data);
        }
      } catch (error) {
        console.error("Error fetching index info:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchIndexInfo();
  }, [tenantSlug]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Elasticsearch Index
        </CardTitle>
        <CardDescription>Index configuration and statistics</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        ) : !indexInfo || !indexInfo.exists ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Index does not exist yet</p>
            <p className="text-xs font-mono text-muted-foreground">
              {indexInfo?.indexName || `docs_${tenantSlug}`}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Index Name */}
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Index Name</p>
              <p className="text-sm font-mono">{indexInfo.indexName}</p>
            </div>

            {/* Shard Configuration */}
            {indexInfo.shards && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Shard Configuration</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <HardDrive className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Primary</span>
                    </div>
                    <p className="text-lg font-semibold">{indexInfo.shards.primary}</p>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Copy className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Replicas</span>
                    </div>
                    <p className="text-lg font-semibold">{indexInfo.shards.replicas}</p>
                  </div>
                  <div className="p-3 border rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Total</span>
                    </div>
                    <p className="text-lg font-semibold">{indexInfo.shards.total}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Statistics */}
            <div className="grid grid-cols-3 gap-4 pt-2 border-t">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Documents</p>
                <p className="text-2xl font-bold">{indexInfo.documentCount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {indexInfo.chunkCount.toLocaleString()} chunks
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Chunks</p>
                <p className="text-2xl font-bold">{indexInfo.chunkCount.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {indexInfo.documentCount > 0 
                    ? `${(indexInfo.chunkCount / indexInfo.documentCount).toFixed(1)} per document`
                    : "0 per document"}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Index Size</p>
                <p className="text-2xl font-bold">{formatBytes(indexInfo.size)}</p>
              </div>
            </div>

            {/* Multi-Tenant Compatibility */}
            <div className="pt-2 border-t">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {indexInfo.mappingCompatible !== undefined && (
                    indexInfo.mappingCompatible ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )
                  )}
                  <p className="text-sm font-medium">Multi-Tenant Search Compatibility</p>
                </div>
                {indexInfo.mappingCompatible !== undefined && (
                  <Badge 
                    variant={indexInfo.mappingCompatible ? "default" : "destructive"}
                    className={indexInfo.mappingCompatible ? "bg-green-500 text-white border-transparent hover:bg-green-600" : ""}
                  >
                    {indexInfo.mappingCompatible ? "Compatible" : "Incompatible"}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {indexInfo.mappingCompatible 
                  ? "This index uses the standard mapping structure with core fields matching. Descriptive metadata fields (book_id, s3_bucket, etc.) are optional and type-specific. Compatible with multi-tenant search (all tenants selected)."
                  : "This index mapping differs from the standard structure in core fields and may cause issues with multi-tenant search."}
              </p>
            </div>

            {/* Current Mapping */}
            {indexInfo.mapping && (
              <Collapsible open={mappingOpen} onOpenChange={setMappingOpen} className="pt-2 border-t">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4 w-4" />
                      <span className="text-sm font-medium">Current Index Mapping</span>
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${mappingOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="bg-muted p-3 rounded-md overflow-auto max-h-96">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(indexInfo.mapping, null, 2)}
                    </pre>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Standard Mapping */}
            {indexInfo.standardMapping && (
              <Collapsible open={standardMappingOpen} onOpenChange={setStandardMappingOpen} className="pt-2 border-t">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-0 h-auto">
                    <div className="flex items-center gap-2">
                      <FileCode className="h-4 w-4" />
                      <span className="text-sm font-medium">Standard Mapping (Expected)</span>
                    </div>
                    <ChevronDown className={`h-4 w-4 transition-transform ${standardMappingOpen ? "rotate-180" : ""}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="bg-muted p-3 rounded-md overflow-auto max-h-96">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {JSON.stringify(indexInfo.standardMapping, null, 2)}
                    </pre>
                  </div>
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-950 rounded-md">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                      <div className="text-xs text-blue-900 dark:text-blue-100">
                        <p className="font-medium mb-1">Multi-Tenant Search Strategy</p>
                        <p className="mb-2">All tenant indices use the same core mapping structure. When searching across multiple tenants, Elasticsearch searches all indices simultaneously using a comma-separated index pattern (e.g., <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">docs_tenant1,docs_tenant2</code>).</p>
                        <p className="mb-2"><strong>Core Fields:</strong> All indices must have identical core field mappings (id, document_id, tenant_id, title, content, metadata object structure) for consistent query behavior.</p>
                        <p><strong>Descriptive Metadata:</strong> Additional metadata fields (book_id, s3_bucket, html_meta, etc.) are optional and type-specific. They're stored in the metadata object with dynamic mapping enabled, allowing different document types to have different descriptive fields without breaking compatibility.</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

