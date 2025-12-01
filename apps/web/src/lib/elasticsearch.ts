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
    settings: {
      number_of_shards: 3,
      number_of_replicas: 1,
    },
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
          dynamic: false, // Core metadata fields are explicitly defined
          properties: {
            // Core metadata fields (always present)
            filename: { type: "keyword" },
            mime: { type: "keyword" },
            source: { type: "keyword" },
            source_url: { type: "keyword" }, // Source URL: S3 URL, API URL, local file path, HTTP URL, etc.
            type: { type: "keyword" }, // Document type: book, invoice, report, legal, article, document, etc.
            originalUrl: { type: "keyword" }, // For display/viewing purposes
            // Extras object for type-specific descriptive information
            extras: {
              type: "object",
              dynamic: true, // Allow dynamic fields for type-specific metadata
              properties: {
                // Common extras fields (examples, not exhaustive)
                book_id: { type: "integer" },
                author: { type: "keyword" },
                s3_bucket: { type: "keyword" },
                s3_key: { type: "keyword" },
                s3_etag: { type: "keyword" },
                s3_last_modified: { type: "date" },
                folder: { type: "keyword" },
                html_meta: {
                  type: "object",
                  dynamic: true, // Allow dynamic HTML meta fields
                  properties: {
                    title: { type: "text", fields: { keyword: { type: "keyword" } } },
                    description: { type: "text" },
                    keywords: { type: "keyword" },
                    author: { type: "keyword" },
                    url: { type: "keyword" },
                    canonical_url: { type: "keyword" },
                    image: { type: "keyword" },
                    type: { type: "keyword" },
                    "og:title": { type: "text", fields: { keyword: { type: "keyword" } } },
                    "og:description": { type: "text" },
                  },
                },
                // Other type-specific fields can be added dynamically
                // Examples: invoice_number, invoice_date, amount, currency, report_date, report_type, department, etc.
              },
            },
          },
        },
        created_at: { type: "date" },
        updated_at: { type: "date" },
      },
    },
  });
}

/**
 * Get index information including shards, replicas, and mapping
 */
export async function getIndexInfo(tenantSlug: string) {
  const indexName = getTenantIndex(tenantSlug);
  
  try {
    const exists = await elasticsearch.indices.exists({ index: indexName });
    if (!exists) {
      return null;
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
      // Fallback: use total chunk count as document count if aggregation fails
      uniqueDocumentCount = totalChunkCount;
    }
    
    return {
      indexName,
      exists: true,
      shards: {
        primary: typeof indexSettings?.number_of_shards === "string" 
          ? parseInt(indexSettings.number_of_shards, 10)
          : (indexSettings?.number_of_shards as number) || 1,
        replicas: typeof indexSettings?.number_of_replicas === "string"
          ? parseInt(indexSettings.number_of_replicas, 10)
          : (indexSettings?.number_of_replicas as number) || 0,
        total: (typeof indexSettings?.number_of_shards === "string"
          ? parseInt(indexSettings.number_of_shards, 10)
          : (indexSettings?.number_of_shards as number) || 1) * (1 + (typeof indexSettings?.number_of_replicas === "string"
          ? parseInt(indexSettings.number_of_replicas, 10)
          : (indexSettings?.number_of_replicas as number) || 0)),
      },
      documentCount: uniqueDocumentCount, // Unique documents
      chunkCount: totalChunkCount, // Total chunks
      size: indexStats?.total?.store?.size_in_bytes || 0,
      mapping: indexMapping,
    };
  } catch (error) {
    console.error(`Error getting index info for ${indexName}:`, error);
    return null;
  }
}

/**
 * Get the standard mapping structure used for all tenant indices
 * This ensures mapping compatibility across tenants for multi-tenant search
 */
export function getStandardMapping() {
  return {
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
        dynamic: false, // Core metadata fields are explicitly defined
        properties: {
          // Core metadata fields (always present)
          filename: { type: "keyword" },
          mime: { type: "keyword" },
          source: { type: "keyword" },
          source_url: { type: "keyword" }, // Source URL: S3 URL, API URL, local file path, HTTP URL, etc.
          type: { type: "keyword" }, // Document type: book, invoice, report, legal, article, document, etc.
          originalUrl: { type: "keyword" }, // For display/viewing purposes
          // Extras object for type-specific descriptive information
          extras: {
            type: "object",
            dynamic: true, // Allow dynamic fields for type-specific metadata
            properties: {
              // Common extras fields (examples, not exhaustive)
              book_id: { type: "integer" },
              author: { type: "keyword" },
              s3_bucket: { type: "keyword" },
              s3_key: { type: "keyword" },
              s3_etag: { type: "keyword" },
              s3_last_modified: { type: "date" },
              folder: { type: "keyword" },
              html_meta: {
                type: "object",
                dynamic: true, // Allow dynamic HTML meta fields
                properties: {
                  title: { type: "text", fields: { keyword: { type: "keyword" } } },
                  description: { type: "text" },
                  keywords: { type: "keyword" },
                  author: { type: "keyword" },
                  url: { type: "keyword" },
                  canonical_url: { type: "keyword" },
                  image: { type: "keyword" },
                  type: { type: "keyword" },
                  "og:title": { type: "text", fields: { keyword: { type: "keyword" } } },
                  "og:description": { type: "text" },
                },
              },
              // Other type-specific fields can be added dynamically
              // Examples: invoice_number, invoice_date, amount, currency, report_date, report_type, department, etc.
            },
          },
        },
      },
      created_at: { type: "date" },
      updated_at: { type: "date" },
    },
  };
}

