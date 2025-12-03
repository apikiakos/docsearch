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
      // Document not found in Elasticsearch - check manifest to see if it's queued
      console.error(`[documents/${id}] Document not found in Elasticsearch. documentId: ${documentId}`);
      
      // Check manifest to see if document exists there
      const manifestEntry = await prisma.$queryRaw<Array<{
        path: string;
        tenantId: string;
        lastIndexedAt: Date;
        isDeleted: boolean;
        permanentlyDeleted: boolean;
      }>>`
        SELECT path, "tenantId", "lastIndexedAt", "isDeleted", "permanentlyDeleted"
        FROM file_manifest 
        WHERE "documentId" = ${documentId}
        LIMIT 1
      `;

      if (manifestEntry && manifestEntry.length > 0) {
        const entry = manifestEntry[0];
        if (entry.isDeleted || entry.permanentlyDeleted) {
          return NextResponse.json({ 
            error: "Document has been deleted.",
            documentId,
            deleted: true
          }, { status: 404 });
        }
        
        // Document is in manifest but not indexed - likely queued or processing failed
        return NextResponse.json({ 
          error: "Document is queued but not yet indexed. It may still be processing or may have failed to index.",
          documentId,
          queued: true,
          manifest: {
            path: entry.path,
            tenantId: entry.tenantId,
            lastIndexedAt: entry.lastIndexedAt,
          }
        }, { status: 404 });
      }
      
      return NextResponse.json({ 
        error: "Document not found in search index or manifest.",
        documentId 
      }, { status: 404 });
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
    const fullContent = chunks.map((c: { content: string }) => c.content).join("\n\n");

    // Return document with all chunks and full content
    return NextResponse.json({
      document: {
        ...firstChunk,
        content: fullContent,
        chunk_count: chunks.length,
        chunks: chunks.map((c: { chunk_index: number; content: string }) => ({
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

export async function DELETE(request: Request, context: Context) {
  try {
    await requireAuth();
    const { id } = await context.params;
    
    // Check for permanent flag in query params
    const url = new URL(request.url);
    const permanent = url.searchParams.get("permanent") === "true";

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

    // Execute bulk delete and check for errors
    const bulkResult = await elasticsearch.bulk({
      operations: bulkBody,
      refresh: "wait_for",
    });

    // Check for failed deletions
    if (bulkResult.errors) {
      const failedItems = (bulkResult.items || []).filter(
        (item: { delete?: { error?: unknown } }) => item.delete?.error
      );
      if (failedItems.length > 0) {
        console.error(`[DELETE /documents/${id}] Failed to delete ${failedItems.length} chunks:`, failedItems);
        // Continue anyway - we'll mark manifest as deleted even if some chunks failed
      }
    }

    const deletedCount = (bulkResult.items || []).filter(
      (item: { delete?: { result?: string } }) => item.delete?.result === "deleted"
    ).length;
    console.log(`[DELETE /documents/${id}] Deleted ${deletedCount} chunks from Elasticsearch`);

    // Mark document as deleted in manifest (if it exists)
    // We need to find the manifest entry by document_id
    try {
      // Use raw SQL query since Prisma client may not have FileManifest model generated
      const manifestEntry = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM file_manifest 
        WHERE "tenantId" = ${tenantSlug} AND "documentId" = ${documentId}
        LIMIT 1
      `;

      if (manifestEntry && manifestEntry.length > 0) {
        await prisma.$executeRaw`
          UPDATE file_manifest 
          SET "isDeleted" = true, "permanentlyDeleted" = ${permanent}
          WHERE id = ${manifestEntry[0].id}
        `;
        console.log(`[DELETE /documents/${id}] Marked manifest entry as ${permanent ? 'permanently ' : ''}deleted: ${manifestEntry[0].id} (documentId: ${documentId})`);
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
