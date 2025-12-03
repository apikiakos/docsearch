import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../lib/auth-helpers";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

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

    // Trigger S3 producer via FastAPI (async, don't wait)
    fetch(`${FASTAPI_URL}/producer/s3`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenant: tenantId }),
    }).catch((error) => {
      // Log but don't fail if producer trigger fails
      console.error("Failed to trigger S3 producer:", error);
    });

    return NextResponse.json({
      success: true,
      message: "S3 producer triggered successfully",
      tenantId,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error triggering producer:", error);
    return NextResponse.json(
      { error: "Failed to trigger producer" },
      { status: 500 }
    );
  }
}

