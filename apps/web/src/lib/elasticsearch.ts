import { Client } from "@elastic/elasticsearch";

const globalForElasticsearch = globalThis as unknown as {
  elasticsearch: Client | undefined;
};

export const elasticsearch =
  globalForElasticsearch.elasticsearch ??
  new Client({
    node: process.env.ELASTICSEARCH_URL || "http://localhost:9200",
  });

if (process.env.NODE_ENV !== "production") {
  globalForElasticsearch.elasticsearch = elasticsearch;
}

/**
 * Get the index name for a tenant
 */
export function getTenantIndex(tenantSlug: string): string {
  return `docs_${tenantSlug}`;
}

/**
 * Ensure index exists with proper mapping for chunked documents
 */
export async function ensureIndex(tenantSlug: string): Promise<void> {
  const indexName = getTenantIndex(tenantSlug);

  const exists = await elasticsearch.indices.exists({ index: indexName });
  if (exists) {
    return;
  }

  await elasticsearch.indices.create({
    index: indexName,
    mappings: {
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
          properties: {
            filename: { type: "keyword" },
            mime: { type: "keyword" },
            source: { type: "keyword" },
            originalUrl: { type: "keyword" },
          },
        },
        created_at: { type: "date" },
        updated_at: { type: "date" },
      },
    },
  });
}

