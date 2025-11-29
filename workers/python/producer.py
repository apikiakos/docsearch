"""Producer: Scans folder for documents, detects changes, and sends to RabbitMQ"""
import json
import sys
from pathlib import Path
from datetime import datetime
import pika

from manifest import ManifestDB
from fingerprint import make_document_id, compute_file_fingerprint, has_file_changed

RABBITMQ_URL = "amqp://guest:guest@localhost:5672/"
QUEUE_NAME = "doc_ingest"


def connect_rabbitmq():
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    return connection, channel


def discover_files(root: Path):
    """Yield all files under root (recursive)."""
    for path in root.rglob("*"):
        if path.is_file():
            yield path


def get_mime_type(file_path: Path) -> str:
    """Simple MIME type detection from extension."""
    ext = file_path.suffix.lower()
    mime_map = {
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".html": "text/html",
        ".htm": "text/html",
        ".csv": "text/csv",
    }
    return mime_map.get(ext, "application/octet-stream")


def scan_folder(root: Path, tenant_id: str, db: ManifestDB, channel):
    """
    Scan folder, compare with manifest, and enqueue changes.
    """
    import time
    scan_start = time.time()
    seen_paths = set()
    upserted = 0
    skipped = 0
    deleted = 0

    # Scan all files
    for file_path in discover_files(root):
        path_str = str(file_path)
        seen_paths.add(path_str)

        try:
            # Compute current fingerprint
            mtime, size_bytes, content_hash = compute_file_fingerprint(file_path)
            mtime_dt = datetime.fromtimestamp(mtime)

            # Get existing manifest entry
            manifest = db.get_manifest(tenant_id, path_str)

            if manifest is None:
                # New file
                document_id = make_document_id(tenant_id, path_str)
                mime = get_mime_type(file_path)

                # Insert into manifest
                db.insert_manifest(
                    tenant_id, path_str, document_id, mtime_dt, size_bytes, content_hash
                )

                # Enqueue upsert job
                message = {
                    "operation": "upsert",
                    "tenant_id": tenant_id,
                    "document_id": document_id,
                    "path": path_str,
                    "mime": mime,
                }

                channel.basic_publish(
                    exchange="",
                    routing_key=QUEUE_NAME,
                    body=json.dumps(message).encode("utf-8"),
                    properties=pika.BasicProperties(delivery_mode=2),
                )

                upserted += 1
                print(f"[producer] Enqueued NEW: {file_path}")

            else:
                # Existing file - check if changed
                # Handle datetime object from database (Prisma uses camelCase)
                manifest_mtime_value = manifest.get("lastMtime") or manifest.get("last_mtime")
                if hasattr(manifest_mtime_value, "timestamp"):
                    manifest_mtime = manifest_mtime_value.timestamp()
                elif isinstance(manifest_mtime_value, datetime):
                    manifest_mtime = manifest_mtime_value.timestamp()
                else:
                    manifest_mtime = float(manifest_mtime_value) if manifest_mtime_value else 0
                
                manifest_size = int(manifest.get("sizeBytes") or manifest.get("size_bytes") or 0)
                manifest_hash = manifest.get("contentHash") or manifest.get("content_hash")

                if has_file_changed(
                    mtime, size_bytes, content_hash,
                    manifest_mtime, manifest_size, manifest_hash
                ):
                    # File changed - reindex
                    document_id = manifest.get("documentId") or manifest.get("document_id")
                    mime = get_mime_type(file_path)

                    # Update manifest
                    db.update_manifest(
                        tenant_id, path_str, mtime_dt, size_bytes, content_hash
                    )

                    # Enqueue upsert job with timing
                    enqueue_start = time.time()
                    message = {
                        "operation": "upsert",
                        "tenant_id": tenant_id,
                        "document_id": document_id,
                        "path": path_str,
                        "mime": mime,
                        "producer_scan_time": enqueue_start - scan_start,
                        "producer_timestamp": datetime.now(timezone.utc).isoformat(),
                    }

                    channel.basic_publish(
                        exchange="",
                        routing_key=QUEUE_NAME,
                        body=json.dumps(message).encode("utf-8"),
                        properties=pika.BasicProperties(delivery_mode=2),
                    )

                    upserted += 1
                    print(f"[producer] Enqueued UPDATED: {file_path}")
                else:
                    # No change
                    skipped += 1

        except Exception as e:
            print(f"[producer] Error processing {file_path}: {e}")
            continue

    # Detect deletions: files in manifest but not on disk
    all_manifest = db.list_manifest_for_tenant(tenant_id, include_deleted=False)
    for manifest_row in all_manifest:
        path_str = manifest_row["path"]
        if path_str not in seen_paths:
            # File deleted
            document_id = manifest_row.get("documentId") or manifest_row.get("document_id")

            # Mark as deleted in manifest
            db.mark_deleted(tenant_id, path_str)

            # Enqueue delete job with timing
            message = {
                "operation": "delete",
                "tenant_id": tenant_id,
                "document_id": document_id,
                "path": path_str,
                "producer_scan_time": time.time() - scan_start,
                "producer_timestamp": datetime.now(timezone.utc).isoformat(),
            }

            channel.basic_publish(
                exchange="",
                routing_key=QUEUE_NAME,
                body=json.dumps(message).encode("utf-8"),
                properties=pika.BasicProperties(delivery_mode=2),
            )

            deleted += 1
            print(f"[producer] Enqueued DELETED: {path_str}")

    scan_total_time = time.time() - scan_start
    print(f"[producer] Scan complete: {upserted} upserted, {skipped} skipped, {deleted} deleted")
    print(f"[producer] Total scan time: {scan_total_time:.3f}s")


def main():
    if len(sys.argv) < 3:
        print("Usage: producer.py <folder_path> <tenant_id>")
        sys.exit(1)

    folder = Path(sys.argv[1]).expanduser().resolve()
    tenant_id = sys.argv[2]

    if not folder.exists() or not folder.is_dir():
        print(f"Folder {folder} does not exist or is not a directory")
        sys.exit(1)

    # Initialize database and RabbitMQ
    db = ManifestDB()
    connection, channel = connect_rabbitmq()

    try:
        scan_folder(folder, tenant_id, db, channel)
    finally:
        connection.close()


if __name__ == "__main__":
    main()
