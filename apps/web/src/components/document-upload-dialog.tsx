"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, X, File, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
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

interface FileWithPreview extends File {
  preview?: string;
  uploadStatus?: "pending" | "uploading" | "success" | "error";
  s3Key?: string;
}

interface DocumentUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId?: string; // If provided, tenant is fixed (tenant page). If not, show selector (admin page)
  tenants?: Array<{ slug: string; name: string }>; // For admin page tenant selector
  onSuccess?: () => void;
}

export function DocumentUploadDialog({
  open,
  onOpenChange,
  tenantId: fixedTenantId,
  tenants = [],
  onSuccess,
}: DocumentUploadDialogProps) {
  const [selectedTenant, setSelectedTenant] = useState(fixedTenantId || "");
  const [files, setFiles] = useState<FileWithPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const [showConfirmation, setShowConfirmation] = useState(false);

  const handleUpload = async () => {
    if (files.length === 0) {
      toast({
        title: "No files selected",
        description: "Please select at least one file to upload.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedTenant) {
      toast({
        title: "Tenant required",
        description: "Please select a tenant.",
        variant: "destructive",
      });
      return;
    }

    // Show confirmation dialog
    setShowConfirmation(true);
  };

  const confirmUpload = async () => {
    setShowConfirmation(false);
    setUploading(true);
    setUploadProgress({});

    try {
      // Step 1: Get presigned URLs for all files
      const fileData = files.map((file) => ({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        fileSize: file.size,
      }));

      console.log("[Upload] Step 1: Requesting presigned URLs for", fileData.length, "files");
      const presignedResponse = await fetch("/api/documents/batch-upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          files: fileData,
          tenantId: selectedTenant,
        }),
      });

      if (!presignedResponse.ok) {
        const status = presignedResponse.status;
        const statusText = presignedResponse.statusText;
        let error: any = {};
        
        try {
          const responseText = await presignedResponse.text();
          
          if (responseText && responseText.trim()) {
            try {
              error = JSON.parse(responseText);
              
              // Handle case where all files are duplicates - this is expected, not an error
              if (error.duplicateFiles && Array.isArray(error.duplicateFiles)) {
                const duplicateList = error.duplicateFiles.join(", ");
                
                // Show toast notification
                toast({
                  title: "Files already exist",
                  description: `The following files are already uploaded and were skipped: ${duplicateList}`,
                  variant: "destructive",
                });
                
                // Close the dialog and reset state
                setFiles([]);
                setUploadProgress({});
                setUploading(false);
                
                // Return early - this is handled gracefully
                return;
              }
              
              // For other errors, log them
              console.error("[Upload] API error:", {
                status,
                statusText,
                error: error.error || error,
              });
            } catch (parseError) {
              // Not JSON, use as plain text error
              console.error("[Upload] Response is not valid JSON:", parseError);
              throw new Error(responseText || `Failed to get upload URLs (${status} ${statusText})`);
            }
          } else {
            // Empty response body
            console.error("[Upload] Empty response body");
            error = { error: `Server returned ${status} ${statusText} with no error message` };
          }
        } catch (e) {
          // If we couldn't parse the response at all
          console.error("[Upload] Error parsing error response:", e);
          if (e instanceof Error && !e.message.includes("Failed to get upload URLs")) {
            throw e;
          }
          throw new Error(`Failed to get upload URLs (${status} ${statusText})`);
        }
        
        const errorMessage = error.error || `Failed to get upload URLs (${status} ${statusText})`;
        throw new Error(errorMessage);
      }

      const presignedData = await presignedResponse.json();
      console.log("[Upload] Step 1: Presigned response:", presignedData);
      
      const { uploads, skippedDuplicates } = presignedData;
      if (!uploads || !Array.isArray(uploads) || uploads.length === 0) {
        if (skippedDuplicates && skippedDuplicates.length > 0) {
          throw new Error(`All files already exist: ${skippedDuplicates.join(", ")}`);
        }
        throw new Error("No upload URLs received from API");
      }
      
      console.log("[Upload] Step 1: Got", uploads.length, "presigned URLs");
      if (skippedDuplicates && skippedDuplicates.length > 0) {
        console.log("[Upload] Skipped duplicates:", skippedDuplicates);
        toast({
          title: "Some files skipped",
          description: `${skippedDuplicates.length} file(s) already exist and were skipped: ${skippedDuplicates.join(", ")}`,
          variant: "default",
        });
      }
      uploads.forEach((upload: any, idx: number) => {
        console.log(`[Upload] Upload ${idx + 1}:`, {
          url: upload.url?.substring(0, 80) + "...",
          s3Key: upload.s3Key,
          fieldsCount: Object.keys(upload.fields || {}).length,
        });
      });

      // Step 2: Upload all files to S3 in parallel
      // Create a map of filename to upload info for efficient lookup
      const uploadMap = new Map<string, typeof uploads[0]>();
      uploads.forEach((upload: any) => {
        uploadMap.set(upload.filename, upload);
      });
      
      console.log("[Upload] Step 2: Uploading", uploads.length, "files to S3 (out of", files.length, "selected)");
      const uploadPromises = files
        .filter((file) => {
          // Only upload files that have corresponding upload URLs (skip duplicates)
          return uploadMap.has(file.name);
        })
        .map(async (file) => {
          const uploadInfo = uploadMap.get(file.name);
          if (!uploadInfo) {
            // This shouldn't happen due to the filter, but add a safety check
            console.warn(`[Upload] No upload URL found for ${file.name}, skipping`);
            return null;
          }

        console.log("[Upload] Uploading file:", file.name, "to", uploadInfo.s3Key);
        console.log("[Upload] Presigned URL:", uploadInfo.url.substring(0, 100) + "...");
        console.log("[Upload] Presigned fields:", Object.keys(uploadInfo.fields));

        // Validate presigned URL
        if (!uploadInfo.url || !uploadInfo.url.startsWith("http")) {
          throw new Error(`Invalid presigned URL for ${file.name}. URL: ${uploadInfo.url?.substring(0, 50)}...`);
        }

        const formData = new FormData();
        // Add all fields from presigned POST first (order matters for S3)
        Object.entries(uploadInfo.fields).forEach(([key, value]) => {
          formData.append(key, value as string);
        });
        // File must be the last field for presigned POST
        formData.append("file", file);

        setUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));

        let uploadResponse: Response;
        try {
          uploadResponse = await fetch(uploadInfo.url, {
            method: "POST",
            body: formData,
          });
        } catch (fetchError) {
          console.error("[Upload] Fetch error for", file.name, ":", fetchError);
          const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
          throw new Error(`Network error uploading ${file.name}: ${errorMessage}. This might be a CORS issue or network connectivity problem.`);
        }

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error("[Upload] Failed to upload", file.name, ":", uploadResponse.status, errorText);
          throw new Error(`Failed to upload ${file.name}: ${uploadResponse.status} ${errorText}`);
        }

        console.log("[Upload] Successfully uploaded", file.name, "to", uploadInfo.s3Key);
        setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }));
        return uploadInfo.s3Key;
      });

      const s3Keys = (await Promise.all(uploadPromises)).filter((key): key is string => key !== null);
      console.log("[Upload] Step 2: All files uploaded. S3 keys:", s3Keys);
      
      if (s3Keys.length === 0) {
        throw new Error("No files were uploaded. All files may have been duplicates.");
      }

      // Step 3: Notify API that uploads are complete
      console.log("[Upload] Step 3: Notifying API of upload completion for tenant", selectedTenant);
      const completeResponse = await fetch("/api/documents/batch-upload/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: selectedTenant,
          s3Keys,
        }),
      });
      
      console.log("[Upload] Step 3: Complete response status:", completeResponse.status);

      if (!completeResponse.ok) {
        const errorData = await completeResponse.json().catch(() => ({}));
        const errorMessage = errorData.error || errorData.producerError || "Failed to notify API of upload completion";
        console.error("Failed to notify API of upload completion:", errorMessage);
        
        toast({
          title: "Upload completed with warnings",
          description: `Files uploaded to S3, but producer trigger may have failed: ${errorMessage}`,
          variant: "destructive",
        });
        return;
      }

      const completeData = await completeResponse.json();
      
      toast({
        title: "Upload successful",
        description: completeData.message || `${files.length} file(s) uploaded and queued for processing.`,
      });

      // Reset form
      setFiles([]);
      setUploadProgress({});
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Upload error:", error);
      // Only show error toast if we haven't already shown a toast for duplicates
      // (duplicate errors already show a toast before throwing)
      const errorMessage = error instanceof Error ? error.message : "Failed to upload files";
      const isDuplicateError = errorMessage.includes("already exist") || errorMessage.includes("duplicate");
      
      if (!isDuplicateError) {
        toast({
          title: "Upload failed",
          description: errorMessage,
          variant: "destructive",
        });
      }
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    if (!uploading) {
      setFiles([]);
      setUploadProgress({});
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Add New Documents</DialogTitle>
          <DialogDescription>
            Upload multiple files to be indexed for search. Files will be processed automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Tenant Selector (only if not fixed) */}
          {!fixedTenantId && tenants.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="tenant">Tenant *</Label>
              <Select value={selectedTenant} onValueChange={setSelectedTenant}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.slug} value={tenant.slug}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* File Input */}
          <div className="space-y-2">
            <Label htmlFor="files">Files</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={fileInputRef}
                id="files"
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <Upload className="mr-2 h-4 w-4" />
                Select Files
              </Button>
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <Label>Selected Files ({files.length})</Label>
              <div className="max-h-60 overflow-y-auto space-y-2 border rounded-md p-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 bg-muted rounded"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <File className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm truncate">{file.name}</span>
                      <span className="text-xs text-muted-foreground">
                        ({(file.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    {uploadProgress[file.name] !== undefined && (
                      <div className="text-xs text-muted-foreground mr-2">
                        {uploadProgress[file.name]}%
                      </div>
                    )}
                    {!uploading && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                        className="h-6 w-6 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={uploading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleUpload}
            disabled={uploading || files.length === 0 || !selectedTenant}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                Index {files.length} Document{files.length !== 1 ? "s" : ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Upload</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to upload {files.length} document{files.length !== 1 ? "s" : ""} for tenant:{" "}
              <strong>
                {tenants.find((t) => t.slug === (fixedTenantId || selectedTenant))?.name ||
                  fixedTenantId ||
                  selectedTenant}
              </strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uploading}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUpload} disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                "Confirm"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

