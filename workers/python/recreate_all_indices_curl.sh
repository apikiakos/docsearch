#!/bin/bash
# Recreate all tenant indices with 3 shards and 1 replica, and clear manifests

ELASTIC_URL="${ELASTICSEARCH_URL:-http://localhost:9200}"

# Define all tenants (from seed.ts)
ALL_TENANTS="gutenberg govdocs alex-local s3-tenant-1 s3-tenant-2"

# Get list of existing tenant indices
EXISTING_INDICES=$(curl -s "${ELASTIC_URL}/_cat/indices/docs_*?h=index&s=index" 2>/dev/null || echo "")

echo "Processing all tenants:"
echo "$ALL_TENANTS"
echo ""

if [ -n "$EXISTING_INDICES" ]; then
    echo "Existing indices found:"
    echo "$EXISTING_INDICES"
    echo ""
fi

# Use all tenants, not just existing indices
TENANTS="$ALL_TENANTS"

for tenant in $TENANTS; do
    echo "============================================================"
    echo "Processing tenant: $tenant"
    echo "============================================================"
    
    INDEX_NAME="docs_${tenant}"
    
    # Delete index if it exists
    echo "Deleting index: $INDEX_NAME"
    curl -s -X DELETE "${ELASTIC_URL}/${INDEX_NAME}?pretty" > /dev/null
    
    # Create index with correct settings
    echo "Creating index: $INDEX_NAME with 3 shards and 1 replica"
    curl -s -X PUT "${ELASTIC_URL}/${INDEX_NAME}?pretty" \
        -H 'Content-Type: application/json' \
        -d @- << EOF
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "id": {"type": "keyword"},
      "document_id": {"type": "keyword"},
      "tenant_id": {"type": "keyword"},
      "chunk_index": {"type": "integer"},
      "chunk_offset": {"type": "integer"},
      "title": {
        "type": "text",
        "fields": {
          "keyword": {"type": "keyword"}
        }
      },
      "content": {
        "type": "text",
        "analyzer": "standard"
      },
      "metadata": {
        "type": "object",
        "dynamic": false,
        "properties": {
          "filename": {"type": "keyword"},
          "mime": {"type": "keyword"},
          "source": {"type": "keyword"},
          "source_url": {"type": "keyword"},
          "type": {"type": "keyword"},
          "originalUrl": {"type": "keyword"},
          "extras": {
            "type": "object",
            "dynamic": true,
            "properties": {
              "book_id": {"type": "integer"},
              "author": {"type": "keyword"},
              "s3_bucket": {"type": "keyword"},
              "s3_key": {"type": "keyword"},
              "s3_etag": {"type": "keyword"},
              "s3_last_modified": {"type": "date"},
              "folder": {"type": "keyword"},
              "html_meta": {
                "type": "object",
                "dynamic": true
              }
            }
          }
        }
      },
      "created_at": {"type": "date"},
      "updated_at": {"type": "date"}
    }
  }
}
EOF
    
    # Verify settings
    echo "Verifying settings..."
    SHARDS=$(curl -s "${ELASTIC_URL}/${INDEX_NAME}/_settings?pretty" | grep '"number_of_shards"' | sed 's/.*"number_of_shards"[^"]*"\([^"]*\)".*/\1/')
    REPLICAS=$(curl -s "${ELASTIC_URL}/${INDEX_NAME}/_settings?pretty" | grep '"number_of_replicas"' | sed 's/.*"number_of_replicas"[^"]*"\([^"]*\)".*/\1/')
    echo "✓ Index $INDEX_NAME: $SHARDS shards, $REPLICAS replicas"
    
    # Clear manifest entries
    echo "Clearing manifest entries for tenant: $tenant"
    python3 workers/python/clear_tenant_manifest.py "$tenant"
    
    echo ""
done

echo "============================================================"
echo "✓ All tenant indices recreated and manifests cleared"
echo "============================================================"

