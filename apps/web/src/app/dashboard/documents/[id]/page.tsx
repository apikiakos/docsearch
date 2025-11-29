"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

type DocumentData = {
  id: string;
  document_id: string;
  tenant_id: string;
  title: string;
  content: string;
  chunk_index: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export default function DocumentDetailPage() {
  const params = useParams();
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
          if (response.status === 404) {
            setError("Document not found");
          } else if (response.status === 403) {
            setError("You don't have access to this document");
          } else {
            setError("Failed to load document");
          }
          return;
        }
        
        const data = await response.json();
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
            { label: "Documents", href: "/dashboard/documents" },
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
            { label: "Documents", href: "/dashboard/documents" },
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
          { label: "Documents", href: "/dashboard/documents" },
          { label: document.title },
        ]}
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
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">Document ID</p>
            <p className="text-sm font-mono">{document.document_id}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-1">Chunk Index</p>
            <p className="text-sm">{document.chunk_index}</p>
          </div>
          {document.metadata && Object.keys(document.metadata).length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Metadata</p>
              <pre className="text-xs bg-muted p-3 rounded-md overflow-auto">
                {JSON.stringify(document.metadata, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-muted-foreground mb-2">Content</p>
            <div className="bg-muted p-4 rounded-md">
              <p className="text-sm whitespace-pre-wrap">{document.content}</p>
            </div>
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
