"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, File } from "lucide-react";
import { useSession } from "next-auth/react";

export default function DocumentUploadPage() {
  const router = useRouter();
  useSession(); // Keep session check for auth, but don't use the data
  const [file, setFile] = useState<File | null>(null);
  const [tenantId, setTenantId] = useState<string>("");
  const [userTenants, setUserTenants] = useState<Array<{ slug: string; name: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch user's accessible tenants
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const response = await fetch("/api/tenants/accessible");
        if (response.ok) {
          const data = await response.json();
          setUserTenants(data.tenants || []);
          // If user only has access to one tenant, pre-select it
          if (data.tenants && data.tenants.length === 1) {
            setTenantId(data.tenants[0].slug);
          }
        }
      } catch (error) {
        console.error("Error fetching tenants:", error);
      }
    };
    fetchTenants();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setSuccess(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError("Please select a file");
      return;
    }

    if (!tenantId) {
      setError("Please select a tenant");
      return;
    }

    setUploading(true);
    setError(null);
    setSuccess(null);

    try {
      // Step 1: Get presigned POST URL
      const presignedResponse = await fetch("/api/documents/upload/presigned", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          tenantId,
          fileSize: file.size,
        }),
      });

      const presignedData = await presignedResponse.json();

      if (!presignedResponse.ok) {
        throw new Error(presignedData.error || "Failed to get upload URL");
      }

      // Step 2: Upload directly to S3 using presigned POST
      const formData = new FormData();
      
      // Add all fields from presigned POST
      Object.entries(presignedData.fields).forEach(([key, value]) => {
        formData.append(key, value as string);
      });
      
      // Add the file last (must be last field)
      formData.append("file", file);

      const uploadResponse = await fetch(presignedData.url, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload file to S3");
      }

      // Step 3: Notify our API that upload is complete (triggers producer)
      const completeResponse = await fetch("/api/documents/upload/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId,
          s3Key: presignedData.s3Key,
        }),
      });

      const completeData = await completeResponse.json();

      if (!completeResponse.ok) {
        // Upload succeeded but notification failed - still show success
        console.warn("Upload succeeded but failed to trigger processing:", completeData.error);
      }

      setSuccess(`File "${file.name}" uploaded successfully! Processing will begin shortly.`);
      setFile(null);
      
      // Reset file input
      const fileInput = document.getElementById("file-input") as HTMLInputElement;
      if (fileInput) {
        fileInput.value = "";
      }

      // Optionally redirect after a delay
      setTimeout(() => {
        router.push("/dashboard/documents");
      }, 2000);
    } catch (err) {
      console.error("Error uploading file:", err);
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Upload Document" },
        ]}
        title="Upload Document"
        subtitle="Upload a document to be indexed and made searchable"
      />

      <Card>
        <CardHeader>
          <CardTitle>Upload Document</CardTitle>
          <CardDescription>
            Select a file and tenant to upload. The document will be processed and indexed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Tenant Selection */}
            {userTenants.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="tenant">Tenant</Label>
                <Select value={tenantId} onValueChange={setTenantId} required>
                  <SelectTrigger id="tenant">
                    <SelectValue placeholder="Select a tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {userTenants.map((t: { slug: string; name: string }) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* File Selection */}
            <div className="space-y-2">
              <Label htmlFor="file-input">File</Label>
              <div className="flex items-center gap-4">
                <Input
                  id="file-input"
                  type="file"
                  onChange={handleFileChange}
                  className="cursor-pointer"
                  accept=".pdf,.doc,.docx,.txt,.md,.html,.xls,.xlsx,.ppt,.pptx"
                  required
                />
                {file && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <File className="h-4 w-4" />
                    <span>{file.name}</span>
                    <span className="text-xs">
                      ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Supported formats: PDF, DOC, DOCX, TXT, MD, HTML, XLS, XLSX, PPT, PPTX (Max 50MB)
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-md">
                {error}
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="p-3 bg-green-500/10 text-green-700 dark:text-green-400 text-sm rounded-md">
                {success}
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={!file || !tenantId || uploading}
              className="w-full"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Document
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

