#!/usr/bin/env python3
"""Re-index missing Gutenberg documents that are in manifest but not in ES"""
import sys
import os
import json
import requests
import pika
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from manifest import ManifestDB

# Load environment variables
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

ES_URL = os.environ.get("ELASTICSEARCH_URL", "http://localhost:9200")
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/%2F")
QUEUE_NAME = os.environ.get("RABBITMQ_QUEUE_NAME", "doc_ingest")
TENANT_ID = "gutenberg"


def get_es_document_ids(tenant_id: str, es_url: str) -> set:
    """Get all document IDs from Elasticsearch for a tenant"""
    index_name = f"docs_{tenant_id}"
    
    try:
        # Check if index exists
        check_url = f"{es_url}/{index_name}"
        check_response = requests.head(check_url, timeout=5)
        if check_response.status_code == 404:
            return set()
        
        # Use terms aggregation to get all unique document_ids
        search_url = f"{es_url}/{index_name}/_search"
        query = {
            "size": 0,
            "aggs": {
                "document_ids": {
                    "terms": {
                        "field": "document_id",
                        "size": 10000,
                    }
                }
            }
        }
        
        response = requests.post(search_url, json=query, timeout=10)
        response.raise_for_status()
        result = response.json()
        
        buckets = result.get("aggregations", {}).get("document_ids", {}).get("buckets", [])
        return {bucket["key"] for bucket in buckets}
    except Exception as e:
        print(f"Error querying Elasticsearch: {e}")
        return set()


def main():
    print(f"Checking missing documents for tenant: {TENANT_ID}")
    print("=" * 70)
    
    # Get manifest entries
    db = ManifestDB()
    manifest_entries = db.get_all_manifest_entries(TENANT_ID)
    
    # Filter active entries
    active_entries = [
        e for e in manifest_entries 
        if not e.get("isDeleted", False) and not e.get("permanentlyDeleted", False)
    ]
    
    print(f"Total manifest entries: {len(manifest_entries)}")
    print(f"Active manifest entries: {len(active_entries)}")
    
    # Get Elasticsearch document IDs
    es_doc_ids = get_es_document_ids(TENANT_ID, ES_URL)
    print(f"Elasticsearch documents: {len(es_doc_ids)}")
    print()
    
    # Find missing documents
    missing = []
    for entry in active_entries:
        doc_id = entry.get("documentId") or entry.get("document_id")
        path = entry.get("path")
        
        if not doc_id:
            print(f"⚠ Warning: Manifest entry has no documentId: {path}")
            continue
        
        if doc_id not in es_doc_ids:
            missing.append((doc_id, path, entry))
    
    if not missing:
        print("✓ All manifest documents are indexed in Elasticsearch!")
        return
    
    print(f"❌ Found {len(missing)} documents in manifest but NOT in Elasticsearch:")
    print()
    
    # Show first 10 missing
    for i, (doc_id, path, entry) in enumerate(missing[:10]):
        print(f"{i+1}. {path}")
        print(f"   Document ID: {doc_id[:32]}...")
        print(f"   Last Indexed: {entry.get('lastIndexedAt', 'Never')}")
        print()
    
    if len(missing) > 10:
        print(f"... and {len(missing) - 10} more")
        print()
    
    # Ask for confirmation
    print("=" * 70)
    response = input(f"Re-index {len(missing)} missing documents? (y/N): ")
    if response.lower() != 'y':
        print("Cancelled.")
        return
    
    # Connect to RabbitMQ
    print("\nConnecting to RabbitMQ...")
    try:
        params = pika.URLParameters(RABBITMQ_URL)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.queue_declare(queue=QUEUE_NAME, durable=True)
        print("✓ Connected to RabbitMQ")
    except Exception as e:
        print(f"❌ Error connecting to RabbitMQ: {e}")
        return
    
    # Enqueue missing documents
    print(f"\nEnqueuing {len(missing)} documents...")
    enqueued = 0
    failed = 0
    
    for doc_id, path, entry in missing:
        try:
            message = {
                "operation": "upsert",
                "tenant_id": TENANT_ID,
                "document_id": doc_id,
                "path": path,
                "mime": "text/plain"  # Gutenberg books are plain text
            }
            
            channel.basic_publish(
                exchange="",
                routing_key=QUEUE_NAME,
                body=json.dumps(message),
                properties=pika.BasicProperties(
                    delivery_mode=2,  # Make message persistent
                    content_type="application/json"
                )
            )
            enqueued += 1
            if enqueued % 10 == 0:
                print(f"  Enqueued {enqueued}/{len(missing)}...")
        except Exception as e:
            print(f"  ❌ Error enqueuing {path}: {e}")
            failed += 1
    
    connection.close()
    
    print()
    print("=" * 70)
    print(f"✅ Enqueued {enqueued} documents for re-indexing")
    if failed > 0:
        print(f"❌ Failed to enqueue {failed} documents")
    print()
    print("The consumer will process these documents. Check consumer logs:")
    print("  pm2 logs docsearch-consumer --follow")
    print("=" * 70)


if __name__ == "__main__":
    main()

