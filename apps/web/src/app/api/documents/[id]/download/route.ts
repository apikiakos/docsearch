import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../../lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "../../../../../lib/elasticsearch";
import { prisma } from "../../../../../lib/prisma";
import { readFile } from "fs/promises";
import { join, resolve } from "path";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: process.env.AWS_DEFAULT_REGION || "eu-west-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET || "document-search-tenants";

type Context = { params: Promise<{ id: string }> };

/**
 * Download a document file
 * GET /api/documents/[id]/download
 */
export async function GET(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { id } = await context.params;

    // Extract document_id
    const documentId = id.split("#chunk_")[0];

    // Find the document to get tenant and metadata
    let tenantSlug: string | null = null;
    let metadata: Record<string, unknown> = {};
    let source: string | undefined;
    let originalUrl: string | undefined;
    let extras: Record<string, unknown> | undefined;
    let filename: string = "document.txt";

    const searchResult = await elasticsearch.search({
      index: "docs_*",
      query: {
        term: { document_id: documentId },
      },
      size: 1,
    });

    if (searchResult.hits.hits.length > 0) {
      const hit = searchResult.hits.hits[0]._source as { 
        tenant_id: string; 
        metadata?: Record<string, unknown>;
        [key: string]: unknown;
      };
      tenantSlug = hit.tenant_id;
      metadata = hit.metadata || {};
      filename = (metadata.filename as string) || "document.txt";
      source = metadata.source as string;
      // If source is not set but tenant is S3, infer it
      if (!source && tenantSlug.startsWith("s3-")) {
        source = "s3";
      }
      originalUrl = metadata.originalUrl as string | undefined;
      // Extract extras - check both nested and flat structure
      extras = (metadata.extras as Record<string, unknown> | undefined) || 
               (Object.keys(metadata).some(k => k.startsWith('s3_') || k === 's3_key') ? metadata as Record<string, unknown> : undefined);
    } else {
      // Document not in ES, try to get from manifest
      const manifestEntry = await prisma.$queryRaw<Array<{ 
        path: string;
        "tenantId": string;
      }>>`
        SELECT path, "tenantId" FROM file_manifest 
        WHERE "documentId" = ${documentId}
        LIMIT 1
      `;

      if (!manifestEntry || manifestEntry.length === 0) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }

      tenantSlug = manifestEntry[0].tenantId;
      const path = manifestEntry[0].path;
      
      // Extract filename from path
      filename = path.split("/").pop() || "document.txt";
      
      // Determine source from tenant
      if (tenantSlug.startsWith("s3-")) {
        source = "s3";
        // For S3, path IS the S3 key (e.g., "s3-tenant-1/books/file.pdf")
        // Store it in extras for later use
        extras = { s3_key: path };
        originalUrl = `s3://${BUCKET_NAME}/${path}`;
      } else if (tenantSlug === "gutenberg") {
        source = "gutendex";
        originalUrl = path;
      } else if (tenantSlug === "govdocs") {
        source = "local_folder";
        originalUrl = path;
      } else {
        originalUrl = path;
      }
    }

    if (!tenantSlug) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Check tenant access
    await requireTenantAccess(tenantSlug);

    // For S3 files, use the same logic as document-viewer.tsx to extract S3 key and generate presigned URL
    if (source === "s3" || tenantSlug.startsWith("s3-")) {
      // Extract S3 key using the exact same logic as document-viewer.tsx
      let s3Key: string | undefined;
      
      // Priority 1: Check if we got it from manifest (stored in extras when document wasn't in ES)
      if (extras?.s3_key) {
        s3Key = extras.s3_key as string;
      }
      // Priority 2: Check metadata.extras.s3_key (from ES - nested structure)
      else if (metadata && (metadata.extras as Record<string, unknown>)?.s3_key) {
        s3Key = (metadata.extras as Record<string, unknown>).s3_key as string;
      }
      // Priority 3: Check metadata.s3_key directly (legacy or flat structure)
      else if (metadata?.s3_key) {
        s3Key = metadata.s3_key as string;
      }
      // Priority 4: Parse from originalUrl (s3://bucket/key format)
      else if (originalUrl && originalUrl.startsWith("s3://")) {
        const urlMatch = originalUrl.match(/^s3:\/\/[^\/]+\/(.+)$/);
        if (urlMatch && urlMatch[1]) {
          s3Key = urlMatch[1];
        }
      }
      // Priority 5: Parse from source_url if it's an S3 URL
      else if (metadata?.source_url) {
        const sourceUrl = metadata.source_url as string;
        if (sourceUrl.startsWith("s3://")) {
          const urlMatch = sourceUrl.match(/^s3:\/\/[^\/]+\/(.+)$/);
          if (urlMatch && urlMatch[1]) {
            s3Key = urlMatch[1];
          }
        }
      }
      // Priority 6: Check if source_url contains the S3 key pattern (even if not s3://)
      else if (metadata?.source_url) {
        const sourceUrl = metadata.source_url as string;
        // If source_url looks like an S3 key path (e.g., "s3-tenant-1/books/file.pdf")
        if (sourceUrl.includes(tenantSlug) && !sourceUrl.startsWith("http")) {
          s3Key = sourceUrl;
        }
      }
      
      // Priority 7: ALWAYS check manifest table as reliable fallback (for S3, path is the S3 key)
      // This is especially important for documents with minimal metadata
      if (!s3Key) {
        try {
          const manifestEntry = await prisma.$queryRaw<Array<{ path: string }>>`
            SELECT path FROM file_manifest 
            WHERE "tenantId" = ${tenantSlug} AND "documentId" = ${documentId}
            LIMIT 1
          `;
          if (manifestEntry && manifestEntry.length > 0) {
            s3Key = manifestEntry[0].path;
            console.log(`[download] Found S3 key from manifest: ${s3Key}`);
          }
        } catch (manifestError) {
          console.error("[download] Error querying manifest:", manifestError);
        }
      }

      if (!s3Key) {
        // Enhanced debugging - log the full metadata structure
        console.error("[download] Cannot determine S3 key. Full metadata structure:", JSON.stringify({
          source,
          tenantSlug,
          documentId,
          hasExtras: !!extras,
          extrasKeys: extras ? Object.keys(extras) : [],
          originalUrl,
          source_url: metadata.source_url,
          metadataKeys: Object.keys(metadata),
          metadataStructure: {
            metadata,
            extras: metadata.extras,
            hasExtras: !!metadata.extras,
            extrasType: typeof metadata.extras,
          },
        }, null, 2));
        
        // Last resort: try to extract from any URL-like field in metadata
        const allStringFields = Object.entries(metadata)
          .filter(([_, v]) => typeof v === "string")
          .map(([k, v]) => ({ key: k, value: v as string }));
        
        for (const field of allStringFields) {
          if (field.value.startsWith("s3://")) {
            const urlMatch = field.value.match(/^s3:\/\/[^\/]+\/(.+)$/);
            if (urlMatch && urlMatch[1]) {
              s3Key = urlMatch[1];
              console.log(`[download] Found S3 key in metadata.${field.key}: ${s3Key}`);
              break;
            }
          } else if (field.value.includes(tenantSlug) && field.value.includes("/") && !field.value.startsWith("http")) {
            // Might be an S3 key path
            s3Key = field.value;
            console.log(`[download] Found potential S3 key in metadata.${field.key}: ${s3Key}`);
            break;
          }
        }
        
        if (!s3Key) {
          return NextResponse.json(
            { error: "Cannot determine S3 key for this document" },
            { status: 404 }
          );
        }
      }

      // Use the same validation and presigned URL generation as /api/documents/s3-presigned
      // Validate that the s3Key belongs to this tenant (same check as s3-presigned endpoint)
      if (!s3Key.startsWith(`${tenantSlug}/`) && !s3Key.startsWith(`uploads/${tenantSlug}/`)) {
        return NextResponse.json(
          { error: "S3 key does not belong to the specified tenant" },
          { status: 403 }
        );
      }

      try {
        // Generate presigned URL using the same logic as /api/documents/s3-presigned
        // But add ResponseContentDisposition to trigger download with filename
        const command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          ResponseContentDisposition: `attachment; filename="${filename}"`,
        });

        // Use same expiration as s3-presigned endpoint (3600 seconds = 1 hour)
        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

        // Return the presigned URL as JSON so the client can handle the download
        // This works better than redirecting because fetch() doesn't handle redirects well for downloads
        return NextResponse.json({
          downloadUrl: presignedUrl,
          filename,
          type: "s3",
        });
      } catch (s3Error) {
        console.error("Error generating S3 presigned URL:", s3Error);
        return NextResponse.json(
          { error: "Failed to generate download URL" },
          { status: 500 }
        );
      }
    }

    // For non-S3 files, read from local filesystem
    // Get project root (handle both project root and apps/web cases)
    let projectRoot = process.cwd();
    if (projectRoot.endsWith("/apps/web")) {
      projectRoot = projectRoot.replace(/\/apps\/web$/, "");
    }
    
    let filePath: string;
    
    if (source === "gutendex" || tenantSlug === "gutenberg") {
      // Gutenberg files are stored in workers/data/gutendex_books/
      filePath = resolve(projectRoot, "workers", "data", "gutendex_books", filename);
    } else if (source === "local_folder" || tenantSlug === "govdocs") {
      // GovDocs files are in the original location or workers/data/govdocs-test/
      const originalUrl = metadata.originalUrl as string;
      if (originalUrl && originalUrl.startsWith("/")) {
        filePath = resolve(originalUrl);
      } else {
        filePath = resolve(projectRoot, "workers", "data", "govdocs-test", filename);
      }
    } else {
      // Try to get from metadata.originalUrl or metadata.source_url
      const originalUrl = (metadata.originalUrl || metadata.source_url) as string;
      if (originalUrl && originalUrl.startsWith("/")) {
        filePath = resolve(originalUrl);
      } else {
        return NextResponse.json(
          { error: "Cannot determine file location for this document" },
          { status: 404 }
        );
      }
    }

    try {
      // Read file
      const fileContent = await readFile(filePath);
      
      // Determine content type from metadata or filename
      const mimeType = (metadata.mime as string) || "application/octet-stream";
      
      // Return file with appropriate headers
      return new NextResponse(fileContent, {
        headers: {
          "Content-Type": mimeType,
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (fileError) {
      console.error("Error reading file:", fileError);
      return NextResponse.json(
        { error: "File not found on server" },
        { status: 404 }
      );
    }
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error downloading document:", error);
    return NextResponse.json(
      { error: "Failed to download document" },
      { status: 500 }
    );
  }
}

