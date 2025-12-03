"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { MoreHorizontal, RefreshCw, Download, Trash2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

interface DocumentActionsProps {
  documentId: string;
  title: string;
  tenantId: string;
  onDeleted?: () => void;
  onReindexed?: () => void;
  showReindex?: boolean;
  showDelete?: boolean;
}

export function DocumentActions({
  documentId,
  title,
  tenantId,
  onDeleted,
  onReindexed,
  showReindex = true,
  showDelete = true,
}: DocumentActionsProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [permanentDelete, setPermanentDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  const handleReindex = async () => {
    setReindexing(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/reindex`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to reindex document");
      }

      toast({
        title: "Document reindexed",
        description: "The document has been queued for reindexing.",
      });
      
      if (onReindexed) {
        onReindexed();
      }
    } catch (error) {
      console.error("Error reindexing document:", error);
      toast({
        title: "Failed to reindex document",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReindexing(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await fetch(`/api/documents/${documentId}/download`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to download document" }));
        throw new Error(errorData.error || "Failed to download document");
      }

      // Check content type to determine if it's JSON (S3 presigned URL) or a file
      const contentType = response.headers.get("content-type");
      
      if (contentType?.includes("application/json")) {
        // S3 files: response contains presigned URL
        const data = await response.json();
        
        if (data.downloadUrl && data.type === "s3") {
          // Create a temporary anchor to trigger download from presigned URL
          const a = document.createElement("a");
          a.href = data.downloadUrl;
          a.download = data.filename || "document";
          a.target = "_blank"; // Open in new tab as fallback
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          toast({
            title: "Download started",
            description: `Downloading ${data.filename || "document"}...`,
          });
        } else {
          throw new Error("Invalid download response format");
        }
      } else {
        // Local files: response is the file itself
        // Get filename from Content-Disposition header or use default
        const contentDisposition = response.headers.get("Content-Disposition");
        let filename = "document.txt";
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="(.+)"/);
          if (filenameMatch) {
            filename = filenameMatch[1];
          }
        }

        // Create blob and download
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        toast({
          title: "Download started",
          description: `Downloading ${filename}...`,
        });
      }
    } catch (error) {
      console.error("Error downloading document:", error);
      toast({
        title: "Failed to download document",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const url = `/api/documents/${documentId}?permanent=${permanentDelete}`;
      const response = await fetch(url, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete document");
      }

      toast({
        title: permanentDelete ? "Document permanently deleted" : "Document deleted",
        description: permanentDelete
          ? "The document has been permanently deleted and will not be reindexed."
          : "The document has been deleted but can be reindexed later.",
      });

      setDeleteDialogOpen(false);
      if (onDeleted) {
        onDeleted();
      } else {
        // Refresh the page or navigate away
        router.refresh();
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      toast({
        title: "Failed to delete document",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showReindex && (
            <DropdownMenuItem
              onClick={handleReindex}
              disabled={reindexing}
            >
              {reindexing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Reindex
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download
          </DropdownMenuItem>
          {showDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="sm:max-w-[600px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Are you sure you want to delete "{title}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex items-start space-x-3 p-4 border rounded-lg">
              <input
                type="checkbox"
                id="permanent-delete"
                checked={permanentDelete}
                onChange={(e) => setPermanentDelete(e.target.checked)}
                className="mt-1"
              />
              <div className="flex-1 space-y-1">
                <label
                  htmlFor="permanent-delete"
                  className="text-sm font-medium leading-none cursor-pointer"
                >
                  Permanently delete
                </label>
                <p className="text-xs text-muted-foreground">
                  If checked, the document will be permanently deleted and cannot be reindexed.
                  If unchecked, the document will be marked as deleted but can be reindexed later.
                </p>
              </div>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

