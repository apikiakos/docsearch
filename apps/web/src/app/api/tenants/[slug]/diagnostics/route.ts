import { NextResponse } from "next/server";
import { requireAuth, requireTenantAccess } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { elasticsearch, getTenantIndex } from "@/lib/elasticsearch";

type Context = {
  params: Promise<{ slug: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    await requireAuth();
    const { slug } = await context.params;

    // Check tenant access
    await requireTenantAccess(slug);

    // Get all manifest entries for this tenant
    const manifestEntries = await prisma.$queryRaw<Array<{
      "documentId": string;
      path: string;
      "lastIndexedAt": Date;
      "isDeleted": boolean;
      "permanentlyDeleted": boolean;
    }>>`
      SELECT "documentId", path, "lastIndexedAt", "isDeleted", "permanentlyDeleted"
      FROM file_manifest
      WHERE "tenantId" = ${slug} AND "isDeleted" = FALSE AND "permanentlyDeleted" = FALSE
      ORDER BY "lastIndexedAt" DESC
    `;

    // Get all document IDs from Elasticsearch
    const indexName = getTenantIndex(slug);
    let esDocumentIds: Set<string> = new Set();
    
    try {
      const indexExists = await elasticsearch.indices.exists({ index: indexName });
      if (indexExists) {
        // Use terms aggregation to get all unique document_ids
        // This is more efficient than scrolling through all chunks
        const searchResponse = await elasticsearch.search({
          index: indexName,
          size: 0,
          aggs: {
            document_ids: {
              terms: {
                field: "document_id",
                size: 10000, // Adjust if you have more than 10k documents
              },
            },
          },
        });

        const buckets = (searchResponse.aggregations?.document_ids as { buckets?: Array<{ key: string }> })?.buckets || [];
        for (const bucket of buckets) {
          esDocumentIds.add(bucket.key);
        }
      }
    } catch (error) {
      console.error(`Error querying Elasticsearch for tenant ${slug}:`, error);
    }

    // Compare manifest vs Elasticsearch
    const manifestDocIds = new Set(manifestEntries.map(e => e.documentId));
    const inManifestNotInES = manifestEntries.filter(e => !esDocumentIds.has(e.documentId));
    const inESNotInManifest = Array.from(esDocumentIds).filter(id => !manifestDocIds.has(id));

    return NextResponse.json({
      tenant: slug,
      summary: {
        manifestCount: manifestEntries.length,
        elasticsearchCount: esDocumentIds.size,
        missingFromES: inManifestNotInES.length,
        extraInES: inESNotInManifest.length,
      },
      manifestEntries: manifestEntries.map(e => ({
        documentId: e.documentId,
        path: e.path,
        lastIndexedAt: e.lastIndexedAt,
        inElasticsearch: esDocumentIds.has(e.documentId),
      })),
      missingFromElasticsearch: inManifestNotInES.map(e => ({
        documentId: e.documentId,
        path: e.path,
        lastIndexedAt: e.lastIndexedAt,
      })),
      extraInElasticsearch: inESNotInManifest,
    });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === "Unauthorized" || error.message.includes("Forbidden"))) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("Error getting diagnostics:", error);
    return NextResponse.json(
      { error: "Failed to get diagnostics" },
      { status: 500 }
    );
  }
}

