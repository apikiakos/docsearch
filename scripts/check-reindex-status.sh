#!/bin/bash

# Script to check reindexing status for a tenant
# Usage: ./scripts/check-reindex-status.sh [tenant-id]

TENANT_ID=${1:-"gutenberg"}

echo "=========================================="
echo "Checking Reindex Status for: $TENANT_ID"
echo "=========================================="
echo ""

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Parse DATABASE_URL (remove Prisma query params)
DB_URL=$(echo "$DATABASE_URL" | sed 's/?.*$//')

# Check manifest table
echo "📊 MANIFEST TABLE STATUS"
echo "------------------------"
psql "$DB_URL" -c "
SELECT 
    COUNT(*) as total_documents,
    COUNT(CASE WHEN \"lastIndexedAt\" > NOW() - INTERVAL '5 minutes' THEN 1 END) as recently_indexed,
    COUNT(CASE WHEN \"isDeleted\" = true THEN 1 END) as deleted,
    COUNT(CASE WHEN \"permanentlyDeleted\" = true THEN 1 END) as permanently_deleted,
    MAX(\"lastIndexedAt\") as most_recent_index_time
FROM file_manifest
WHERE \"tenantId\" = '$TENANT_ID';
" 2>/dev/null || echo "❌ Could not connect to database. Check DATABASE_URL in .env"

echo ""
echo "📋 RECENT INDEXING ACTIVITY (Last 10 documents)"
echo "------------------------"
psql "$DB_URL" -c "
SELECT 
    path,
    \"lastIndexedAt\",
    \"sizeBytes\",
    \"isDeleted\"
FROM file_manifest
WHERE \"tenantId\" = '$TENANT_ID'
ORDER BY \"lastIndexedAt\" DESC
LIMIT 10;
" 2>/dev/null || echo "❌ Could not connect to database. Check DATABASE_URL in .env"

echo ""
echo "🔍 ELASTICSEARCH STATUS"
echo "------------------------"
ES_URL=${ELASTICSEARCH_URL:-"http://localhost:9200"}
INDEX_NAME="documents_${TENANT_ID}"

# Check if index exists
if curl -s "${ES_URL}/${INDEX_NAME}" | grep -q "\"${INDEX_NAME}\""; then
    DOC_COUNT=$(curl -s "${ES_URL}/${INDEX_NAME}/_count" | grep -o '"count":[0-9]*' | cut -d':' -f2)
    echo "✓ Index exists: ${INDEX_NAME}"
    echo "  Document count: ${DOC_COUNT}"
    
    # Get recent documents
    echo ""
    echo "  Recent documents (last 5):"
    curl -s "${ES_URL}/${INDEX_NAME}/_search?size=5&sort=created_at:desc" | \
        python3 -c "import sys, json; data=json.load(sys.stdin); \
        hits=data.get('hits',{}).get('hits',[]); \
        [print(f\"    - {h['_source'].get('title','N/A')[:50]} (created: {h['_source'].get('created_at','N/A')})\") for h in hits]" 2>/dev/null || echo "    (Could not parse results)"
else
    echo "❌ Index does not exist: ${INDEX_NAME}"
fi

echo ""
echo "📬 RABBITMQ QUEUE STATUS"
echo "------------------------"
RABBITMQ_URL=${RABBITMQ_URL:-"http://guest:guest@localhost:15672"}
QUEUE_NAME="doc_ingest"

# Check queue message count
if command -v curl >/dev/null 2>&1; then
    MSG_COUNT=$(curl -s -u guest:guest "${RABBITMQ_URL}/api/queues/%2F/${QUEUE_NAME}" 2>/dev/null | \
        python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('messages', 0))" 2>/dev/null || echo "0")
    echo "Queue: ${QUEUE_NAME}"
    echo "  Pending messages: ${MSG_COUNT}"
else
    echo "❌ curl not available"
fi

echo ""
echo "=========================================="
echo "Summary:"
echo "  - Check 'recently_indexed' count above"
echo "  - Check 'most_recent_index_time' - should be recent"
echo "  - Compare Elasticsearch doc count with manifest count"
echo "  - Check RabbitMQ queue for pending messages"
echo "=========================================="

