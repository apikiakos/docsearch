#!/usr/bin/env python3
"""Re-index missing documents that are in manifest but not in Elasticsearch for any tenant"""
import sys
import os
import json
import requests
import pika
import argparse
from pathlib import Path
from datetime import datetime, timezone

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from manifest import ManifestDB
from fingerprint import make_document_id
from mime_detector import detect_mime_type

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
        
        response = requests.post(search_url, json=query, timeout=30)
        response.raise_for_status()
        result = response.json()
        
        buckets = result.get("aggregations", {}).get("document_ids", {}).get("buckets", [])
        return {bucket["key"] for bucket in buckets}
    except Exception as e:
        print(f"Error querying Elasticsearch: {e}")
        return set()


def check_local_file_exists(path_str: str) -> bool:
    """Check if a local file exists"""
    return Path(path_str).exists()


def enqueue_s3_document(channel, tenant_id: str, path_str: str, entry: dict) -> bool:
    """Enqueue an S3 document for re-indexing"""
    try:
        # path_str is the S3 key (e.g., "s3-tenant-1/books/file.pdf")
        # Convert to local path: workers/data/s3_downloads/{tenant_id}/{folder}_{filename}
        s3_key = path_str
        key_parts = s3_key.split('/')
        folder = key_parts[1] if len(key_parts) > 1 else "unknown"
        filename = key_parts[-1] if key_parts else s3_key
        
        # Construct local path (same logic as s3_producer.py)
        # S3 files are stored in workers/data/s3_downloads/{tenant_id}/{folder}_{filename}
        data_dir = Path(__file__).parent.parent / "data" / "s3_downloads"
        local_filename = f"{folder}_{filename}"
        local_path = data_dir / tenant_id / local_filename
        
        # Check if local file exists
        if not check_local_file_exists(str(local_path)):
            print(f"  ⚠ Warning: Local file missing: {local_path}")
            print(f"     S3 key: {s3_key}")
            print(f"     Run s3_producer to re-download: python s3_producer.py {tenant_id} --check-existing")
            return False
        
        # Get document ID from manifest entry
        doc_id = entry.get("documentId") or entry.get("document_id")
        if not doc_id:
            # Recalculate document ID
            s3_key = path_str
            # Extract bucket name from path or use default
            bucket_name = os.environ.get("S3_BUCKET_NAME", "document-search-tenants")
            doc_id = make_document_id(tenant_id, f"s3://{bucket_name}/{s3_key}")
        
        # Detect MIME type
        mime = detect_mime_type(local_path)
        
        # Build message (same format as s3_producer.py)
        bucket_name = os.environ.get("AWS_S3_BUCKET", "document-search-tenants")
        s3_url = f"s3://{bucket_name}/{s3_key}"
        
        message = {
            "operation": "upsert",
            "tenant_id": tenant_id,
            "document_id": doc_id,
            "path": str(local_path),  # Local file path, not S3 key
            "mime": mime,
            "producer_timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "filename": filename,
                "mime": mime,
                "source": "s3",
                "source_url": s3_url,
                "type": "document",
                "originalUrl": s3_url,
                "extras": {
                    "s3_bucket": bucket_name,
                    "s3_key": s3_key,
                    "folder": folder,
                },
            },
        }
        
        body = json.dumps(message).encode("utf-8")
        channel.basic_publish(
            exchange="",
            routing_key=QUEUE_NAME,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,  # Make message persistent
                content_type="application/json"
            )
        )
        return True
    except Exception as e:
        print(f"  ❌ Error enqueuing S3 document {path_str}: {e}")
        return False


def enqueue_gutenberg_document(channel, tenant_id: str, path_str: str, entry: dict) -> bool:
    """Enqueue a Gutenberg document for re-indexing"""
    try:
        # Check if local file exists
        if not check_local_file_exists(path_str):
            print(f"  ⚠ Warning: Local file missing: {path_str}")
            print(f"     Run gutenberg_producer to re-download: python gutenberg_producer.py --force-reindex")
            return False
        
        # Extract book_id from filename (format: {book_id}_{title}.txt)
        local_path = Path(path_str)
        filename = local_path.stem
        try:
            book_id = int(filename.split("_")[0])
        except ValueError:
            print(f"  ⚠ Warning: Could not extract book_id from {path_str}")
            return False
        
        # Get document ID from manifest entry
        doc_id = entry.get("documentId") or entry.get("document_id")
        if not doc_id:
            doc_id = make_document_id(tenant_id, path_str)
        
        # Fetch book metadata from Gutendex API
        try:
            from gutenberg_producer import fetch_gutendex_page, pick_text_url
            book_url = f"https://gutendex.com/books/{book_id}/"
            book_data = fetch_gutendex_page(book_url)
            if not book_data:
                print(f"  ⚠ Warning: Could not fetch metadata for book {book_id}")
                return False
            
            title = book_data.get("title", f"book-{book_id}")
            authors = book_data.get("authors", [])
            author_names = [author.get("name", "") for author in authors if author.get("name")]
            author = ", ".join(author_names) if author_names else None
            
            formats = book_data.get("formats", {})
            text_url = pick_text_url(formats)
            
            # Build message (same format as gutenberg_producer.publish_file)
            message = {
                "operation": "upsert",
                "tenant_id": tenant_id,
                "document_id": doc_id,
                "path": path_str,
                "mime": "text/plain",
                "producer_timestamp": datetime.now(timezone.utc).isoformat(),
                "metadata": {
                    "filename": local_path.name,
                    "mime": "text/plain",
                    "source": "gutendex",
                    "source_url": text_url or path_str,
                    "type": "book",
                    "originalUrl": text_url or path_str,
                    "extras": {
                        "book_id": book_id,
                        "title": title,
                        "author": author,
                    },
                },
            }
            
            body = json.dumps(message).encode("utf-8")
            channel.basic_publish(
                exchange="",
                routing_key=QUEUE_NAME,
                body=body,
                properties=pika.BasicProperties(
                    delivery_mode=2,
                    content_type="application/json"
                )
            )
            return True
        except ImportError:
            print(f"  ❌ Error: Could not import gutenberg_producer helpers")
            return False
        except Exception as e:
            print(f"  ❌ Error fetching Gutenberg metadata for {path_str}: {e}")
            return False
    except Exception as e:
        print(f"  ❌ Error enqueuing Gutenberg document {path_str}: {e}")
        return False


def enqueue_govdocs_document(channel, tenant_id: str, path_str: str, entry: dict) -> bool:
    """Enqueue a GovDocs document for re-indexing"""
    try:
        # Check if local file exists
        if not check_local_file_exists(path_str):
            print(f"  ⚠ Warning: Local file missing: {path_str}")
            return False
        
        # Get document ID from manifest entry
        doc_id = entry.get("documentId") or entry.get("document_id")
        if not doc_id:
            doc_id = make_document_id(tenant_id, path_str)
        
        # Detect MIME type
        local_path = Path(path_str)
        mime = detect_mime_type(local_path)
        
        # Build message
        message = {
            "operation": "upsert",
            "tenant_id": tenant_id,
            "document_id": doc_id,
            "path": path_str,
            "mime": mime,
            "producer_timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": {
                "filename": local_path.name,
                "mime": mime,
                "source": "local_folder",
                "source_url": path_str,
                "type": "document",
                "originalUrl": path_str,
            },
        }
        
        body = json.dumps(message).encode("utf-8")
        channel.basic_publish(
            exchange="",
            routing_key=QUEUE_NAME,
            body=body,
            properties=pika.BasicProperties(
                delivery_mode=2,
                content_type="application/json"
            )
        )
        return True
    except Exception as e:
        print(f"  ❌ Error enqueuing GovDocs document {path_str}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Re-index missing documents for any tenant")
    parser.add_argument("tenant_id", help="Tenant ID to check (e.g., s3-tenant-1, gutenberg)")
    parser.add_argument("--yes", action="store_true", help="Skip confirmation prompt and proceed with reindexing")
    parser.add_argument("--limit", type=int, help="Limit the number of documents to re-index (for testing)")
    args = parser.parse_args()
    
    tenant_id = args.tenant_id
    
    print(f"Checking missing documents for tenant: {tenant_id}")
    print("=" * 70)
    
    # Get manifest entries
    db = ManifestDB()
    manifest_entries = db.get_all_manifest_entries(tenant_id)
    
    # Filter active entries (not deleted)
    active_entries = [
        e for e in manifest_entries 
        if not e.get("isDeleted", False) and not e.get("permanentlyDeleted", False)
    ]
    
    print(f"Total manifest entries: {len(manifest_entries)}")
    print(f"Active manifest entries: {len(active_entries)}")
    
    # Get Elasticsearch document IDs
    print(f"Querying Elasticsearch for document IDs...")
    es_doc_ids = get_es_document_ids(tenant_id, ES_URL)
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
    
    # Apply limit if specified
    if args.limit and len(missing) > args.limit:
        print(f"⚠ Limiting to first {args.limit} documents (--limit specified)")
        missing = missing[:args.limit]
        print()
    
    # Ask for confirmation
    if not args.yes:
        print("=" * 70)
        try:
            response = input(f"Re-index {len(missing)} missing documents? (y/N): ")
            if response.lower() != 'y':
                print("Cancelled.")
                return
        except (EOFError, OSError):
            print("\nRunning in non-interactive mode (no stdin). Proceeding with reindexing.")
    
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
    
    # Enqueue missing documents based on tenant type
    print(f"\nEnqueuing {len(missing)} documents...")
    enqueued = 0
    failed = 0
    skipped = 0
    
    for doc_id, path, entry in missing:
        try:
            # Determine tenant type and enqueue accordingly
            if tenant_id.startswith("s3-"):
                success = enqueue_s3_document(channel, tenant_id, path, entry)
            elif tenant_id == "gutenberg":
                success = enqueue_gutenberg_document(channel, tenant_id, path, entry)
            elif tenant_id == "govdocs":
                success = enqueue_govdocs_document(channel, tenant_id, path, entry)
            else:
                # Generic fallback - try to enqueue with basic info
                print(f"  ⚠ Unknown tenant type, using generic enqueue for {path}")
                local_path = Path(path)
                if not local_path.exists():
                    print(f"  ⚠ Local file missing: {path}, skipping")
                    skipped += 1
                    continue
                
                doc_id = entry.get("documentId") or entry.get("document_id") or make_document_id(tenant_id, path)
                mime = detect_mime_type(local_path)
                
                message = {
                    "operation": "upsert",
                    "tenant_id": tenant_id,
                    "document_id": doc_id,
                    "path": path,
                    "mime": mime,
                    "producer_timestamp": datetime.now(timezone.utc).isoformat(),
                    "metadata": {
                        "filename": local_path.name,
                        "mime": mime,
                        "source": "unknown",
                        "source_url": path,
                        "type": "document",
                        "originalUrl": path,
                    },
                }
                
                body = json.dumps(message).encode("utf-8")
                channel.basic_publish(
                    exchange="",
                    routing_key=QUEUE_NAME,
                    body=body,
                    properties=pika.BasicProperties(delivery_mode=2, content_type="application/json")
                )
                success = True
            
            if success:
                enqueued += 1
                if enqueued % 10 == 0:
                    print(f"  Enqueued {enqueued}/{len(missing)}...")
            else:
                failed += 1
        except Exception as e:
            print(f"  ❌ Error processing {path}: {e}")
            failed += 1
    
    connection.close()
    
    print()
    print("=" * 70)
    print(f"✅ Enqueued {enqueued} documents for re-indexing")
    if skipped > 0:
        print(f"⚠ Skipped {skipped} documents (local files missing)")
    if failed > 0:
        print(f"❌ Failed to enqueue {failed} documents")
    print()
    print("The consumer will process these documents. Check consumer logs:")
    print("  pm2 logs docsearch-consumer --follow  # (production)")
    print("  # or check your local consumer output")
    print("=" * 70)


if __name__ == "__main__":
    main()

