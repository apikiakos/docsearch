"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { DocumentViewer } from "@/components/document-viewer";
import { getFileTypeInfo, normalizeFileType } from "@/lib/file-types";
import { JsonHighlight } from "@/components/json-highlight";
import { DocumentActions } from "@/components/document-actions";

type DocumentData = {
  id: string;
  document_id: string;
  tenant_id: string;
  title: string;
  content: string;
  chunk_index?: number;
  chunk_count?: number;
  chunks?: Array<{ chunk_index: number; content: string }>;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/documents/${id}`);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          if (response.status === 404) {
            const errorMsg = errorData.error || "Document not found";
            const documentId = errorData.documentId;
            
            // Show more helpful message if document is queued
            if (errorData.queued) {
              setError(
                `Document is queued but not yet indexed. It may still be processing or may have failed to index. (ID: ${documentId?.substring(0, 8) || "unknown"}...)`
              );
            } else if (errorData.deleted) {
              setError("Document has been deleted.");
            } else {
              setError(
                documentId 
                  ? `${errorMsg} (ID: ${documentId.substring(0, 8)}...)`
                  : errorMsg
              );
            }
          } else if (response.status === 403) {
            setError("You don't have access to this document");
          } else {
            setError(`Failed to load document: ${errorData.error || "Unknown error"}`);
          }
          return;
        }
        
        const data = await response.json();
        if (!data.document) {
          setError("Document data is missing from response");
          return;
        }
        setDocument(data.document);
      } catch (err) {
        console.error("Error fetching document:", err);
        setError("Failed to load document");
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchDocument();
    }
  }, [id]);


  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Loading..."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Documents", href: "/documents" },
            { label: "Loading" },
          ]}
        />
        <Card>
          <CardContent className="p-8 text-center">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Document Not Found"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Documents", href: "/documents" },
            { label: "Not Found" },
          ]}
        />
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">{error || "The requested document could not be found."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={document.title}
        subtitle={`Document ID: ${document.document_id}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Documents", href: "/documents" },
          { label: document.title },
        ]}
        actions={
          document ? (
            <DocumentActions
              documentId={document.document_id}
              title={document.title}
              tenantId={document.tenant_id}
              onDeleted={() => {
                // Redirect to documents list after successful deletion
                router.push("/documents");
              }}
              onReindexed={() => {
                // Reload the page after reindexing
                router.refresh();
              }}
            />
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{document.title}</CardTitle>
              <CardDescription>Document details and content</CardDescription>
            </div>
            <Badge variant="secondary">{document.tenant_id}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Document ID</p>
              <p className="text-sm font-mono">{document.document_id}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">File Type</p>
              <div className="flex items-center gap-2">
                {(() => {
                  const fileType = normalizeFileType(
                    document.metadata?.mime as string | undefined,
                    document.metadata?.filename as string | undefined
                  );
                  const fileTypeInfo = getFileTypeInfo(fileType);
                  const FileIcon = fileTypeInfo.icon;
                  return (
                    <>
                      <FileIcon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{fileTypeInfo.name}</span>
                    </>
                  );
                })()}
              </div>
            </div>
            {document.chunk_count !== undefined && (
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Chunks</p>
                <p className="text-sm">{document.chunk_count} chunk{document.chunk_count !== 1 ? "s" : ""}</p>
              </div>
            )}
            {(() => {
              const originalUrl = document.metadata?.originalUrl;
              if (originalUrl && typeof originalUrl === "string") {
                return (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Source</p>
                    <a
                      href={originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all"
                    >
                      {originalUrl}
                    </a>
                  </div>
                );
              }
              return null;
            })()}
          </div>

          {document.metadata && Object.keys(document.metadata).length > 0 ? (
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Metadata</h3>
              
              {/* Core Metadata */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Core Fields</h4>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {document.metadata.filename != null ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Filename</p>
                      <p className="font-mono text-xs break-all">{String(document.metadata.filename)}</p>
                    </div>
                  ) : null}
                  {document.metadata.mime != null ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">MIME Type</p>
                      <p className="font-mono text-xs">{String(document.metadata.mime)}</p>
                    </div>
                  ) : null}
                  {document.metadata.source != null ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Source</p>
                      <p className="text-xs">{String(document.metadata.source)}</p>
                    </div>
                  ) : null}
                  {document.metadata.source_url != null ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Source URL</p>
                      <p className="font-mono text-xs break-all">{String(document.metadata.source_url)}</p>
                    </div>
                  ) : null}
                  {document.metadata.type != null ? (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Document Type</p>
                      <p className="text-xs">{String(document.metadata.type)}</p>
                    </div>
                  ) : null}
                  {document.metadata.originalUrl != null ? (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground mb-1">Original URL</p>
                      <a
                        href={String(document.metadata.originalUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline break-all"
                      >
                        {String(document.metadata.originalUrl)}
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Extras (Type-specific metadata) */}
              {document.metadata.extras && typeof document.metadata.extras === "object" && Object.keys(document.metadata.extras).length > 0 ? (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Additional Metadata</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {Object.entries(document.metadata.extras as Record<string, unknown>).map(([key, value]: [string, unknown]) => {
                      if (value === null || value === undefined) return null;
                      if (key === "html_meta" && typeof value === "object") {
                        return (
                          <div key={key} className="col-span-2">
                            <p className="text-xs text-muted-foreground mb-1">HTML Meta</p>
                            <pre className="text-xs bg-muted p-2 rounded-md overflow-auto">
                              {JSON.stringify(value, null, 2)}
                            </pre>
                          </div>
                        );
                      }
                      return (
                        <div key={key}>
                          <p className="text-xs text-muted-foreground mb-1 capitalize">{key.replace(/_/g, " ")}</p>
                          <p className="font-mono text-xs break-all">
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Legacy fields (for backward compatibility - fields that should be in extras) */}
              {(() => {
                const legacyFields = ["book_id", "author", "s3_bucket", "s3_key", "s3_etag", "s3_last_modified", "folder"];
                const hasLegacyFields = legacyFields.some(field => 
                  document.metadata && field in document.metadata && document.metadata[field] !== null && document.metadata[field] !== undefined
                );
                
                if (hasLegacyFields) {
                  return (
                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Legacy Fields</h4>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {legacyFields.map((field: string) => {
                          const value = document.metadata?.[field];
                          if (value === null || value === undefined) return null;
                          return (
                            <div key={field}>
                              <p className="text-xs text-muted-foreground mb-1 capitalize">{field.replace(/_/g, " ")}</p>
                              <p className="font-mono text-xs break-all">
                                {typeof value === "object" ? JSON.stringify(value) : String(value)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Raw JSON (collapsible) */}
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-muted-foreground text-xs hover:text-foreground transition-colors">
                  View Raw JSON
                </summary>
                <div className="mt-2 bg-[#1e1e1e] rounded-md overflow-auto p-4 border border-[#3e3e3e]">
                  <JsonHighlight data={document.metadata} />
                </div>
              </details>
            </div>
          ) : null}

          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Content</p>
            <DocumentViewer
              content={document.content}
              metadata={{
                ...document.metadata,
                tenant_id: document.tenant_id, // Pass tenant_id for local file serving
              }}
              filename={document.metadata?.filename as string | undefined}
              mimeType={document.metadata?.mime as string | undefined}
            />
          </div>

          <div className="flex gap-4 text-xs text-muted-foreground pt-2 border-t">
            <span>Created: {new Date(document.created_at).toLocaleString()}</span>
            <span>Updated: {new Date(document.updated_at).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
