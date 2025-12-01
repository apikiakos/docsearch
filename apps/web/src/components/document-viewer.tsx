"use client";

import { useEffect, useRef, useState } from "react";
import { getFileTypeInfo, normalizeFileType } from "@/lib/file-types";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

type DocumentViewerProps = {
  content: string;
  metadata?: Record<string, unknown>;
  filename?: string;
  mimeType?: string;
};

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Convert HTTP URLs to HTTPS when the page is served over HTTPS
 * This prevents mixed content errors in production
 */
function ensureHttps(url: string | undefined): string | undefined {
  if (!url) return url;
  
  // Only convert if the current page is served over HTTPS
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    // Convert http:// to https://
    if (url.startsWith("http://")) {
      return url.replace(/^http:\/\//, "https://");
    }
  }
  
  return url;
}

export function DocumentViewer({ content, metadata, filename, mimeType }: DocumentViewerProps) {
  const [viewerReady, setViewerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s3PresignedUrl, setS3PresignedUrl] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine file type
  const fileType = normalizeFileType(
    mimeType || (metadata?.mime as string | undefined),
    filename || (metadata?.filename as string | undefined)
  );
  const fileTypeInfo = getFileTypeInfo(fileType);
  const originalUrlRaw = metadata?.originalUrl as string | undefined;
  const source = metadata?.source as string | undefined;
  const sourceUrlRaw = metadata?.source_url as string | undefined;
  
  // Convert HTTP URLs to HTTPS to prevent mixed content errors in production
  const originalUrl = ensureHttps(originalUrlRaw);
  const sourceUrl = ensureHttps(sourceUrlRaw);
  const tenantId = metadata?.tenant_id as string | undefined;
  const extras = metadata?.extras as Record<string, unknown> | undefined;
  
  // Extract S3 key from multiple possible locations:
  // 1. extras.s3_key (new structure)
  // 2. metadata.s3_key (legacy structure)
  // 3. Parse from originalUrl if it's an S3 URL (fallback)
  let s3Key = extras?.s3_key as string | undefined;
  if (!s3Key && metadata) {
    s3Key = metadata.s3_key as string | undefined;
  }
  if (!s3Key && originalUrl && originalUrl.startsWith("s3://")) {
    // Parse S3 key from s3://bucket/key format
    // Example: s3://document-search-tenants/s3-tenant-1/books/file.pdf
    // Key would be: s3-tenant-1/books/file.pdf
    const urlMatch = originalUrl.match(/^s3:\/\/[^\/]+\/(.+)$/);
    if (urlMatch && urlMatch[1]) {
      s3Key = urlMatch[1];
    }
  }
  
  // For S3 files, we'll fetch a presigned URL (handled in useEffect)
  const isS3Source = source === "s3" && s3Key && tenantId;
  
  // For local files, construct API route URL
  // Use source_url if available, otherwise fall back to originalUrl for local files
  const localFilePath = sourceUrl || (source === "local_folder" && originalUrl && !originalUrl.startsWith("http") ? originalUrl : null);
  const localFileUrl = source === "local_folder" && localFilePath && tenantId
    ? `/api/documents/serve?path=${encodeURIComponent(localFilePath)}&tenant=${encodeURIComponent(tenantId)}`
    : null;
  
  // For Gutenberg books and other remote sources, prefer iframe with originalUrl
  // Ensure URL is HTTPS to prevent mixed content errors
  // Also check sourceUrl as fallback in case originalUrl is not set
  const remoteUrlCandidate = originalUrl || sourceUrl;
  const useIframeForRemote = remoteUrlCandidate && (source === "gutendex" || remoteUrlCandidate.startsWith("http"));
  const remoteUrl = useIframeForRemote && remoteUrlCandidate ? ensureHttps(remoteUrlCandidate) || remoteUrlCandidate : null;
  
  // For local files, use the API route
  const useLocalFileUrl = localFileUrl !== null;
  
  // For DOCX files, if we have a URL, use Microsoft Office Online Viewer
  // This allows previewing DOCX without downloading
  // Prefer: presigned S3 URL > originalUrl > sourceUrl > localFileUrl (converted to absolute)
  let docxUrl: string | null = null;
  if (fileType === "DOCX") {
    if (isS3Source && s3PresignedUrl) {
      docxUrl = s3PresignedUrl;
    } else if (originalUrl && originalUrl.startsWith("http")) {
      docxUrl = originalUrl;
    } else if (sourceUrl && sourceUrl.startsWith("http")) {
      docxUrl = sourceUrl;
    } else if (localFileUrl) {
      // Convert relative URL to absolute URL for Office Online Viewer
      if (typeof window !== "undefined") {
        docxUrl = `${window.location.origin}${localFileUrl}`;
      }
    }
  }
  const useDocxViewer = fileType === "DOCX" && docxUrl !== null;
  const docxViewerUrl = useDocxViewer && docxUrl
    ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(ensureHttps(docxUrl) || docxUrl)}`
    : null;
  
  // Fetch presigned URL for S3 files
  useEffect(() => {
    if (isS3Source && s3Key && tenantId && !s3PresignedUrl) {
      const fetchPresignedUrl = async () => {
        try {
          console.log("[DocumentViewer] Fetching presigned URL for S3:", { s3Key, tenantId });
          const response = await fetch(
            `/api/documents/s3-presigned?s3Key=${encodeURIComponent(s3Key)}&tenantId=${encodeURIComponent(tenantId)}`
          );
          if (response.ok) {
            const data = await response.json();
            console.log("[DocumentViewer] Presigned URL received:", data.url.substring(0, 100) + "...");
            setS3PresignedUrl(data.url);
          } else {
            const errorData = await response.json();
            console.error("[DocumentViewer] Failed to get presigned URL:", errorData);
            setError(errorData.error || "Failed to generate S3 presigned URL");
          }
        } catch (err) {
          console.error("[DocumentViewer] Error fetching presigned URL:", err);
          setError("Failed to generate S3 presigned URL");
        }
      };
      fetchPresignedUrl();
    }
  }, [isS3Source, s3Key, tenantId, s3PresignedUrl]);

  // Debug logging
  console.log("[DocumentViewer] Render:", {
    fileType,
    source,
    sourceUrl,
    localFilePath,
    tenantId,
    localFileUrl,
    useLocalFileUrl,
    useIframeForRemote,
    originalUrl,
    isS3Source,
    s3Key,
    s3PresignedUrl,
    viewerReady,
  });

  useEffect(() => {
    // For S3 files, wait for presigned URL
    if (isS3Source && !s3PresignedUrl) {
      return; // Wait for presigned URL to be fetched
    }

    // For local files, remote sources, S3 files with presigned URL, or DOCX with viewer URL, iframe src is set directly in JSX
    // Set viewerReady immediately so the iframe is visible
    if (useLocalFileUrl || useIframeForRemote || (isS3Source && s3PresignedUrl) || useDocxViewer) {
      // Small delay to ensure iframe is mounted
      setTimeout(() => setViewerReady(true), 100);
      return;
    }

    if (!containerRef.current) return;
    const container = containerRef.current;

    // Handle different file types (for non-iframe cases)
    // Note: PDFs from S3 should use presigned URL in iframe (handled above), not blob
    if (fileType === "PDF" && !isS3Source) {
      // PDF: Use iframe with blob URL or original URL (fallback for non-local, non-S3 files)
      if (originalUrl && originalUrl.startsWith("http")) {
        // Remote URL - should be handled by useIframeForRemote
        setTimeout(() => setViewerReady(true), 0);
      } else {
        // Create blob URL from content (if it's base64 encoded)
        try {
          const blob = new Blob([content], { type: "application/pdf" });
          const url = URL.createObjectURL(blob);
          if (iframeRef.current) {
            iframeRef.current.src = url;
          }
          setTimeout(() => setViewerReady(true), 0);
          return () => URL.revokeObjectURL(url);
        } catch (e) {
          console.error("Error creating PDF blob:", e);
          setTimeout(() => setViewerReady(true), 0);
        }
      }
    } else if (fileType === "HTML" || fileType === "HTM") {
      // HTML: Use iframe with content
      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                line-height: 1.6;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
                color: #333;
              }
              img { max-width: 100%; height: auto; }
              pre { background: #f5f5f5; padding: 1em; border-radius: 4px; overflow-x: auto; }
              code { background: #f5f5f5; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
            </style>
          </head>
          <body>
            ${content}
          </body>
        </html>
      `;
      const blob = new Blob([htmlContent], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      if (iframeRef.current) {
        iframeRef.current.src = url;
      }
      setTimeout(() => setViewerReady(true), 0);
      return () => URL.revokeObjectURL(url);
    } else if (["JPG", "JPEG", "PNG", "GIF", "SVG", "WEBP"].includes(fileType)) {
      // Images: Display directly
      if (originalUrl) {
        const httpsUrl = ensureHttps(originalUrl);
        if (iframeRef.current && httpsUrl) {
          iframeRef.current.src = httpsUrl;
        }
      } else {
        // If content is base64, use it directly
        if (content.startsWith("data:image") || content.startsWith("/9j/") || content.startsWith("iVBORw0KGgo")) {
          const img = document.createElement("img");
          img.src = content.startsWith("data:") ? content : `data:image/${fileType.toLowerCase()};base64,${content}`;
          img.style.maxWidth = "100%";
          img.style.height = "auto";
          img.style.display = "block";
          img.style.margin = "0 auto";
          container.innerHTML = "";
          container.appendChild(img);
          setTimeout(() => setViewerReady(true), 0);
          return;
        }
      }
      setTimeout(() => setViewerReady(true), 0);
    } else if (fileType === "DOCX" && !useDocxViewer) {
      // DOCX: If no URL available, show extracted text content
      // If URL is available, it will be handled by the iframe with Office Online Viewer
      container.innerHTML = `
        <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto;">
          <div style="background: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 12px; margin-bottom: 20px; border-radius: 4px;">
            <strong>DOCX Document</strong>
            <p style="margin: 8px 0 0 0; font-size: 0.9em; color: #64748b;">
              This is the extracted text content from the DOCX file. For full formatting, please download the original file.
            </p>
          </div>
          <div style="white-space: pre-wrap; word-wrap: break-word;">${content}</div>
        </div>
      `;
      setTimeout(() => setViewerReady(true), 0);
    } else if (["TXT", "MD", "MARKDOWN"].includes(fileType)) {
      // Text files: Display with formatting (if not using iframe)
      container.innerHTML = `
        <div style="padding: 20px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; line-height: 1.6; max-width: 800px; margin: 0 auto; background: #fff;">
          <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0; font-size: 14px; color: #333;">${escapeHtml(content)}</pre>
        </div>
      `;
      setTimeout(() => setViewerReady(true), 0);
    } else if (["JS", "TS", "JSX", "TSX", "JSON", "XML", "CSS", "YAML"].includes(fileType)) {
      // Code files: Display with syntax highlighting (basic)
      container.innerHTML = `
        <div style="padding: 20px; font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace; line-height: 1.6; max-width: 1200px; margin: 0 auto; background: #1e1e1e; color: #d4d4d4;">
          <pre style="white-space: pre-wrap; word-wrap: break-word; margin: 0; font-size: 14px; overflow-x: auto;"><code>${escapeHtml(content)}</code></pre>
        </div>
      `;
      setTimeout(() => setViewerReady(true), 0);
    } else {
      // Default: Show as formatted text
      container.innerHTML = `
        <div style="padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto;">
          <div style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(content)}</div>
        </div>
      `;
      setTimeout(() => setViewerReady(true), 0);
    }
  }, [content, fileType, originalUrl, metadata, useIframeForRemote, useLocalFileUrl, localFileUrl, isS3Source, s3PresignedUrl, useDocxViewer, docxViewerUrl]);

  if (["JPG", "JPEG", "PNG", "GIF", "SVG", "WEBP"].includes(fileType) && !originalUrl) {
    // Images displayed directly in container
    return (
      <Card>
        <CardContent className="p-0">
          <div ref={containerRef} className="flex items-center justify-center min-h-[400px] bg-muted" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="relative w-full" style={{ minHeight: "600px" }}>
          {!viewerReady && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <div className="text-center p-4">
                <p className="text-sm text-destructive mb-2">{error}</p>
                {useLocalFileUrl && localFileUrl && (
                  <p className="text-xs text-muted-foreground">URL: {localFileUrl}</p>
                )}
              </div>
            </div>
          )}
          {(fileType === "PDF" || fileType === "HTML" || fileType === "HTM" || useIframeForRemote || useLocalFileUrl || (isS3Source && s3PresignedUrl) || useDocxViewer) && (
            <iframe
              ref={iframeRef}
              src={
                useDocxViewer && docxViewerUrl
                  ? docxViewerUrl
                  : useLocalFileUrl 
                  ? localFileUrl! 
                  : (isS3Source && s3PresignedUrl)
                    ? s3PresignedUrl
                    : remoteUrl || undefined
              }
              className="w-full border-0"
              style={{ minHeight: "600px", display: "block" }}
              title={`${fileTypeInfo.name} Viewer`}
              allow="fullscreen"
              onLoad={() => {
                console.log("[DocumentViewer] Iframe loaded successfully");
                setViewerReady(true);
                setError(null);
              }}
              onError={(e) => {
                console.error("[DocumentViewer] Failed to load iframe content:", e);
                setError("Failed to load document. Please check the console for details.");
                setViewerReady(true); // Show iframe anyway to display error
              }}
            />
          )}
          {!(fileType === "PDF" || fileType === "HTML" || fileType === "HTM" || useIframeForRemote || useLocalFileUrl || (isS3Source && s3PresignedUrl) || useDocxViewer) && (
            <div ref={containerRef} className="w-full" />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

