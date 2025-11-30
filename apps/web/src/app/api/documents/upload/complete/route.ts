import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../../lib/auth-helpers";

/**
 * This endpoint is called after the client successfully uploads a file to S3
 * It triggers the S3 producer to process the uploaded file
 */
export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const body = await request.json();
    const { tenantId, s3Key } = body;

    if (!tenantId || !s3Key) {
      return NextResponse.json(
        { error: "tenantId and s3Key are required" },
        { status: 400 }
      );
    }

    // Check tenant access
    await requireTenantAccess(tenantId);

    // Trigger S3 producer to process this file (async, don't wait)
    // The producer will scan uploads/{tenantId} and process new files
    const baseUrl = request.url.split("/api")[0];
    
    fetch(`${baseUrl}/api/documents/trigger-producer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the authorization header if present
        ...(request.headers.get("authorization") && {
          authorization: request.headers.get("authorization")!,
        }),
      },
      body: JSON.stringify({ tenantId, s3Key }),
    }).catch((error) => {
      // Log but don't fail if producer trigger fails
      console.error("Failed to trigger S3 producer:", error);
    });

    return NextResponse.json({
      success: true,
      message: "File uploaded successfully. Processing will begin shortly.",
      s3Key,
      tenantId,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error completing upload:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}

