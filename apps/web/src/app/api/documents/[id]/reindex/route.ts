import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../../lib/auth-helpers";
import { elasticsearch } from "../../../../../lib/elasticsearch";
import { prisma } from "../../../../../lib/prisma";

const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8000";

type Context = { params: Promise<{ id: string }> };

/**
 * Reindex a single document by document_id
 * POST /api/documents/[id]/reindex
 */
export async function POST(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { id } = await context.params;

    // Extract document_id
    const documentId = id.split("#chunk_")[0];

    // First, try to find the document in Elasticsearch to get tenant
    let tenantSlug: string | null = null;
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
    }

    // If not in ES, get tenant from manifest
    if (!tenantSlug) {
      const manifestEntry = await prisma.$queryRaw<Array<{ 
        path: string;
        "tenantId": string;
      }>>`
        SELECT path, "tenantId" FROM file_manifest 
        WHERE "documentId" = ${documentId}
        LIMIT 1
      `;

      if (!manifestEntry || manifestEntry.length === 0) {
        return NextResponse.json(
          { error: "Document not found in search index or manifest" },
          { status: 404 }
        );
      }

      tenantSlug = manifestEntry[0].tenantId;
    }

    // Check tenant access
    await requireTenantAccess(tenantSlug);

    // Get manifest entry to find the path
    const manifestEntry = await prisma.$queryRaw<Array<{ 
      path: string;
      "tenantId": string;
    }>>`
      SELECT path, "tenantId" FROM file_manifest 
      WHERE "tenantId" = ${tenantSlug} AND "documentId" = ${documentId}
      LIMIT 1
    `;

    if (!manifestEntry || manifestEntry.length === 0) {
      return NextResponse.json(
        { error: "Manifest entry not found for this document" },
        { status: 404 }
      );
    }

    const manifestPath = manifestEntry[0].path;

    // Determine producer type based on tenant
    let producerType: "gutenberg" | "s3" | "govdocs";
    if (tenantSlug === "gutenberg") {
      producerType = "gutenberg";
    } else if (tenantSlug.startsWith("s3-")) {
      producerType = "s3";
    } else if (tenantSlug === "govdocs") {
      producerType = "govdocs";
    } else {
      return NextResponse.json(
        { error: `Unknown producer type for tenant: ${tenantSlug}` },
        { status: 400 }
      );
    }

    // Call FastAPI to reindex the document
    try {
      const response = await fetch(`${FASTAPI_URL}/producer/${producerType}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenant: producerType === "gutenberg" ? undefined : tenantSlug,
          reindexDocument: manifestPath,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return NextResponse.json(
          { error: data.detail || "Failed to reindex document" },
          { status: response.status }
        );
      }

      return NextResponse.json({
        success: true,
        message: data.message || "Document reindexed successfully",
        documentId,
        path: manifestPath,
      });
    } catch (fetchError) {
      console.error("Error calling FastAPI:", fetchError);
      return NextResponse.json(
        { error: "Failed to connect to producer service" },
        { status: 503 }
      );
    }
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error reindexing document:", error);
    return NextResponse.json(
      { error: "Failed to reindex document" },
      { status: 500 }
    );
  }
}

