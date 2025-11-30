"""Consumer: Processes local files, extracts text, chunks, and indexes to Elasticsearch"""
import json
import os
from pathlib import Path
from datetime import datetime, timezone
import time

import pika
from elasticsearch import Elasticsearch, helpers

from chunking import chunk_text
from document_extractor import extract_text_and_metadata

# Load environment variables from root .env file
try:
    from dotenv import load_dotenv
    # Load from root .env (two levels up from workers/python)
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    # python-dotenv not installed, use environment variables directly
    pass

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
QUEUE_NAME = "doc_ingest"

ELASTIC_URL = os.environ.get("ELASTIC_URL", "http://localhost:9200")


def connect_rabbitmq():
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    return connection, channel


def connect_elastic():
    es = Elasticsearch(ELASTIC_URL)
    return es


# Removed download_url and read_file - consumer only processes local files
# All file downloading is now the producer's responsibility


def build_index_name(tenant_id: str) -> str:
    return f"docs_{tenant_id}"


def ensure_index(es: Elasticsearch, index_name: str):
    """Ensure Elasticsearch index exists with proper mapping, shards, and replicas"""
    if not es.indices.exists(index=index_name):
        mapping = {
            "settings": {
                "number_of_shards": 3,
                "number_of_replicas": 1,
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
                            "keyword": {"type": "keyword"},
                        },
                    },
                    "content": {
                        "type": "text",
                        "analyzer": "standard",
                    },
                    "metadata": {
                        "type": "object",
                        "dynamic": False,  # Core metadata fields are explicitly defined
                        "properties": {
                            # Core metadata fields (always present)
                            "filename": {"type": "keyword"},
                            "mime": {"type": "keyword"},
                            "source": {"type": "keyword"},
                            "source_url": {"type": "keyword"},  # Source URL: S3 URL, API URL, local file path, HTTP URL, etc.
                            "type": {"type": "keyword"},  # Document type: book, invoice, report, legal, article, document, etc.
                            "originalUrl": {"type": "keyword"},  # For display/viewing purposes
                            # Extras object for type-specific descriptive information
                            "extras": {
                                "type": "object",
                                "dynamic": True,  # Allow dynamic fields for type-specific metadata
                                "properties": {
                                    # Common extras fields (examples, not exhaustive)
                                    "book_id": {"type": "integer"},
                                    "author": {"type": "keyword"},
                                    "s3_bucket": {"type": "keyword"},
                                    "s3_key": {"type": "keyword"},
                                    "s3_etag": {"type": "keyword"},
                                    "s3_last_modified": {"type": "date"},
                                    "folder": {"type": "keyword"},
                                    "html_meta": {
                                        "type": "object",
                                        "dynamic": True,  # Allow dynamic HTML meta fields
                                        "properties": {
                                            "title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                                            "description": {"type": "text"},
                                            "keywords": {"type": "keyword"},
                                            "author": {"type": "keyword"},
                                            "url": {"type": "keyword"},
                                            "canonical_url": {"type": "keyword"},
                                            "image": {"type": "keyword"},
                                            "type": {"type": "keyword"},
                                            "og:title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                                            "og:description": {"type": "text"},
                                        },
                                    },
                                    # Other type-specific fields can be added dynamically
                                    # Examples: invoice_number, invoice_date, amount, currency, report_date, report_type, department, etc.
                                },
                            },
                        },
                    },
                    "created_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                },
            },
        }
        es.indices.create(index=index_name, **mapping)
        print(f"[consumer] Created index: {index_name} (shards: 1, replicas: 0)")


def process_upsert(es: Elasticsearch, message: dict):
    """
    Process upsert operation: extract text, chunk, and index to Elasticsearch.
    
    Consumer responsibilities:
    1. Open the stored local file
    2. Extract text (handles all formats: txt, pdf, docx, html, etc.)
    3. Chunk the extracted text
    4. Index chunks into Elasticsearch
    """
    process_start = time.time()
    
    tenant_id = message["tenant_id"]
    document_id = message["document_id"]
    path = message["path"]
    mime = message.get("mime", "application/octet-stream")
    producer_timestamp = message.get("producer_timestamp")
    producer_scan_time = message.get("producer_scan_time", 0)

    print(f"[consumer] Processing UPSERT: {path} (tenant={tenant_id}, doc={document_id}, mime={mime})")
    
    # Debug: Print message metadata
    message_metadata = message.get("metadata", {})
    if message_metadata:
        print(f"[consumer] Message metadata: {list(message_metadata.keys())}")
        print(f"[consumer] originalUrl in metadata: {message_metadata.get('originalUrl')}")
        print(f"[consumer] source_url in metadata: {message_metadata.get('source_url')}")
    
    # Validate that path is a local file (not a URL)
    if path.startswith("http://") or path.startswith("https://"):
        print(f"[consumer] ERROR: Received URL instead of local file path: {path}")
        print("[consumer] Producer should download and store files locally before enqueuing")
        return
    
    # Check if file exists
    if not os.path.exists(path):
        print(f"[consumer] ERROR: File not found: {path}")
        return
    
    # Calculate queue time if producer timestamp is available
    queue_time = 0
    if producer_timestamp:
        try:
            prod_time = datetime.fromisoformat(producer_timestamp.replace("Z", "+00:00"))
            queue_time = (datetime.now(timezone.utc).timestamp() - prod_time.timestamp()) * 1000  # ms
            print(f"[consumer] Queue time: {queue_time:.2f}ms")
        except Exception:
            pass

    # Consumer responsibility: extract text and metadata from stored file
    # Use MIME type from message (producer detected it)
    extract_start = time.time()
    html_meta = {}
    try:
        extraction_result = extract_text_and_metadata(path, mime)
        
        # Handle backward compatibility (if extractor returns just text)
        if isinstance(extraction_result, str):
            text = extraction_result
            html_meta = {}
        else:
            text = extraction_result.get("text", "")
            html_meta = extraction_result.get("html_meta", {})
    except Exception as e:
        print(f"[consumer] Error extracting text from {path}: {e}")
        import traceback
        traceback.print_exc()
        return
    
    extract_time = (time.time() - extract_start) * 1000
    
    if not text or not text.strip():
        print(f"[consumer] Empty or unreadable content: {path}")
        return
    
    print(f"[consumer] Extracted {len(text)} characters from {path} (extraction: {extract_time:.2f}ms)")
    if html_meta:
        print(f"[consumer] Extracted HTML metadata: {list(html_meta.keys())}")

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    index_name = build_index_name(tenant_id)
    ensure_index(es, index_name)

    # Delete old chunks for this document (idempotent reindexing)
    delete_start = time.time()
    try:
        es.delete_by_query(
            index=index_name,
            body={
                "query": {
                    "term": {"document_id": document_id}
                }
            },
            refresh=True
        )
        delete_time = (time.time() - delete_start) * 1000
        print(f"[consumer] Deleted old chunks for document {document_id} ({delete_time:.2f}ms)")
    except Exception as e:
        print(f"[consumer] Note: Could not delete old chunks (may not exist): {e}")
        delete_time = 0

    # Consumer responsibility: chunk the extracted text
    chunk_start = time.time()
    chunks = chunk_text(text, chunk_size=400, overlap=100)
    chunk_time = (time.time() - chunk_start) * 1000
    print(f"[consumer] Chunking time: {chunk_time:.2f}ms ({len(chunks)} chunks)")

    # Get title from HTML meta, message metadata, or filename
    # Note: message_metadata was already extracted above for debugging
    if "message_metadata" not in locals():
        message_metadata = message.get("metadata", {})
    
    # Priority: HTML meta title > message metadata title > filename
    title = (
        (html_meta and (html_meta.get("title") or html_meta.get("og:title"))) or
        message_metadata.get("title") or
        os.path.basename(path)
    )
    
    # Handle html_meta being None
    if html_meta is None:
        html_meta = {}
    
    # Build core metadata fields (always present)
    # For local files, ensure source_url and originalUrl are set to the file path
    source_url_value = message_metadata.get("source_url")
    if not source_url_value:
        source_url_value = path  # Fallback to path for local files
    
    original_url_value = message_metadata.get("originalUrl")
    if original_url_value is None:
        # Construct S3 URL if s3_key and s3_bucket are present
        if message_metadata.get("extras", {}).get("s3_bucket") and message_metadata.get("extras", {}).get("s3_key"):
            original_url_value = f"s3://{message_metadata.get('extras', {}).get('s3_bucket')}/{message_metadata.get('extras', {}).get('s3_key')}"
        else:
            original_url_value = path  # Fallback to path for local files
    
    core_metadata = {
        "filename": message_metadata.get("filename") or os.path.basename(path),
        "mime": message_metadata.get("mime") or mime,
        "source": message_metadata.get("source", "local_file"),
        "source_url": source_url_value,
        "type": message_metadata.get("type", "document"),  # Default to "document"
        "originalUrl": original_url_value,
    }
    
    # Build extras object (type-specific descriptive information)
    extras = {}
    
    # Copy extras from message metadata if present
    if "extras" in message_metadata:
        extras.update(message_metadata["extras"])
    
    # Add HTML meta to extras if present
    if html_meta:
        extras["html_meta"] = html_meta
    
    # For backward compatibility: if old-style fields exist in message_metadata, move them to extras
    # This handles messages from older producers that haven't been updated yet
    if "book_id" in message_metadata:
        extras["book_id"] = message_metadata["book_id"]
    if "s3_bucket" in message_metadata:
        extras["s3_bucket"] = message_metadata["s3_bucket"]
    if "s3_key" in message_metadata:
        extras["s3_key"] = message_metadata["s3_key"]
    if "s3_etag" in message_metadata:
        extras["s3_etag"] = message_metadata["s3_etag"]
    if "s3_last_modified" in message_metadata:
        extras["s3_last_modified"] = message_metadata["s3_last_modified"]
    if "folder" in message_metadata:
        extras["folder"] = message_metadata["folder"]
    
    # Consumer responsibility: index chunks into Elasticsearch
    actions = []
    for chunk_index, chunk_text_value in chunks:
        doc_id = f"{document_id}#chunk_{chunk_index}"
        chunk_offset = chunk_index * 400  # Approximate offset

        action = {
            "_index": index_name,
            "_id": doc_id,
            "_source": {
                "id": doc_id,
                "document_id": document_id,
                "tenant_id": tenant_id,
                "chunk_index": chunk_index,
                "chunk_offset": chunk_offset,
                "title": title,
                "content": chunk_text_value,
                "metadata": {
                    **core_metadata,
                    **({"extras": extras} if extras else {}),  # Only include extras if it has content
                },
                "created_at": now,
                "updated_at": now,
                "producer_timestamp": producer_timestamp,
                "producer_scan_time": producer_scan_time,
                "queue_time": queue_time,
                "extraction_time": extract_time,
                "chunking_time": chunk_time,
                "es_delete_time": delete_time,
            },
        }
        actions.append(action)

    if actions:
        index_start = time.time()
        helpers.bulk(es, actions, refresh=True)
        index_time = (time.time() - index_start) * 1000
        total_time = (time.time() - process_start) * 1000
        print(f"[consumer] Indexed {len(actions)} chunks for {path}")
        print(f"[consumer] Elasticsearch indexing time: {index_time:.2f}ms")
        print(f"[consumer] Total processing time: {total_time:.2f}ms")
    else:
        print(f"[consumer] No chunks generated for {path}")


def process_delete(es: Elasticsearch, message: dict):
    """Process delete operation: remove all chunks for a document"""
    tenant_id = message["tenant_id"]
    document_id = message["document_id"]
    path = message["path"]

    print(f"[consumer] Processing DELETE: {path} (tenant={tenant_id}, doc={document_id})")

    index_name = build_index_name(tenant_id)

    if not es.indices.exists(index=index_name):
        print(f"[consumer] Index {index_name} does not exist, nothing to delete")
        return

    try:
        result = es.delete_by_query(
            index=index_name,
            body={
                "query": {
                    "term": {"document_id": document_id}
                }
            },
            refresh=True
        )
        deleted_count = result.get("deleted", 0)
        print(f"[consumer] Deleted {deleted_count} chunks for document {document_id}")
    except Exception as e:
        print(f"[consumer] Error deleting chunks: {e}")


def process_message(es: Elasticsearch, body: bytes):
    """Process a message from RabbitMQ"""
    message = json.loads(body.decode("utf-8"))
    operation = message.get("operation", "upsert")

    if operation == "upsert":
        process_upsert(es, message)
    elif operation == "delete":
        process_delete(es, message)
    else:
        print(f"[consumer] Unknown operation: {operation}")


def main():
    es = connect_elastic()
    connection, channel = connect_rabbitmq()

    def callback(ch, method, properties, body):
        try:
            process_message(es, body)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            print(f"[consumer] Error processing message: {e}")
            import traceback
            traceback.print_exc()
            # Nack with requeue (simple strategy)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    channel.basic_qos(prefetch_count=10)
    channel.basic_consume(queue=QUEUE_NAME, on_message_callback=callback)

    print("[consumer] Waiting for messages. Press Ctrl+C to exit.")
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("[consumer] Stopping...")
    finally:
        connection.close()


if __name__ == "__main__":
  main()
