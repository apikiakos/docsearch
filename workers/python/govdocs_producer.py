#!/usr/bin/env python3
"""GovDocs Producer: Scans local folder for govdocs tenant"""
import sys
import argparse
from pathlib import Path
from producer import scan_folder, connect_rabbitmq
from manifest import ManifestDB
from fingerprint import compute_file_fingerprint, has_file_changed, make_document_id
from mime_detector import detect_mime_type
from datetime import datetime
import json
import pika

TENANT_ID = "govdocs"
DEFAULT_FOLDER = Path(__file__).parent.parent / "data" / "govdocs-test"
QUEUE_NAME = "doc_ingest"

def check_existing_documents(db, channel, folder: Path):
    """Check existing manifest entries for changes"""
    print(f"[govdocs-producer] Checking existing documents in manifest...")
    
    # Get all manifest entries for this tenant
    manifest_entries = db.get_all_manifest_entries(TENANT_ID)
    
    if not manifest_entries:
        print(f"[govdocs-producer] No manifest entries found")
        return 0, 0
    
    enqueued = 0
    checked = 0
    
    for entry in manifest_entries:
        checked += 1
        # Skip permanently deleted documents
        if entry.get("permanentlyDeleted", False):
            print(f"[govdocs-producer] Skipping permanently deleted document: {entry.get('path', 'N/A')}")
            continue
        
        path_str = entry.get("path")
        if not path_str:
            continue
        
        local_path = Path(path_str)
        if not local_path.exists():
            print(f"[govdocs-producer] File no longer exists: {path_str}, skipping")
            continue
        
        # Check if file changed
        current_mtime, current_size, current_hash = compute_file_fingerprint(local_path)
        manifest_mtime_value = entry.get("lastMtime")
        
        if hasattr(manifest_mtime_value, "timestamp"):
            manifest_mtime = manifest_mtime_value.timestamp()
        elif isinstance(manifest_mtime_value, datetime):
            manifest_mtime = manifest_mtime_value.timestamp()
        else:
            manifest_mtime = float(manifest_mtime_value) if manifest_mtime_value else 0
        
        manifest_size = int(entry.get("sizeBytes") or 0)
        manifest_hash = entry.get("contentHash")
        last_indexed = entry.get("lastIndexedAt")
        
        # Check if document was never indexed (lastIndexedAt is None)
        # This handles cases where the file was enqueued but consumer failed to index it
        if last_indexed is None:
            # Document was never successfully indexed, re-enqueue even if file hasn't changed
            print(f"[govdocs-producer] Document never indexed (lastIndexedAt is None): {path_str}, re-enqueuing...")
            document_id = make_document_id(TENANT_ID, path_str)
            mime = detect_mime_type(local_path)
            mtime_dt = datetime.fromtimestamp(current_mtime)
            
            # Update manifest
            db.update_manifest(
                TENANT_ID,
                path_str,
                mtime_dt,
                current_size,
                content_hash=current_hash
            )
            
            # Enqueue
            message = {
                "operation": "upsert",
                "tenant_id": TENANT_ID,
                "document_id": document_id,
                "path": path_str,
                "mime": mime,
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
                properties=pika.BasicProperties(delivery_mode=2),
            )
            enqueued += 1
            print(f"[govdocs-producer] Re-enqueued unindexed file: {path_str}")
            continue
        
        if has_file_changed(
            current_mtime, current_size, current_hash,
            manifest_mtime, manifest_size, manifest_hash
        ):
            # File changed, re-enqueue
            document_id = make_document_id(TENANT_ID, path_str)
            mime = detect_mime_type(local_path)
            mtime_dt = datetime.fromtimestamp(current_mtime)
            
            # Update manifest
            db.update_manifest(
                TENANT_ID,
                path_str,
                mtime_dt,
                current_size,
                content_hash=current_hash
            )
            
            # Enqueue
            message = {
                "operation": "upsert",
                "tenant_id": TENANT_ID,
                "document_id": document_id,
                "path": path_str,
                "mime": mime,
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
                properties=pika.BasicProperties(delivery_mode=2),
            )
            enqueued += 1
            print(f"[govdocs-producer] Re-enqueued changed file: {path_str}")
    
    print(f"[govdocs-producer] Checked {checked} files, re-enqueued {enqueued} changed files")
    return checked, enqueued


def force_reindex_all_documents(db, channel, folder: Path):
    """Force reindex all existing documents in manifest"""
    manifest_entries = db.get_all_manifest_entries(TENANT_ID)
    reindexed = 0
    
    print(f"[govdocs-producer] Force reindexing {len(manifest_entries)} documents in manifest")
    
    for entry in manifest_entries:
        # Skip permanently deleted documents
        if entry.get("permanentlyDeleted", False):
            print(f"[govdocs-producer] Skipping permanently deleted document: {entry.get('path', 'N/A')}")
            continue
        
        path_str = entry.get("path")
        if not path_str:
            continue
        
        local_path = Path(path_str)
        if not local_path.exists():
            print(f"[govdocs-producer] File no longer exists: {path_str}, skipping")
            continue
        
        # Force re-enqueue
        document_id = make_document_id(TENANT_ID, path_str)
        mime = detect_mime_type(local_path)
        current_mtime, current_size, current_hash = compute_file_fingerprint(local_path)
        mtime_dt = datetime.fromtimestamp(current_mtime)
        
        # Update manifest
        db.update_manifest(
            TENANT_ID,
            path_str,
            mtime_dt,
            current_size,
            content_hash=current_hash
        )
        
        # Enqueue
        message = {
            "operation": "upsert",
            "tenant_id": TENANT_ID,
            "document_id": document_id,
            "path": path_str,
            "mime": mime,
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
            properties=pika.BasicProperties(delivery_mode=2),
        )
        reindexed += 1
        print(f"[govdocs-producer] Force re-enqueued: {path_str}")
    
    print(f"[govdocs-producer] Force reindexed {reindexed} documents")
    return len(manifest_entries), reindexed


def reindex_single_document(db, channel, document_path: str):
    """Reindex a single document by path"""
    path_str = document_path
    local_path = Path(path_str)
    
    if not local_path.exists():
        print(f"[govdocs-producer] File not found: {path_str}")
        return False
    
    # Check if document is in manifest
    manifest = db.get_manifest(TENANT_ID, path_str)
    if manifest and manifest.get("permanentlyDeleted", False):
        print(f"[govdocs-producer] Document is permanently deleted, cannot reindex: {path_str}")
        return False
    
    # Re-enqueue
    document_id = make_document_id(TENANT_ID, path_str)
    mime = detect_mime_type(local_path)
    current_mtime, current_size, current_hash = compute_file_fingerprint(local_path)
    mtime_dt = datetime.fromtimestamp(current_mtime)
    
    # Update manifest
    db.update_manifest(
        TENANT_ID,
        path_str,
        mtime_dt,
        current_size,
        content_hash=current_hash
    )
    
    # Enqueue
    message = {
        "operation": "upsert",
        "tenant_id": TENANT_ID,
        "document_id": document_id,
        "path": path_str,
        "mime": mime,
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
        properties=pika.BasicProperties(delivery_mode=2),
    )
    print(f"[govdocs-producer] Re-enqueued single document: {path_str}")
    return True


def main():
    parser = argparse.ArgumentParser(description="GovDocs Producer")
    parser.add_argument("folder", nargs="?", type=str, help="Folder path to scan (default: data/govdocs-test)")
    parser.add_argument("--check-existing", action="store_true", help="Check existing manifest entries for changes")
    parser.add_argument("--force-reindex", action="store_true", help="Force reindex all existing documents in manifest")
    parser.add_argument("--reindex-document", type=str, help="Reindex a specific document by path")
    parser.add_argument("--fetch-new", type=int, help="Number of new documents to process (not applicable for local folders, scans all)")
    
    args = parser.parse_args()
    
    # Determine folder
    if args.folder:
        folder = Path(args.folder).expanduser().resolve()
    else:
        folder = DEFAULT_FOLDER
    
    if not folder.exists() or not folder.is_dir():
        print(f"Error: Folder {folder} does not exist or is not a directory")
        sys.exit(1)
    
    # Default behavior: if no flags, check existing only
    if not args.check_existing and not args.force_reindex and not args.reindex_document and not args.fetch_new:
        args.check_existing = True
    
    # Confirmation prompt when run manually (not via FastAPI)
    if sys.stdin.isatty():
        print("\n" + "="*70)
        print(f"GovDocs Producer - Tenant: {TENANT_ID}")
        print(f"Folder: {folder}")
        print("="*70)
        if args.check_existing:
            print("✓ Will check existing documents in manifest for changes")
        if args.force_reindex:
            print("⚠ Will FORCE REINDEX all existing documents in manifest")
            print("  WARNING: This can be time-consuming and resource-intensive!")
        if args.reindex_document:
            print(f"✓ Will reindex single document: {args.reindex_document}")
        if args.fetch_new:
            print(f"✓ Will scan folder for new documents (limit: {args.fetch_new})")
            print("  (Already-indexed documents will be automatically skipped)")
        print("="*70)
        response = input("\nProceed? (y/N): ")
        if response.lower() != 'y':
            print("Cancelled.")
            sys.exit(0)
        print()
    
    print(f"[govdocs-producer] Folder: {folder}")
    print(f"[govdocs-producer] Tenant: {TENANT_ID}")
    
    # Initialize database and RabbitMQ
    db = ManifestDB()
    connection, channel = connect_rabbitmq()
    
    try:
        total_checked = 0
        total_enqueued = 0
        
        # Reindex single document
        if args.reindex_document:
            print(f"\n[govdocs-producer] Reindexing single document: {args.reindex_document}")
            success = reindex_single_document(db, channel, args.reindex_document)
            if success:
                total_enqueued += 1
        # Force reindex all existing documents
        elif args.force_reindex:
            print(f"\n[govdocs-producer] Force reindexing all existing documents for tenant '{TENANT_ID}'...")
            checked, enqueued = force_reindex_all_documents(db, channel, folder)
            total_checked += checked
            total_enqueued += enqueued
        # Check existing documents
        elif args.check_existing:
            print(f"\n[govdocs-producer] Checking existing documents for tenant '{TENANT_ID}'...")
            checked, enqueued = check_existing_documents(db, channel, folder)
            total_checked += checked
            total_enqueued += enqueued
        
        # Scan folder for new documents
        # Note: scan_folder already handles checking for changes, so this will process new files
        # The max_docs limit would need to be added to scan_folder if we want to limit new files
        if args.fetch_new:
            print(f"\n[govdocs-producer] Scanning folder for new documents (limit: {args.fetch_new})...")
            # scan_folder doesn't support max_docs yet, so we'll scan all
            # In a production system, you'd want to add this limit
            scan_folder(folder, TENANT_ID, db, channel)
        
        print(f"\n[govdocs-producer] ===== SUMMARY =====")
        print(f"[govdocs-producer] Checked existing: {total_checked} files")
        print(f"[govdocs-producer] Total enqueued: {total_enqueued} documents")
        print(f"[govdocs-producer] ====================")
    finally:
        connection.close()

if __name__ == "__main__":
    main()

