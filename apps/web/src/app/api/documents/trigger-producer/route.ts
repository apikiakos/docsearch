import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../lib/auth-helpers";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";

const execAsync = promisify(exec);

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

    // Trigger S3 producer for the specific tenant
    // The producer will scan the uploads/{tenantId} folder and process new files
    const projectRoot = join(process.cwd(), "../..");
    const producerScript = join(projectRoot, "workers/python/s3_producer.py");

    try {
      // Run the S3 producer for this tenant
      // It will scan uploads/{tenantId} and process new files
      const { stdout, stderr } = await execAsync(
        `cd ${projectRoot} && python3 ${producerScript} ${tenantId}`,
        {
          env: {
            ...process.env,
            PATH: process.env.PATH || "",
          },
          timeout: 300000, // 5 minutes timeout
        }
      );

      return NextResponse.json({
        success: true,
        message: "S3 producer triggered successfully",
        output: stdout,
        errors: stderr,
      });
    } catch (execError: unknown) {
      console.error("Error running S3 producer:", execError);
      const errorMessage = execError instanceof Error ? execError.message : "Unknown error";
      return NextResponse.json(
        {
          error: "Failed to trigger S3 producer",
          details: errorMessage,
        },
        { status: 500 }
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

