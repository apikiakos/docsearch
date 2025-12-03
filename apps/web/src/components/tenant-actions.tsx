"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DocumentUploadDialog } from "@/components/document-upload-dialog";
import { ProducerOptionsDialog } from "@/components/producer-options-dialog";
import { useToast } from "@/hooks/use-toast";
import { Upload, Play, Loader2 } from "lucide-react";

interface TenantActionsProps {
  tenantSlug: string;
  tenantName: string;
  isAdmin: boolean;
  producerType?: "gutenberg" | "s3" | "govdocs"; // Type of producer for this tenant
}

export function TenantActions({
  tenantSlug,
  tenantName,
  isAdmin,
  producerType,
}: TenantActionsProps) {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [producerDialogOpen, setProducerDialogOpen] = useState(false);
  const [triggeringProducer, setTriggeringProducer] = useState(false);
  const { toast } = useToast();

  const handleTriggerProducer = async (options: {
    checkExisting: boolean;
    forceReindex: boolean;
    fetchNew?: number;
  }) => {
    if (!producerType) {
      toast({
        title: "No producer configured",
        description: "This tenant does not have a configured producer.",
        variant: "destructive",
      });
      return;
    }

    // Close dialog immediately
    setProducerDialogOpen(false);

    // Show initial toast
    const actionDescription = options.forceReindex
      ? "Force reindexing all existing documents"
      : options.checkExisting
      ? "Checking existing documents for changes"
      : options.fetchNew
      ? `Indexing ${options.fetchNew} new documents`
      : "Processing documents";

    toast({
      title: "Producer triggered",
      description: `${actionDescription} for ${tenantName}. This may take a while...`,
    });

    setTriggeringProducer(true);
    try {
      const response = await fetch("/api/producers/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant: tenantSlug,
          producerType,
          checkExisting: options.checkExisting,
          forceReindex: options.forceReindex,
          fetchNew: options.fetchNew,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to trigger producer");
      }

      // Extract document count from message if available
      const message = data.message || "Producer is now processing documents.";
      const docCountMatch = message.match(/(\d+)\s+documents?/i);
      const docCount = docCountMatch ? docCountMatch[1] : null;

      toast({
        title: "Producer started",
        description: docCount
          ? `Processing ${docCount} documents for ${tenantName}. Check logs for progress.`
          : message,
      });
    } catch (error) {
      console.error("Error triggering producer:", error);
      toast({
        title: "Failed to trigger producer",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setTriggeringProducer(false);
    }
  };

  const getProducerName = () => {
    switch (producerType) {
      case "gutenberg":
        return "Gutenberg Producer";
      case "s3":
        return "S3 Producer";
      case "govdocs":
        return "GovDocs Producer";
      default:
        return "Producer";
    }
  };

  return (
    <>
      <div className="flex gap-2">
        {/* Upload Button - Available to all users */}
        <Button onClick={() => setUploadDialogOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Add New Documents
        </Button>

        {/* Producer Button - Admin only */}
        {isAdmin && producerType && (
          <Button
            variant="outline"
            onClick={() => setProducerDialogOpen(true)}
            disabled={triggeringProducer}
          >
            {triggeringProducer ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="mr-2 h-4 w-4" />
                Run Indexing
              </>
            )}
          </Button>
        )}
      </div>

      {/* Upload Dialog */}
      <DocumentUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        tenantId={tenantSlug}
        onSuccess={() => {
          // Optionally refresh data
        }}
      />

      {/* Producer Options Dialog */}
      {producerType && (
        <ProducerOptionsDialog
          open={producerDialogOpen}
          onOpenChange={setProducerDialogOpen}
          tenantSlug={tenantSlug}
          tenantName={tenantName}
          producerType={producerType}
          producerName={getProducerName()}
          onTrigger={handleTriggerProducer}
          triggering={triggeringProducer}
        />
      )}
    </>
  );
}

