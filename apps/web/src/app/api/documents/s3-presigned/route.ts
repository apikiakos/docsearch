import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "@/lib/auth-helpers";
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

/**
 * Generate a presigned URL for an S3 object
 * 
 * Query parameters:
 * - s3Key: The S3 key (path) of the object
 * - tenantId: The tenant ID (for access control)
 * - expiresIn: Optional expiration time in seconds (default: 3600 = 1 hour)
 */
export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(request.url);
    const s3Key = url.searchParams.get("s3Key");
    const tenantId = url.searchParams.get("tenantId");
    const expiresIn = parseInt(url.searchParams.get("expiresIn") || "3600", 10);

    if (!s3Key) {
      return NextResponse.json({ error: "s3Key parameter is required" }, { status: 400 });
    }

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId parameter is required" }, { status: 400 });
    }

    // Check tenant access
    await requireTenantAccess(tenantId);

    // Validate that the s3Key belongs to this tenant
    // S3 keys should be in format: {tenantId}/... or uploads/{tenantId}/...
    if (!s3Key.startsWith(`${tenantId}/`) && !s3Key.startsWith(`uploads/${tenantId}/`)) {
      return NextResponse.json(
        { error: "S3 key does not belong to the specified tenant" },
        { status: 403 }
      );
    }

    // Generate presigned URL
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });

    return NextResponse.json({
      url: presignedUrl,
      expiresIn,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error generating presigned URL:", error);
    return NextResponse.json(
      { error: "Failed to generate presigned URL" },
      { status: 500 }
    );
  }
}

