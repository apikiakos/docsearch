"""S3 Producer: Discovers documents from S3 for s3-tenant-1 or s3-tenant-2, downloads them locally, and enqueues for processing"""
import json
import os
import sys
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List
import boto3
from botocore.exceptions import ClientError
import pika

from manifest import ManifestDB
from fingerprint import make_document_id, compute_file_fingerprint, has_file_changed
from mime_detector import detect_mime_type

# Load environment variables from root .env file
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
QUEUE_NAME = "doc_ingest"
BUCKET_NAME = os.environ.get("AWS_S3_BUCKET", "document-search-tenants")
AWS_REGION = os.environ.get("AWS_DEFAULT_REGION", "eu-west-1")
DATA_DIR = Path(__file__).parent.parent / "data" / "s3_downloads"


def connect_rabbitmq():
    """Connect to RabbitMQ"""
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    return connection, channel


def connect_s3():
    """Connect to S3"""
    aws_access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    
    if not aws_access_key or not aws_secret_key:
        raise ValueError("AWS credentials not found in environment")
    
    return boto3.client(
        's3',
        region_name=AWS_REGION,
        aws_access_key_id=aws_access_key,
        aws_secret_access_key=aws_secret_key
    )


def list_s3_objects(s3_client, bucket: str, prefix: str) -> List[dict]:
    """List all objects in S3 with given prefix"""
    objects = []
    paginator = s3_client.get_paginator('list_objects_v2')
    
    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            if 'Contents' in page:
                for obj in page['Contents']:
                    # Skip .keep files
                    if not obj['Key'].endswith('.keep'):
                        objects.append({
                            'Key': obj['Key'],
                            'Size': obj['Size'],
                            'LastModified': obj['LastModified'],
                            'ETag': obj.get('ETag', '').strip('"'),
                        })
    except ClientError as e:
        print(f"[s3_producer] Error listing objects: {e}")
        return []
    
    return objects


def download_s3_object(s3_client, bucket: str, key: str, local_path: Path) -> bool:
    """Download S3 object to local file"""
    try:
        s3_client.download_file(bucket, key, str(local_path))
        return True
    except ClientError as e:
        print(f"[s3_producer] Error downloading {key}: {e}")
        return False


def discover_and_store_s3_document(
    s3_obj: dict,
    tenant_id: str,
    db: ManifestDB,
    channel,
    s3_client,
    fetch_new_only: bool = False
) -> bool:
    """
    Discover a single S3 document, download and store it locally if changed,
    then enqueue the local file path for processing.
    
    Producer responsibilities:
    1. Discover documents (check ETag/Last-Modified from S3)
    2. Fetch the raw bytes and store them in YOUR storage (local cache)
    3. Tell the consumer where the file is (enqueue local path)
    
    Returns True if document was enqueued, False if skipped.
    """
    discovery_start = time.time()
    
    s3_key = s3_obj['Key']
    s3_etag = s3_obj['ETag']
    s3_last_modified = s3_obj['LastModified']
    s3_size = s3_obj['Size']
    
    # Ensure tenant-specific directory exists
    tenant_data_dir = DATA_DIR / tenant_id
    tenant_data_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate local filename from S3 key (preserve structure)
    # s3-tenant-1/books/file.txt -> books_file.txt (or similar)
    key_parts = s3_key.split('/')
    if len(key_parts) > 1:
        # Use folder and filename
        local_filename = '_'.join(key_parts[1:])  # Skip tenant prefix
    else:
        local_filename = key_parts[-1]
    
    local_path = tenant_data_dir / local_filename
    local_path_str = str(local_path)
    
    # Get existing manifest entry (using S3 key as the path identifier)
    manifest_entry = db.get_manifest(tenant_id, s3_key)
    stored_etag = manifest_entry.get("etag") if manifest_entry else None
    
    # If fetch_new_only is True, skip documents that already exist in manifest
    if fetch_new_only and manifest_entry:
        print(f"[s3_producer] Document already indexed: {s3_key} - skipping (fetch-new mode)")
        return False
    
    # Check if we need to download (new or changed)
    should_download = False
    
    if not manifest_entry:
        # New document
        should_download = True
        print(f"[s3_producer] New document detected: {s3_key}")
    elif stored_etag != s3_etag:
        # Document changed (ETag mismatch)
        should_download = True
        print(f"[s3_producer] Document changed (ETag): {s3_key}")
    elif not local_path.exists():
        # File missing from local cache
        should_download = True
        print(f"[s3_producer] File missing from cache: {s3_key}")
    else:
        # Check local file fingerprint to be sure
        current_mtime, current_size, current_hash = compute_file_fingerprint(local_path)
        manifest_mtime_value = manifest_entry.get("lastMtime")
        if hasattr(manifest_mtime_value, "timestamp"):
            manifest_mtime = manifest_mtime_value.timestamp()
        elif isinstance(manifest_mtime_value, datetime):
            manifest_mtime = manifest_mtime_value.timestamp()
        else:
            manifest_mtime = float(manifest_mtime_value) if manifest_mtime_value else 0
        
        manifest_size = int(manifest_entry.get("sizeBytes") or 0)
        manifest_hash = manifest_entry.get("contentHash")
        
        if has_file_changed(
            current_mtime, current_size, current_hash,
            manifest_mtime, manifest_size, manifest_hash
        ):
            should_download = True
            print(f"[s3_producer] Local file changed: {s3_key}")
        else:
            # File unchanged - skip download and reindexing
            print(f"[s3_producer] Document unchanged: {s3_key} - skipping")
            # Update manifest's lastIndexedAt even if unchanged
            db.update_manifest(
                tenant_id,
                s3_key,
                datetime.fromtimestamp(s3_last_modified.timestamp(), tz=timezone.utc),
                s3_size,
                content_hash=manifest_entry.get("contentHash"),
                etag=s3_etag
            )
            return False
    
    if should_download:
        # Download from S3
        print(f"[s3_producer] Downloading {s3_key} from S3...")
        if not download_s3_object(s3_client, BUCKET_NAME, s3_key, local_path):
            return False
        
        # Compute fingerprint of downloaded local file
        mtime, size_bytes, content_hash = compute_file_fingerprint(local_path)
        mtime_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        
        # Generate stable document ID (based on tenant and S3 key)
        document_id = make_document_id(tenant_id, f"s3://{BUCKET_NAME}/{s3_key}")
        
        # Detect MIME type from the downloaded local file
        mime = detect_mime_type(local_path)
        
        # Update manifest with S3 ETag and local file fingerprint
        if manifest_entry:
            db.update_manifest(
                tenant_id,
                s3_key,
                mtime_dt,
                size_bytes,
                content_hash=content_hash,
                etag=s3_etag
            )
        else:
            db.insert_manifest(
                tenant_id,
                s3_key,
                document_id,
                mtime_dt,
                size_bytes,
                content_hash=content_hash,
                etag=s3_etag
            )
        
        # Enqueue LOCAL FILE PATH (not S3 key) - consumer processes local files only
        key_parts = s3_key.split('/')
        folder = key_parts[1] if len(key_parts) > 1 else "unknown"
        filename = key_parts[-1] if key_parts else s3_key
        
        # Construct S3 URL for originalUrl
        s3_url = f"s3://{BUCKET_NAME}/{s3_key}"
        
        # Build metadata according to new generic model
        message = {
            "operation": "upsert",
            "tenant_id": tenant_id,
            "document_id": document_id,
            "path": local_path_str,  # Local file path, not S3 key
            "mime": mime,
            "metadata": {
                "filename": filename,
                "mime": mime,
                "source": "s3",
                "source_url": s3_url,  # S3 URL as source_url
                "type": "document",
                "originalUrl": s3_url,  # S3 URL for reference
                "extras": {
                    "s3_bucket": BUCKET_NAME,
                    "s3_key": s3_key,
                    "s3_etag": s3_etag,
                    "s3_last_modified": s3_last_modified.isoformat(),
                    "folder": folder,
                },
            },
            "producer_scan_time": time.time() - discovery_start,
            "producer_timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        body = json.dumps(message).encode("utf-8")
        channel.basic_publish(
            exchange="",
            routing_key=QUEUE_NAME,
            body=body,
            properties=pika.BasicProperties(delivery_mode=2),
        )
        
        print(f"[s3_producer] Downloaded and enqueued: {s3_key} -> {local_path_str}")
        return True
    
    return False


def check_existing_documents(tenant_id: str, db: ManifestDB, channel, s3_client):
    """Check existing manifest entries for changes"""
    print(f"[s3_producer] Checking existing documents in manifest for tenant '{tenant_id}'...")
    
    # Get all manifest entries for this tenant
    manifest_entries = db.get_all_manifest_entries(tenant_id)
    
    if not manifest_entries:
        print(f"[s3_producer] No manifest entries found for tenant '{tenant_id}'")
        return 0, 0
    
    enqueued = 0
    checked = 0
    
    for entry in manifest_entries:
        checked += 1
        # Skip permanently deleted documents
        if entry.get("permanentlyDeleted", False):
            print(f"[s3_producer] Skipping permanently deleted document: {entry.get('path', 'N/A')}")
            continue
        
        s3_key = entry.get("path")  # For S3, path is the S3 key
        if not s3_key:
            continue
        
        # Check if object still exists in S3
        try:
            s3_obj = s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            s3_etag = s3_obj.get('ETag', '').strip('"')
            s3_last_modified = s3_obj.get('LastModified')
            s3_size = s3_obj.get('ContentLength', 0)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                print(f"[s3_producer] Object no longer exists in S3: {s3_key}, skipping")
                continue
            else:
                print(f"[s3_producer] Error checking S3 object {s3_key}: {e}, skipping")
                continue
        
        # Get local file path
        tenant_data_dir = DATA_DIR / tenant_id
        key_parts = s3_key.split('/')
        if len(key_parts) > 1:
            local_filename = '_'.join(key_parts[1:])
        else:
            local_filename = key_parts[-1]
        local_path = tenant_data_dir / local_filename
        
        if not local_path.exists():
            # File missing from local cache, re-download
            print(f"[s3_producer] File missing from cache: {s3_key}, re-downloading...")
            s3_obj_dict = {
                'Key': s3_key,
                'ETag': s3_etag,
                'LastModified': s3_last_modified,
                'Size': s3_size,
            }
            if discover_and_store_s3_document(s3_obj_dict, tenant_id, db, channel, s3_client):
                enqueued += 1
            continue
        
        # Check if file changed
        stored_etag = entry.get("etag")
        if stored_etag != s3_etag:
            # ETag changed, re-download and re-enqueue
            print(f"[s3_producer] Document changed (ETag): {s3_key}, re-downloading...")
            s3_obj_dict = {
                'Key': s3_key,
                'ETag': s3_etag,
                'LastModified': s3_last_modified,
                'Size': s3_size,
            }
            if discover_and_store_s3_document(s3_obj_dict, tenant_id, db, channel, s3_client):
                enqueued += 1
            continue
        
        # Check if document was never indexed (lastIndexedAt is None)
        # This handles cases where the file was enqueued but consumer failed to index it
        last_indexed = entry.get("lastIndexedAt")
        if last_indexed is None:
            # Document was never successfully indexed, re-enqueue even if file hasn't changed
            print(f"[s3_producer] Document never indexed (lastIndexedAt is None): {s3_key}, re-enqueuing...")
            s3_obj_dict = {
                'Key': s3_key,
                'ETag': s3_etag,
                'LastModified': s3_last_modified,
                'Size': s3_size,
            }
            if discover_and_store_s3_document(s3_obj_dict, tenant_id, db, channel, s3_client):
                enqueued += 1
            continue
        
        # Check local file fingerprint
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
        
        if has_file_changed(
            current_mtime, current_size, current_hash,
            manifest_mtime, manifest_size, manifest_hash
        ):
            # File changed, re-download and re-enqueue
            print(f"[s3_producer] Local file changed: {s3_key}, re-downloading...")
            s3_obj_dict = {
                'Key': s3_key,
                'ETag': s3_etag,
                'LastModified': s3_last_modified,
                'Size': s3_size,
            }
            if discover_and_store_s3_document(s3_obj_dict, tenant_id, db, channel, s3_client):
                enqueued += 1
    
    print(f"[s3_producer] Checked {checked} files, re-enqueued {enqueued} changed files")
    return checked, enqueued


def force_reindex_all_documents(tenant_id: str, db: ManifestDB, channel, s3_client):
    """Force reindex all existing documents in manifest"""
    manifest_entries = db.get_all_manifest_entries(tenant_id)
    reindexed = 0
    
    print(f"[s3_producer] Force reindexing {len(manifest_entries)} documents in manifest for tenant '{tenant_id}'")
    
    for entry in manifest_entries:
        # Skip permanently deleted documents
        if entry.get("permanentlyDeleted", False):
            print(f"[s3_producer] Skipping permanently deleted document: {entry.get('path', 'N/A')}")
            continue
        
        s3_key = entry.get("path")
        if not s3_key:
            continue
        
        # Check if object still exists in S3
        try:
            s3_obj = s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
            s3_etag = s3_obj.get('ETag', '').strip('"')
            s3_last_modified = s3_obj.get('LastModified')
            s3_size = s3_obj.get('ContentLength', 0)
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                print(f"[s3_producer] Object no longer exists in S3: {s3_key}, skipping")
                continue
            else:
                print(f"[s3_producer] Error checking S3 object {s3_key}: {e}, skipping")
                continue
        
        # Force re-download and re-enqueue
        s3_obj_dict = {
            'Key': s3_key,
            'ETag': s3_etag,
            'LastModified': s3_last_modified,
            'Size': s3_size,
        }
        if discover_and_store_s3_document(s3_obj_dict, tenant_id, db, channel, s3_client):
            reindexed += 1
            print(f"[s3_producer] Force re-enqueued: {s3_key}")
    
    print(f"[s3_producer] Force reindexed {reindexed} documents")
    return len(manifest_entries), reindexed


def reindex_single_document(tenant_id: str, db: ManifestDB, channel, s3_client, document_path: str):
    """Reindex a single document by S3 key"""
    s3_key = document_path
    
    # Check if document is in manifest
    manifest = db.get_manifest(tenant_id, s3_key)
    if manifest and manifest.get("permanentlyDeleted", False):
        print(f"[s3_producer] Document is permanently deleted, cannot reindex: {s3_key}")
        return False
    
    # Check if object exists in S3
    try:
        s3_obj = s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
        s3_etag = s3_obj.get('ETag', '').strip('"')
        s3_last_modified = s3_obj.get('LastModified')
        s3_size = s3_obj.get('ContentLength', 0)
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            print(f"[s3_producer] Object not found in S3: {s3_key}")
            return False
        else:
            print(f"[s3_producer] Error checking S3 object {s3_key}: {e}")
            return False
    
    # Re-download and re-enqueue
    s3_obj_dict = {
        'Key': s3_key,
        'ETag': s3_etag,
        'LastModified': s3_last_modified,
        'Size': s3_size,
    }
    if discover_and_store_s3_document(s3_obj_dict, tenant_id, db, channel, s3_client):
        print(f"[s3_producer] Re-enqueued single document: {s3_key}")
        return True
    return False


def fetch_new_documents(tenant_id: str, db: ManifestDB, channel, s3_client, max_docs: int):
    """Fetch new documents from S3"""
    print(f"[s3_producer] Fetching up to {max_docs} new documents from S3 for tenant '{tenant_id}'...")
    
    scan_start = time.time()
    enqueued = 0
    skipped = 0
    errors = 0
    
    # List all objects for this tenant (both main folder and uploads folder)
    all_s3_objects = []
    
    # Scan main tenant folder (e.g., s3-tenant-1/books/file.txt)
    print(f"[s3_producer] Scanning main folder: {tenant_id}/")
    main_objects = list_s3_objects(s3_client, BUCKET_NAME, f"{tenant_id}/")
    all_s3_objects.extend(main_objects)
    
    # Scan uploads folder (e.g., uploads/s3-tenant-1/file.txt)
    print(f"[s3_producer] Scanning uploads folder: uploads/{tenant_id}/")
    uploads_objects = list_s3_objects(s3_client, BUCKET_NAME, f"uploads/{tenant_id}/")
    all_s3_objects.extend(uploads_objects)
    
    s3_objects = all_s3_objects
    
    if not s3_objects:
        print(f"[s3_producer] No objects found for tenant '{tenant_id}'")
        return 0, 0, 0
    
    print(f"[s3_producer] Found {len(s3_objects)} objects in S3")
    print(f"[s3_producer] Will process up to {max_docs} NEW documents (already-indexed documents will be skipped)")
    
    processed = 0
    for s3_obj in s3_objects:
        # Check limit - we want max_docs NEW documents, so continue until we've enqueued that many
        if enqueued >= max_docs:
            print(f"[s3_producer] Reached limit of {max_docs} new documents enqueued, stopping")
            break
        processed += 1
        try:
            if discover_and_store_s3_document(s3_obj, tenant_id, db, channel, s3_client, fetch_new_only=True):
                enqueued += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"[s3_producer] Error processing {s3_obj['Key']}: {e}")
            errors += 1
    
    print(f"[s3_producer] Processed {processed} objects from S3")
    
    scan_total_time = time.time() - scan_start
    print(f"[s3_producer] Scan complete: {enqueued} enqueued, {skipped} skipped, {errors} errors")
    print(f"[s3_producer] Total scan time: {scan_total_time:.3f}s")
    return enqueued, skipped, errors


def main():
    parser = argparse.ArgumentParser(description="S3 Producer")
    parser.add_argument("tenant", nargs="?", help="Tenant ID (e.g., s3-tenant-1, s3-tenant-2)")
    parser.add_argument("--check-existing", action="store_true", help="Check existing manifest entries for changes")
    parser.add_argument("--force-reindex", action="store_true", help="Force reindex all existing documents in manifest")
    parser.add_argument("--reindex-document", type=str, help="Reindex a specific document by S3 key")
    parser.add_argument("--fetch-new", type=int, help="Number of new documents to fetch")
    
    # Legacy support: if first arg is tenant and second is a number, treat it as fetch-new
    args = parser.parse_args()
    
    # Handle legacy format: python s3_producer.py s3-tenant-1 20
    if len(sys.argv) >= 3 and sys.argv[2].isdigit() and not args.fetch_new:
        args.fetch_new = int(sys.argv[2])
    
    # For reindex-document, tenant can be optional (extracted from path)
    if args.reindex_document:
        # Extract tenant from S3 key if not provided
        if not args.tenant:
            key_parts = args.reindex_document.split('/')
            if key_parts[0] in ["s3-tenant-1", "s3-tenant-2"]:
                tenant_id = key_parts[0]
            elif len(key_parts) > 1 and key_parts[0] == "uploads" and key_parts[1] in ["s3-tenant-1", "s3-tenant-2"]:
                tenant_id = key_parts[1]
            else:
                print(f"Error: Cannot determine tenant from path '{args.reindex_document}'. Please provide tenant.")
                sys.exit(1)
        else:
            tenant_id = args.tenant
    else:
        if not args.tenant:
            print("Error: tenant is required (unless using --reindex-document)")
            sys.exit(1)
        tenant_id = args.tenant
    
    # Validate tenant ID
    if tenant_id not in ["s3-tenant-1", "s3-tenant-2"]:
        print(f"Warning: Unknown tenant '{tenant_id}'. Expected: s3-tenant-1 or s3-tenant-2")
        # In non-interactive mode (FastAPI), just continue
        if sys.stdin.isatty():
            response = input("Continue anyway? (y/N): ")
            if response.lower() != 'y':
                sys.exit(1)
    
    # Default behavior: if no flags, check existing only
    if not args.check_existing and not args.force_reindex and not args.reindex_document and not args.fetch_new:
        args.check_existing = True
    
    # Confirmation prompt when run manually (not via FastAPI)
    if sys.stdin.isatty():
        print("\n" + "="*70)
        print(f"S3 Producer - Tenant: {tenant_id}")
        print("="*70)
        if args.check_existing:
            print("✓ Will check existing documents in manifest for changes")
        if args.force_reindex:
            print("⚠ Will FORCE REINDEX all existing documents in manifest")
            print("  WARNING: This can be time-consuming and resource-intensive!")
        if args.reindex_document:
            print(f"✓ Will reindex single document: {args.reindex_document}")
        if args.fetch_new:
            print(f"✓ Will fetch up to {args.fetch_new} NEW documents from S3")
            print("  (Already-indexed documents will be automatically skipped)")
        print("="*70)
        response = input("\nProceed? (y/N): ")
        if response.lower() != 'y':
            print("Cancelled.")
            sys.exit(0)
        print()
    
    # Initialize database, RabbitMQ, and S3
    try:
        db = ManifestDB()
        connection, channel = connect_rabbitmq()
        s3_client = connect_s3()
        
        # Verify bucket exists
        try:
            s3_client.head_bucket(Bucket=BUCKET_NAME)
            print(f"[s3_producer] ✓ Connected to S3 bucket: {BUCKET_NAME}")
        except ClientError as e:
            print(f"[s3_producer] Error accessing bucket '{BUCKET_NAME}': {e}")
            sys.exit(1)
        
        try:
            total_checked = 0
            total_enqueued = 0
            
            # Reindex single document
            if args.reindex_document:
                print(f"\n[s3_producer] Reindexing single document: {args.reindex_document}")
                success = reindex_single_document(tenant_id, db, channel, s3_client, args.reindex_document)
                if success:
                    total_enqueued += 1
            # Force reindex all existing documents
            elif args.force_reindex:
                print(f"\n[s3_producer] Force reindexing all existing documents for tenant '{tenant_id}'...")
                checked, enqueued = force_reindex_all_documents(tenant_id, db, channel, s3_client)
                total_checked += checked
                total_enqueued += enqueued
            # Check existing documents
            elif args.check_existing:
                print(f"\n[s3_producer] Checking existing documents for tenant '{tenant_id}'...")
                checked, enqueued = check_existing_documents(tenant_id, db, channel, s3_client)
                total_checked += checked
                total_enqueued += enqueued
            
            # Fetch new documents
            if args.fetch_new:
                print(f"\n[s3_producer] Fetching new documents for tenant '{tenant_id}'...")
                enqueued, skipped, errors = fetch_new_documents(tenant_id, db, channel, s3_client, args.fetch_new)
                total_enqueued += enqueued
            
            print(f"\n[s3_producer] ===== SUMMARY =====")
            print(f"[s3_producer] Checked existing: {total_checked} files")
            print(f"[s3_producer] Total enqueued: {total_enqueued} documents")
            print(f"[s3_producer] ====================")
        finally:
            connection.close()
            
    except Exception as e:
        print(f"[s3_producer] Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

