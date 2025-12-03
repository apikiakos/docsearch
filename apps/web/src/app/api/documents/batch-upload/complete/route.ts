import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../../lib/auth-helpers";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

/**
 * This endpoint is called after the client successfully uploads all files to S3
 * It triggers the uploads producer to process the uploaded files
 */
export async function POST(request: Request) {
  try {
    await requireAuth();
    
    const body = await request.json();
    const { tenantId, s3Keys } = body;

    if (!tenantId) {
      return NextResponse.json(
        { error: "tenantId is required" },
        { status: 400 }
      );
    }

    if (!s3Keys || !Array.isArray(s3Keys) || s3Keys.length === 0) {
      return NextResponse.json(
        { error: "s3Keys array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Check tenant access
    await requireTenantAccess(tenantId);

    // Trigger uploads producer via FastAPI with tenant ID
    try {
      const producerResponse = await fetch(`${FASTAPI_URL}/producer/uploads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant: tenantId, // Pass tenant ID so producer only processes this tenant's uploads
        }),
      });

      if (!producerResponse.ok) {
        const errorText = await producerResponse.text();
        console.error("Failed to trigger uploads producer:", {
          status: producerResponse.status,
          statusText: producerResponse.statusText,
          error: errorText,
        });
        // Still return success for upload, but log the producer error
        return NextResponse.json({
          success: true,
          message: `${s3Keys.length} file(s) uploaded successfully. Producer trigger may have failed - check logs.`,
          tenantId,
          s3Keys,
          producerError: errorText,
        });
      }

      const producerData = await producerResponse.json();
      console.log("Uploads producer triggered successfully:", producerData);
    } catch (error) {
      console.error("Error triggering uploads producer:", error);
      // Still return success for upload, but log the producer error
      return NextResponse.json({
        success: true,
        message: `${s3Keys.length} file(s) uploaded successfully. Producer trigger failed - check logs.`,
        tenantId,
        s3Keys,
        producerError: error instanceof Error ? error.message : "Unknown error",
      });
    }

    return NextResponse.json({
      success: true,
      message: `${s3Keys.length} file(s) uploaded successfully. Processing will begin shortly.`,
      tenantId,
      s3Keys,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error completing batch upload:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}

