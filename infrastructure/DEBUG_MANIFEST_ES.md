# Debugging Manifest vs Elasticsearch Discrepancy

When you have more manifest entries than Elasticsearch documents, here's how to diagnose and fix it.

## Quick Diagnosis Commands

### 1. Check Manifest Count for Gutenberg

```bash
# SSH to production server
cd /path/to/distributed-docsearch-prototype/workers/python
source venv/bin/activate

# Count manifest entries for gutenberg
python -c "
from manifest import ManifestDB
db = ManifestDB()
entries = db.get_all_manifest_entries(tenant_id='gutenberg')
print(f'Total manifest entries: {len(entries)}')
print(f'Active entries: {len([e for e in entries if not e.isDeleted and not e.permanentlyDeleted])}')
print(f'Deleted entries: {len([e for e in entries if e.isDeleted or e.permanentlyDeleted])}')
"
```

### 2. Check Elasticsearch Document Count

```bash
# Count documents in ES
curl "http://localhost:9200/docs_gutenberg/_count?pretty"

# Count unique documents (using collapse)
curl -X POST "http://localhost:9200/docs_gutenberg/_search?pretty" -H 'Content-Type: application/json' -d'
{
  "size": 0,
  "aggs": {
    "unique_docs": {
      "cardinality": {
        "field": "document_id"
      }
    }
  }
}'
```

### 3. Check RabbitMQ Queue

```bash
# Check if there are messages still in queue
curl -u guest:guest "http://localhost:15672/api/queues/%2F/doc_ingest" | python -m json.tool

# Or access RabbitMQ UI
# http://your-server:15672 (guest/guest)
# Go to Queues > doc_ingest
```

### 4. Run Diagnostic Script

```bash
cd workers/python
source venv/bin/activate
python check_missing_documents.py gutenberg
```

This will show:
- Documents in manifest but not in ES (problem)
- Documents in ES but not in manifest (expected for API-created docs)

## Detailed Diagnosis

### Step 1: Get List of Missing Documents

```bash
cd workers/python
source venv/bin/activate

python << 'EOF'
from manifest import ManifestDB
import requests
import json

db = ManifestDB()
tenant_id = "gutenberg"

# Get all manifest entries
entries = db.get_all_manifest_entries(tenant_id=tenant_id)
active_entries = [e for e in entries if not e.isDeleted and not e.permanentlyDeleted]

print(f"Total manifest entries: {len(entries)}")
print(f"Active manifest entries: {len(active_entries)}")

# Get all document IDs from ES
es_url = "http://localhost:9200"
index_name = f"docs_{tenant_id}"

# Get unique document IDs from ES
query = {
    "size": 0,
    "aggs": {
        "unique_docs": {
            "terms": {
                "field": "document_id",
                "size": 10000
            }
        }
    }
}

response = requests.post(f"{es_url}/{index_name}/_search", json=query)
if response.status_code == 200:
    data = response.json()
    es_doc_ids = set()
    if "aggregations" in data and "unique_docs" in data["aggregations"]:
        for bucket in data["aggregations"]["unique_docs"]["buckets"]:
            es_doc_ids.add(bucket["key"])
    
    print(f"Documents in ES: {len(es_doc_ids)}")
    
    # Find missing documents
    manifest_doc_ids = {e.documentId for e in active_entries}
    missing_in_es = manifest_doc_ids - es_doc_ids
    extra_in_es = es_doc_ids - manifest_doc_ids
    
    print(f"\nMissing in ES: {len(missing_in_es)}")
    if missing_in_es:
        print("\nFirst 10 missing documents:")
        for i, doc_id in enumerate(list(missing_in_es)[:10]):
            entry = next((e for e in active_entries if e.documentId == doc_id), None)
            if entry:
                print(f"  {i+1}. {entry.path} (doc_id: {doc_id[:16]}...)")
    
    if extra_in_es:
        print(f"\nExtra in ES (not in manifest): {len(extra_in_es)}")
else:
    print(f"Error querying ES: {response.status_code}")
    print(response.text)
EOF
```

### Step 2: Check Consumer Status

```bash
# Check if consumer is running
pm2 status docsearch-consumer

# Check consumer logs for errors
pm2 logs docsearch-consumer --lines 100 --err

# Check if consumer is processing
pm2 logs docsearch-consumer --lines 20
```

### Step 3: Check for Failed Indexing

Look for errors in consumer logs that might indicate why some documents weren't indexed:

```bash
pm2 logs docsearch-consumer --lines 500 | grep -i "error\|failed\|exception"
```

## Fixing the Issue

### Option 1: Re-index Missing Documents

If documents are in manifest but not in ES, re-index them:

```bash
cd workers/python
source venv/bin/activate

# Re-index all missing documents
python << 'EOF'
from manifest import ManifestDB
import requests
import pika
import os

db = ManifestDB()
tenant_id = "gutenberg"

# Get all active manifest entries
entries = db.get_all_manifest_entries(tenant_id=tenant_id)
active_entries = [e for e in entries if not e.isDeleted and not e.permanentlyDeleted]

# Get ES document IDs
es_url = "http://localhost:9200"
index_name = f"docs_{tenant_id}"

query = {
    "size": 0,
    "aggs": {
        "unique_docs": {
            "terms": {
                "field": "document_id",
                "size": 10000
            }
        }
    }
}

response = requests.post(f"{es_url}/{index_name}/_search", json=query)
es_doc_ids = set()
if response.status_code == 200:
    data = response.json()
    if "aggregations" in data and "unique_docs" in data["aggregations"]:
        for bucket in data["aggregations"]["unique_docs"]["buckets"]:
            es_doc_ids.add(bucket["key"])

# Find missing
manifest_doc_ids = {e.documentId for e in active_entries}
missing_in_es = manifest_doc_ids - es_doc_ids

print(f"Found {len(missing_in_es)} documents to re-index")

# Connect to RabbitMQ
rabbitmq_url = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
params = pika.URLParameters(rabbitmq_url)
connection = pika.BlockingConnection(params)
channel = connection.channel()
channel.queue_declare(queue="doc_ingest", durable=True)

# Enqueue missing documents
enqueued = 0
for entry in active_entries:
    if entry.documentId in missing_in_es:
        message = {
            "operation": "upsert",
            "tenant_id": tenant_id,
            "document_id": entry.documentId,
            "path": entry.path,
            "mime": "text/plain"  # Gutenberg books are plain text
        }
        channel.basic_publish(
            exchange="",
            routing_key="doc_ingest",
            body=json.dumps(message),
            properties=pika.BasicProperties(delivery_mode=2)  # Make message persistent
        )
        enqueued += 1
        print(f"Enqueued: {entry.path}")

connection.close()
print(f"\n✅ Enqueued {enqueued} documents for re-indexing")
EOF
```

### Option 2: Clean Up Manifest Entries

If some manifest entries are invalid or shouldn't be there:

```bash
cd workers/python
source venv/bin/activate

# Mark entries as deleted (if they're truly invalid)
python << 'EOF'
from manifest import ManifestDB

db = ManifestDB()
tenant_id = "gutenberg"

# Get entries that might be problematic
entries = db.get_all_manifest_entries(tenant_id=tenant_id)

# Example: Mark entries without lastIndexedAt as needing re-indexing
# (This is just an example - adjust based on your needs)
for entry in entries:
    if not entry.lastIndexedAt:
        print(f"Entry without lastIndexedAt: {entry.path}")
        # You can mark it for re-indexing or delete it
        # db.mark_as_deleted(tenant_id, entry.path)  # Uncomment if needed
EOF
```

### Option 3: Purge Queue and Re-index

If the queue has stuck messages:

```bash
cd workers/python
source venv/bin/activate

# Purge the queue
python purge_queue.py

# Then re-index via UI or producer
```

## Prevention

### 1. Add Limits to Gutenberg Producer

The producer should respect the `--fetch-new` limit. Check if it's working correctly:

```bash
# Test with a small number
python gutenberg_producer.py --fetch-new 5
```

### 2. Monitor Producer Progress

Always check producer logs when running:

```bash
# Watch FastAPI logs
pm2 logs distributed-docsearch-fastapi --follow

# Watch consumer logs
pm2 logs docsearch-consumer --follow
```

### 3. Use Smaller Batches

Instead of fetching 10 books at once, fetch smaller batches:

```bash
# Fetch 5 books at a time
python gutenberg_producer.py --fetch-new 5
```

## Understanding the Numbers

- **Manifest entries**: Documents that have been discovered and enqueued
- **ES documents**: Documents that have been successfully indexed
- **Discrepancy**: Usually means:
  - Documents are still in queue (check RabbitMQ)
  - Consumer failed to process them (check consumer logs)
  - Documents were enqueued but consumer crashed/stopped
  - Producer created manifest entries but didn't enqueue (unlikely)

## Quick Check Script

Save this as `check_gutenberg.sh`:

```bash
#!/bin/bash

cd /path/to/distributed-docsearch-prototype/workers/python
source venv/bin/activate

echo "=== Gutenberg Status ==="
echo ""

# Manifest count
python -c "
from manifest import ManifestDB
db = ManifestDB()
entries = db.get_all_manifest_entries(tenant_id='gutenberg')
active = [e for e in entries if not e.isDeleted and not e.permanentlyDeleted]
print(f'Manifest entries: {len(active)}')
"

# ES count
echo "Elasticsearch documents:"
curl -s "http://localhost:9200/docs_gutenberg/_count?pretty" | grep count

# Queue count
echo ""
echo "RabbitMQ queue messages:"
curl -s -u guest:guest "http://localhost:15672/api/queues/%2F/doc_ingest" | python -c "import sys, json; data=json.load(sys.stdin); print(f\"Messages: {data.get('messages', 0)}\")"

echo ""
echo "Run 'python check_missing_documents.py gutenberg' for detailed analysis"
```

Make it executable:
```bash
chmod +x check_gutenberg.sh
```

