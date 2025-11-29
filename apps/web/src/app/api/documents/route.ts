import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "../../../lib/auth-helpers";
import { elasticsearch, ensureIndex } from "../../../lib/elasticsearch";
import { chunkDocument } from "../../../lib/document-chunking";
import { v4 as uuidv4 } from "uuid";

export async function POST(request: Request) {
  try {
    await requireAuth();
    const body = await request.json().catch(() => null);

    if (!body || !body.title || !body.content) {
      return NextResponse.json(
        { error: "title and content are required" },
        { status: 400 }
      );
    }

    const tenantSlug = body.tenant || body.tenantId;
    if (!tenantSlug) {
      return NextResponse.json(
        { error: "tenant is required" },
        { status: 400 }
      );
    }

    // Check tenant access
    await requireTenantAccess(tenantSlug);

    // Ensure index exists
    await ensureIndex(tenantSlug);

    // Generate document ID
    const documentId = uuidv4();
    const now = new Date().toISOString();

    // Chunk the document
    const chunks = chunkDocument(body.content, 1000, 200);

    // Index each chunk
    const indexName = `docs_${tenantSlug}`;
    const bulkBody = [];

    for (const chunk of chunks) {
      const chunkId = `${documentId}#chunk_${chunk.index}`;
      bulkBody.push({
        index: {
          _index: indexName,
          _id: chunkId,
        },
      });
      bulkBody.push({
        id: chunkId,
        document_id: documentId,
        tenant_id: tenantSlug,
        chunk_index: chunk.index,
        chunk_offset: chunk.offset,
        title: body.title,
        content: chunk.content,
        metadata: body.metadata || {},
        created_at: now,
        updated_at: now,
      });
    }

    await elasticsearch.bulk({
      operations: bulkBody,
      refresh: "wait_for",
    });

    return NextResponse.json(
      {
        document: {
          id: documentId,
          tenant_id: tenantSlug,
          title: body.title,
          chunks_count: chunks.length,
        },
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error indexing document:", error);
    return NextResponse.json(
      { error: "Failed to index document" },
      { status: 500 }
    );
  }
}
