import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../lib/auth-helpers";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const BUCKET_NAME = process.env.AWS_S3_BUCKET || "document-search-tenants";
const AWS_REGION = process.env.AWS_DEFAULT_REGION || "eu-west-1";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

function getS3Client() {
  return new S3Client({
    region: AWS_REGION,
  });
}

/**
 * Check if a file with the same name already exists in the uploads folder for this tenant
 * Returns true if a duplicate exists (same filename, ignoring timestamp prefix)
 */
async function checkDuplicateFile(
  s3Client: S3Client,
  tenantId: string,
  filename: string
): Promise<boolean> {
  try {
    const prefix = `uploads/${tenantId}/`;
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    
    // List all objects in the tenant's uploads folder
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
    });
    
    const response = await s3Client.send(command);
    
    if (!response.Contents || response.Contents.length === 0) {
      return false;
    }
    
    // Check if any existing file has the same name (after removing timestamp prefix)
    // Files are stored as: uploads/{tenantId}/{timestamp}_{filename}
    // We check if any file ends with _{filename} or matches the pattern
    for (const obj of response.Contents) {
      if (!obj.Key) continue;
      
      // Extract filename from S3 key (remove prefix and timestamp)
      // Pattern: uploads/{tenantId}/{timestamp}_{filename}
      const keyParts = obj.Key.split("/");
      const lastPart = keyParts[keyParts.length - 1];
      
      // Check if the last part ends with the sanitized filename
      // This handles cases like "1234567890_file.docx" matching "file.docx"
      if (lastPart.endsWith(`_${sanitizedFilename}`) || lastPart === sanitizedFilename) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error("Error checking for duplicate file:", error);
    // If we can't check, allow the upload (fail open)
    return false;
  }
}

interface FileUpload {
  filename: string;
  contentType: string;
  fileSize: number;
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const body = await request.json();
    const { files, tenantId } = body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { error: "files array is required and must not be empty" },
        { status: 400 }
      );
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required" },
        { status: 400 }
      );
    }

    // Check tenant access
    await requireTenantAccess(tenantId);

    // Validate all files
    for (const file of files as FileUpload[]) {
      if (!file.filename || !file.contentType || !file.fileSize) {
        return NextResponse.json(
          { error: "Each file must have filename, contentType, and fileSize" },
          { status: 400 }
        );
      }

      if (file.fileSize > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File ${file.filename} exceeds maximum allowed size (${MAX_FILE_SIZE / 1024 / 1024}MB)` },
          { status: 400 }
        );
      }
    }

    // Generate presigned POST URLs for all files
    const s3Client = getS3Client();
    const uploadUrls: Array<{
      url: string;
      fields: Record<string, string>;
      s3Key: string;
      filename: string;
    }> = [];
    const duplicateFiles: string[] = [];

    for (const file of files as FileUpload[]) {
      // Check for duplicate files before generating presigned URL
      const isDuplicate = await checkDuplicateFile(s3Client, tenantId, file.filename);
      if (isDuplicate) {
        duplicateFiles.push(file.filename);
        continue; // Skip this file
      }

      const timestamp = Date.now();
      const sanitizedFilename = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const s3Key = `uploads/${tenantId}/${timestamp}_${sanitizedFilename}`;

      const { url, fields } = await createPresignedPost(s3Client, {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Conditions: [
          ["content-length-range", 0, MAX_FILE_SIZE],
          ["starts-with", "$Content-Type", file.contentType || ""],
        ],
        Fields: {
          "Content-Type": file.contentType || "application/octet-stream",
        },
        Expires: 300, // 5 minutes for batch uploads
      });

      uploadUrls.push({
        url,
        fields,
        s3Key,
        filename: file.filename,
      });
    }

    // If all files were duplicates, return an error
    if (uploadUrls.length === 0 && duplicateFiles.length > 0) {
      return NextResponse.json(
        {
          error: "All files already exist",
          duplicateFiles,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      uploads: uploadUrls,
      tenantId,
      count: uploadUrls.length,
      skippedDuplicates: duplicateFiles.length > 0 ? duplicateFiles : undefined,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error creating batch upload URLs:", error);
    return NextResponse.json(
      { error: "Failed to create upload URLs" },
      { status: 500 }
    );
  }
}

