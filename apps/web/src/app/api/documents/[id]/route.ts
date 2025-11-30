import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "../../../../lib/elasticsearch";
import { prisma } from "../../../../lib/prisma";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { id } = await context.params;

    // Extract document_id from the ID (format: document_id#chunk_N or just document_id)
    const [documentId] = id.split("#chunk_");

    // Search for the document to find its tenant
    const initialSearch = await elasticsearch.search({
      index: "docs_*",
      query: {
        bool: {
          must: [
            { term: { document_id: documentId } },
          ],
        },
      },
      size: 1,
    });

    if (initialSearch.hits.hits.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const hit = initialSearch.hits.hits[0]._source as { tenant_id: string; [key: string]: unknown };
    const tenantSlug = hit.tenant_id;

    // Check tenant access
    await requireTenantAccess(tenantSlug);

    const indexName = getTenantIndex(tenantSlug);
    
    // Get all chunks for this document to reconstruct full content
    const chunksSearch = await elasticsearch.search({
      index: indexName,
      query: {
        term: { document_id: documentId },
      },
      size: 1000,
      sort: [{ chunk_index: { order: "asc" } }],
    });

    if (chunksSearch.hits.hits.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    // Reconstruct full document from chunks
    const chunks = chunksSearch.hits.hits.map((hit) => hit._source as {
      document_id: string;
      tenant_id: string;
      title: string;
      content: string;
      chunk_index: number;
      metadata?: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    });

    // Sort chunks by index
    chunks.sort((a, b) => a.chunk_index - b.chunk_index);

    // Get metadata from first chunk
    const firstChunk = chunks[0];
    const fullContent = chunks.map((c) => c.content).join("\n\n");

    // Return document with all chunks and full content
    return NextResponse.json({
      document: {
        ...firstChunk,
        content: fullContent,
        chunk_count: chunks.length,
        chunks: chunks.map((c) => ({
          chunk_index: c.chunk_index,
          content: c.content,
        })),
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error && typeof error === "object" && "statusCode" in error && error.statusCode === 404) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    console.error("Error fetching document:", error);
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { id } = await context.params;

    // Extract document_id
    const documentId = id.split("#chunk_")[0];

    // Find all chunks for this document
    const searchResult = await elasticsearch.search({
      index: "docs_*",
      query: {
        term: { document_id: documentId },
      },
      size: 1000,
    });

    if (searchResult.hits.hits.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const hit = searchResult.hits.hits[0]._source as { tenant_id: string; [key: string]: unknown };
    const tenantSlug = hit.tenant_id;

    // Check tenant access
    await requireTenantAccess(tenantSlug);

    // Delete all chunks
    const indexName = getTenantIndex(tenantSlug);
    const bulkBody = [];

    for (const hit of searchResult.hits.hits) {
      bulkBody.push({
        delete: {
          _index: indexName,
          _id: hit._id,
        },
      });
    }

    await elasticsearch.bulk({
      operations: bulkBody,
      refresh: "wait_for",
    });

    // Mark document as deleted in manifest (if it exists)
    // We need to find the manifest entry by document_id
    try {
      const manifestEntry = await prisma.fileManifest.findFirst({
        where: {
          tenantId: tenantSlug,
          documentId: documentId,
        },
      });

      if (manifestEntry) {
        await prisma.fileManifest.update({
          where: {
            id: manifestEntry.id,
          },
          data: {
            isDeleted: true,
          },
        });
        console.log(`[DELETE /documents/${id}] Marked manifest entry as deleted: ${manifestEntry.id} (documentId: ${documentId})`);
      } else {
        console.warn(`[DELETE /documents/${id}] No manifest entry found for documentId: ${documentId}, tenant: ${tenantSlug}`);
      }
    } catch (error) {
      // Log error but don't fail the deletion - chunks are already deleted from ES
      console.error(`[DELETE /documents/${id}] Error updating manifest for deleted document:`, error);
      if (error instanceof Error) {
        console.error("Error details:", {
          message: error.message,
          stack: error.stack,
          documentId,
          tenantSlug,
        });
      }
    }

    return NextResponse.json({ deleted: true, id: documentId });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    );
  }
}
