import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess, hasTenantAccess } from "../../../../lib/auth-helpers";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

/**
 * Trigger a tenant-specific producer via FastAPI
 * 
 * Body: { 
 *   tenant: string, 
 *   producerType: 'gutenberg' | 's3' | 'govdocs',
 *   checkExisting?: boolean,
 *   forceReindex?: boolean,
 *   fetchNew?: number
 * }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { tenant, producerType, checkExisting, forceReindex, fetchNew } = body;

    if (!tenant || !producerType) {
      return NextResponse.json(
        { error: "tenant and producerType are required" },
        { status: 400 }
      );
    }

    if (checkExisting === undefined && forceReindex === undefined && fetchNew === undefined) {
      return NextResponse.json(
        { error: "At least one of checkExisting, forceReindex, or fetchNew must be specified" },
        { status: 400 }
      );
    }

    // Check tenant access
    if (!hasTenantAccess(user, tenant)) {
      return NextResponse.json(
        { error: "Forbidden: No access to this tenant" },
        { status: 403 }
      );
    }

    // Map producer types to FastAPI endpoints
    let endpoint = "";
    let requestBody: Record<string, unknown> = {
      tenant,
      checkExisting: checkExisting ?? false,
      forceReindex: forceReindex ?? false,
      fetchNew: fetchNew ?? undefined,
    };

    switch (producerType) {
      case "gutenberg":
        endpoint = "/producer/gutenberg";
        break;
      case "s3":
        endpoint = "/producer/s3";
        break;
      case "govdocs":
        endpoint = "/producer/govdocs";
        break;
      default:
        return NextResponse.json(
          { error: `Unknown producer type: ${producerType}` },
          { status: 400 }
        );
    }

    // Call FastAPI
    try {
      console.log(`[api/producers/trigger] Calling FastAPI: ${FASTAPI_URL}${endpoint}`);
      console.log(`[api/producers/trigger] Request body:`, JSON.stringify(requestBody, null, 2));
      
      const response = await fetch(`${FASTAPI_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`[api/producers/trigger] Response status: ${response.status}`);
      
      const data = await response.json();
      console.log(`[api/producers/trigger] Response data:`, JSON.stringify(data, null, 2));

      if (!response.ok) {
        console.error(`[api/producers/trigger] FastAPI returned error:`, data);
        return NextResponse.json(
          { error: data.detail || "Failed to trigger producer" },
          { status: response.status }
        );
      }

      return NextResponse.json({
        success: true,
        message: data.message || "Producer triggered successfully",
        tenant: data.tenant || tenant,
      });
    } catch (fetchError) {
      console.error("[api/producers/trigger] Error calling FastAPI:", fetchError);
      if (fetchError instanceof Error) {
        console.error("[api/producers/trigger] Error details:", {
          name: fetchError.name,
          message: fetchError.message,
          stack: fetchError.stack,
        });
      }
      return NextResponse.json(
        { error: `Failed to connect to producer service: ${fetchError instanceof Error ? fetchError.message : "Unknown error"}` },
        { status: 503 }
      );
    }
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

