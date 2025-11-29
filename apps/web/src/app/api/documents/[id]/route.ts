import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../../lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "../../../../lib/elasticsearch";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { id } = await context.params;

    // Extract document_id and tenant from the ID (format: document_id#chunk_N or just document_id)
    const [documentId, chunkPart] = id.split("#chunk_");
    const chunkIndex = chunkPart ? parseInt(chunkPart, 10) : null;

    // Search for the document to find its tenant
    const searchResult = await elasticsearch.search({
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

    if (searchResult.hits.hits.length === 0) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const hit = searchResult.hits.hits[0]._source as { tenant_id: string; [key: string]: unknown };
    const tenantSlug = hit.tenant_id;

    // Check tenant access
    await requireTenantAccess(tenantSlug);

    // If chunk index specified, return that chunk; otherwise return first chunk
    const targetChunkIndex = chunkIndex !== null ? chunkIndex : 0;
    const indexName = getTenantIndex(tenantSlug);
    const chunkId = `${documentId}#chunk_${targetChunkIndex}`;

    const doc = await elasticsearch.get({
      index: indexName,
      id: chunkId,
    });

    if (!doc.found) {
      return NextResponse.json({ error: "Document chunk not found" }, { status: 404 });
    }

    return NextResponse.json({ document: doc._source });
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
