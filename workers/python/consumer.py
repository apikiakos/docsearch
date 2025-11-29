"""Consumer: Reads messages from RabbitMQ, chunks files, and bulk indexes to Elasticsearch"""
import json
import os
from datetime import datetime

import pika
from elasticsearch import Elasticsearch, helpers

from chunking import chunk_text

RABBITMQ_URL = "amqp://guest:guest@localhost:5672/"
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


def read_file(path: str) -> str:
    """
    Simple version: assume UTF-8 text files for now.
    Later you can branch by extension/mime for PDF, DOCX, etc.
    """
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception as e:
        print(f"[consumer] Error reading file {path}: {e}")
        return ""


def build_index_name(tenant_id: str) -> str:
    return f"docs_{tenant_id}"


def ensure_index(es: Elasticsearch, index_name: str):
    """Ensure Elasticsearch index exists with proper mapping"""
    if not es.indices.exists(index=index_name):
        mapping = {
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
                        "properties": {
                            "filename": {"type": "keyword"},
                            "mime": {"type": "keyword"},
                            "source": {"type": "keyword"},
                            "originalUrl": {"type": "keyword"},
                        },
                    },
                    "created_at": {"type": "date"},
                    "updated_at": {"type": "date"},
                },
            },
        }
        es.indices.create(index=index_name, **mapping)
        print(f"[consumer] Created index: {index_name}")


def process_upsert(es: Elasticsearch, message: dict):
    """Process upsert operation: delete old chunks, index new chunks"""
    import time
    process_start = time.time()
    
    tenant_id = message["tenant_id"]
    document_id = message["document_id"]
    path = message["path"]
    mime = message.get("mime", "application/octet-stream")
    producer_timestamp = message.get("producer_timestamp")
    producer_scan_time = message.get("producer_scan_time", 0)

    print(f"[consumer] Processing UPSERT: {path} (tenant={tenant_id}, doc={document_id})")
    
    # Calculate queue time if producer timestamp is available
    if producer_timestamp:
        from datetime import datetime
        try:
            prod_time = datetime.fromisoformat(producer_timestamp.replace("Z", "+00:00"))
            queue_time = (datetime.now().timestamp() - prod_time.timestamp()) * 1000  # ms
            print(f"[consumer] Queue time: {queue_time:.2f}ms")
        except:
            pass

    text = read_file(path)
    if not text.strip():
        print(f"[consumer] Empty or unreadable file: {path}")
        return

    now = datetime.utcnow().isoformat() + "Z"
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

    # Chunk text with overlap
    chunk_start = time.time()
    chunks = chunk_text(text, chunk_size=400, overlap=100)
    chunk_time = (time.time() - chunk_start) * 1000
    print(f"[consumer] Chunking time: {chunk_time:.2f}ms ({len(chunks)} chunks)")

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
                "title": os.path.basename(path),
                "content": chunk_text_value,
                "metadata": {
                    "filename": os.path.basename(path),
                    "mime": mime,
                    "source": "local_folder",
                    "originalUrl": None,
                },
                "created_at": now,
                "updated_at": now,
            },
        }
        actions.append(action)

    if actions:
        index_start = time.time()
        result = helpers.bulk(es, actions, refresh=True)
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
