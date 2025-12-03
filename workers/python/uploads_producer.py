"""Uploads Producer: Scans all uploads/{tenant}/ folders in S3, detects new documents, and enqueues for processing"""
import json
import os
import sys
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional
import boto3
from botocore.exceptions import ClientError
import pika

from manifest import ManifestDB
from fingerprint import make_document_id
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
UPLOADS_PREFIX = "uploads/"


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


def list_tenant_folders(s3_client, bucket: str) -> List[str]:
    """List all tenant folders in uploads/ prefix"""
    tenants = []
    paginator = s3_client.get_paginator('list_objects_v2')
    
    try:
        for page in paginator.paginate(Bucket=bucket, Prefix=UPLOADS_PREFIX, Delimiter='/'):
            # CommonPrefixes contains folder names
            if 'CommonPrefixes' in page:
                for prefix_info in page['CommonPrefixes']:
                    prefix = prefix_info['Prefix']
                    # Extract tenant name from uploads/{tenant}/
                    if prefix.startswith(UPLOADS_PREFIX) and prefix != UPLOADS_PREFIX:
                        tenant = prefix[len(UPLOADS_PREFIX):].rstrip('/')
                        if tenant:
                            tenants.append(tenant)
    except ClientError as e:
        print(f"[uploads_producer] Error listing tenant folders: {e}")
        return []
    
    return tenants


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
        print(f"[uploads_producer] Error listing objects: {e}")
        return []
    
    return objects


def download_s3_object(s3_client, bucket: str, key: str, local_path: Path) -> bool:
    """Download S3 object to local file"""
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        s3_client.download_file(bucket, key, str(local_path))
        return True
    except ClientError as e:
        print(f"[uploads_producer] Error downloading {key}: {e}")
        return False


def process_uploaded_document(
    s3_obj: dict,
    tenant_id: str,
    db: ManifestDB,
    channel,
    s3_client
) -> bool:
    """
    Process a single uploaded document: check manifest, download if new, enqueue.
    
    Returns True if document was enqueued, False if skipped.
    """
    discovery_start = time.time()
    s3_key = s3_obj['Key']
    s3_size = s3_obj['Size']
    s3_etag = s3_obj['ETag']
    s3_last_modified = s3_obj['LastModified']
    
    # Generate stable document ID from tenant + S3 key
    document_id = make_document_id(tenant_id, s3_key)
    
    # Check manifest
    manifest_entry = db.get_manifest(tenant_id, s3_key)
    
    # Skip if already indexed and ETag matches (no change)
    if manifest_entry and manifest_entry.get('etag') == s3_etag:
        print(f"[uploads_producer] Skipping unchanged: {s3_key} (ETag match)")
        return False
    
    # Download to local cache
    local_path = DATA_DIR / tenant_id / Path(s3_key).name
    if not download_s3_object(s3_client, BUCKET_NAME, s3_key, local_path):
        return False
    
    local_path_str = str(local_path)
    
    # Detect MIME type
    mime = detect_mime_type(local_path)
    
    # Update manifest
    mtime_dt = s3_last_modified.replace(tzinfo=timezone.utc)
    
    if manifest_entry:
        db.update_manifest(
            tenant_id,
            s3_key,
            mtime_dt,
            s3_size,
            etag=s3_etag
        )
    else:
        db.insert_manifest(
            tenant_id,
            s3_key,
            document_id,
            mtime_dt,
            s3_size,
            etag=s3_etag
        )
    
    # Enqueue for processing
    filename = Path(s3_key).name
    s3_url = f"s3://{BUCKET_NAME}/{s3_key}"
    
    message = {
        "operation": "upsert",
        "tenant_id": tenant_id,
        "document_id": document_id,
        "path": local_path_str,
        "mime": mime,
        "metadata": {
            "filename": filename,
            "mime": mime,
            "source": "s3_upload",
            "source_url": s3_url,
            "type": "document",
            "originalUrl": s3_url,
            "extras": {
                "s3_bucket": BUCKET_NAME,
                "s3_key": s3_key,
                "s3_etag": s3_etag,
                "s3_last_modified": s3_last_modified.isoformat(),
                "folder": "uploads",
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
    
    print(f"[uploads_producer] Enqueued: {s3_key} (tenant: {tenant_id})")
    return True


def main():
    """Main function: scan uploads/{tenant}/ folders (all tenants or specific tenant)"""
    parser = argparse.ArgumentParser(description="Uploads producer: process uploaded documents from S3")
    parser.add_argument("--tenant", type=str, help="Process only this specific tenant (default: process all tenants)")
    args = parser.parse_args()
    
    target_tenant: Optional[str] = args.tenant
    
    print("[uploads_producer] Starting uploads producer...")
    if target_tenant:
        print(f"[uploads_producer] Target tenant: {target_tenant}")
    else:
        print("[uploads_producer] Processing all tenants")
    
    # Connect to services
    try:
        s3_client = connect_s3()
        db = ManifestDB()
        connection, channel = connect_rabbitmq()
    except Exception as e:
        print(f"[uploads_producer] Failed to connect: {e}")
        sys.exit(1)
    
    try:
        # List tenant folders in uploads/
        if target_tenant:
            # If specific tenant requested, verify it exists
            print(f"[uploads_producer] Checking for tenant folder: {UPLOADS_PREFIX}{target_tenant}/")
            tenants = list_tenant_folders(s3_client, BUCKET_NAME)
            if target_tenant not in tenants:
                print(f"[uploads_producer] Tenant '{target_tenant}' not found in {UPLOADS_PREFIX}")
                print(f"[uploads_producer] Available tenants: {', '.join(tenants) if tenants else 'none'}")
                return
            tenants = [target_tenant]
        else:
            # List all tenant folders in uploads/
            print(f"[uploads_producer] Listing tenant folders in {UPLOADS_PREFIX}...")
            tenants = list_tenant_folders(s3_client, BUCKET_NAME)
        
        if not tenants:
            print(f"[uploads_producer] No tenant folders found in {UPLOADS_PREFIX}")
            return
        
        print(f"[uploads_producer] Found {len(tenants)} tenant folder(s): {', '.join(tenants)}")
        
        total_enqueued = 0
        total_skipped = 0
        
        # Process each tenant folder
        for tenant_id in tenants:
            print(f"\n[uploads_producer] Processing tenant: {tenant_id}")
            prefix = f"{UPLOADS_PREFIX}{tenant_id}/"
            
            # List all objects in this tenant's uploads folder
            s3_objects = list_s3_objects(s3_client, BUCKET_NAME, prefix)
            
            if not s3_objects:
                print(f"[uploads_producer] No documents found in {prefix}")
                continue
            
            print(f"[uploads_producer] Found {len(s3_objects)} documents in {prefix}")
            
            # Process each document
            tenant_enqueued = 0
            tenant_skipped = 0
            
            for s3_obj in s3_objects:
                if process_uploaded_document(s3_obj, tenant_id, db, channel, s3_client):
                    tenant_enqueued += 1
                else:
                    tenant_skipped += 1
            
            total_enqueued += tenant_enqueued
            total_skipped += tenant_skipped
            
            print(f"[uploads_producer] Tenant {tenant_id}: {tenant_enqueued} enqueued, {tenant_skipped} skipped")
        
        print(f"\n[uploads_producer] Complete: {total_enqueued} total enqueued, {total_skipped} total skipped")
        
    finally:
        connection.close()


if __name__ == "__main__":
    main()

