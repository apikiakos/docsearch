import { NextResponse } from "next/server";
import { requireAuth } from "../../../../../lib/auth-helpers";
import { elasticsearch, getTenantIndex } from "../../../../../lib/elasticsearch";
import { prisma } from "../../../../../lib/prisma";

type Context = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { slug } = await context.params;

    const indexName = getTenantIndex(slug);
    const exists = await elasticsearch.indices.exists({ index: indexName });
    if (!exists) {
      return NextResponse.json({
        indexName,
        exists: false,
      });
    }

    const settings = await elasticsearch.indices.getSettings({ index: indexName });
    const stats = await elasticsearch.indices.stats({ index: indexName });
    const mapping = await elasticsearch.indices.getMapping({ index: indexName });

    const indexSettings = settings[indexName]?.settings?.index;
    const indexStats = stats.indices?.[indexName];
    const indexMapping = mapping[indexName]?.mappings;

    // Get unique document count (not chunk count)
    let uniqueDocumentCount = 0;
    const totalChunkCount = indexStats?.total?.docs?.count || 0;

    try {
      const searchResult = await elasticsearch.search({
        index: indexName,
        size: 0,
        aggs: {
          unique_documents: {
            cardinality: {
              field: "document_id",
            },
          },
        },
      });
      uniqueDocumentCount = (searchResult.aggregations?.unique_documents as { value: number })?.value || 0;
    } catch (error) {
      console.error(`Error getting unique document count for ${indexName}:`, error);
      uniqueDocumentCount = totalChunkCount;
    }

    // Get standard mapping for compatibility check
    const standardMapping = {
      properties: {
        id: { type: "keyword" },
        document_id: { type: "keyword" },
        tenant_id: { type: "keyword" },
        chunk_index: { type: "integer" },
        chunk_offset: { type: "integer" },
        title: {
          type: "text",
          fields: {
            keyword: { type: "keyword" },
          },
        },
        content: {
          type: "text",
          analyzer: "standard",
        },
        metadata: {
          type: "object",
          dynamic: false,
          properties: {
            filename: { type: "keyword" },
            mime: { type: "keyword" },
            source: { type: "keyword" },
            source_url: { type: "keyword" },
            type: { type: "keyword" },
            originalUrl: { type: "keyword" },
            extras: {
              type: "object",
              dynamic: true,
            },
          },
        },
        created_at: { type: "date" },
        updated_at: { type: "date" },
      },
    };

    // Check mapping compatibility
    const actualMapping = indexMapping?.properties as Record<string, unknown> | undefined;
    const standardProps = standardMapping.properties as Record<string, unknown>;
    const actualProps = actualMapping || {};

    let mappingCompatible = true;
    const requiredFields = ["id", "document_id", "tenant_id", "chunk_index", "title", "content", "metadata", "created_at", "updated_at"];

    for (const field of requiredFields) {
      if (!(field in actualProps)) {
        mappingCompatible = false;
        break;
      }
    }

    // Check metadata structure
    if (mappingCompatible) {
      const standardMetadata = (standardProps.metadata as Record<string, unknown>)?.properties as Record<string, unknown>;
      const actualMetadata = (actualProps.metadata as Record<string, unknown>)?.properties as Record<string, unknown> | undefined;

      if (!actualMetadata) {
        mappingCompatible = false;
      } else {
        const requiredMetadataFields = ["filename", "mime", "source", "source_url", "type", "originalUrl"];
        for (const field of requiredMetadataFields) {
          if (!(field in actualMetadata)) {
            mappingCompatible = false;
            break;
          }
        }

        // Check extras exists and is dynamic
        if (mappingCompatible) {
          const extras = actualMetadata.extras as Record<string, unknown> | undefined;
          if (!extras || (extras.type as string) !== "object" || (extras.dynamic as boolean) !== true) {
            // Extras is optional but if present should be dynamic object
            // We'll allow it to be missing for backward compatibility
          }
        }
      }
    }

    return NextResponse.json({
      indexName,
      exists: true,
      shards: {
        primary: typeof indexSettings?.number_of_shards === "string"
          ? parseInt(String(indexSettings.number_of_shards), 10)
          : (indexSettings?.number_of_shards as number) || 1,
        replicas: typeof indexSettings?.number_of_replicas === "string"
          ? parseInt(String(indexSettings.number_of_replicas), 10)
          : (indexSettings?.number_of_replicas as number) || 0,
        total:
          (typeof indexSettings?.number_of_shards === "string"
            ? parseInt(String(indexSettings.number_of_shards), 10)
            : (indexSettings?.number_of_shards as number) || 1) *
          (1 +
            (typeof indexSettings?.number_of_replicas === "string"
              ? parseInt(String(indexSettings.number_of_replicas), 10)
              : (indexSettings?.number_of_replicas as number) || 0)),
      },
      documentCount: uniqueDocumentCount,
      chunkCount: totalChunkCount,
      size: indexStats?.total?.store?.size_in_bytes || 0,
      mapping: indexMapping,
      mappingCompatible,
      standardMapping,
    });
  } catch (error) {
    console.error("Error fetching index info:", error);
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to fetch index info" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireAuth();

    // Check if user is platform admin - only admins can delete indices
    const isPlatformAdmin =
      user.memberships?.some((m: { tenantId: string; tenantSlug: string; role: string }) => m.role === "platform_admin") ?? false;

    if (!isPlatformAdmin) {
      return NextResponse.json({ error: "Forbidden: Only platform admins can delete indices" }, { status: 403 });
    }

    const { slug } = await context.params;

    // Verify tenant exists
    const tenant = await prisma.tenant.findUnique({
      where: { slug },
    });

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Get the expected index name for this tenant
    const expectedIndexName = getTenantIndex(slug);

    // Verify the index exists and matches the tenant
    const indexExists = await elasticsearch.indices.exists({ index: expectedIndexName });
    if (!indexExists) {
      return NextResponse.json({ error: "Index does not exist" }, { status: 404 });
    }

    // Delete the index
    await elasticsearch.indices.delete({ index: expectedIndexName });

    // Always delete all manifest entries for this tenant (erase completely)
    // This ensures zero documents, chunks, and manifest entries after dump
    await prisma.$executeRaw`
      DELETE FROM file_manifest 
      WHERE "tenantId" = ${slug}
    `;
    console.log(`[DELETE /api/tenants/${slug}/index] Deleted index ${expectedIndexName} and erased all manifest entries for tenant ${slug}`);

    return NextResponse.json({
      success: true,
      message: `Index ${expectedIndexName} deleted successfully. All manifest entries have been erased.`,
    });
  } catch (error) {
    console.error("Error deleting index:", error);
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to delete index" }, { status: 500 });
  }
}
