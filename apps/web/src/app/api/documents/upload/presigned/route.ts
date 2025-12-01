import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../../lib/auth-helpers";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";

const BUCKET_NAME = process.env.AWS_S3_BUCKET || "document-search-tenants";
const AWS_REGION = process.env.AWS_DEFAULT_REGION || "eu-west-1";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

function getS3Client() {
  // AWS SDK will automatically pick up credentials from environment variables
  // AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
  return new S3Client({
    region: AWS_REGION,
  });
}

export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const body = await request.json();
    const { filename, contentType, tenantId, fileSize } = body;

    if (!filename || !tenantId) {
      return NextResponse.json(
        { error: "filename and tenantId are required" },
        { status: 400 }
      );
    }

    // Check tenant access
    await requireTenantAccess(tenantId);

    // Validate file size
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum allowed size (${MAX_FILE_SIZE / 1024 / 1024}MB)` },
        { status: 400 }
      );
    }

    // Generate S3 key: uploads/{tenantId}/{timestamp}_{filename}
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3Key = `uploads/${tenantId}/${timestamp}_${sanitizedFilename}`;

    // Create presigned POST URL
    const s3Client = getS3Client();
    
    const { url, fields } = await createPresignedPost(s3Client, {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Conditions: [
        ["content-length-range", 0, MAX_FILE_SIZE], // Min 0, Max 50MB
        ["starts-with", "$Content-Type", contentType || ""],
      ],
      Fields: {
        "Content-Type": contentType || "application/octet-stream",
      },
      Expires: 60, // URL expires in 60 seconds
    });

    return NextResponse.json({
      url,
      fields,
      s3Key,
      s3Url: `s3://${BUCKET_NAME}/${s3Key}`,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error creating presigned POST URL:", error);
    return NextResponse.json(
      { error: "Failed to create upload URL" },
      { status: 500 }
    );
  }
}

