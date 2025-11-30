#!/usr/bin/env python3
"""
Test S3 Producer: Tests fetching a random document from S3 and extracting
the information needed for the queue (dry-run, no actual enqueueing).
"""
import os
import sys
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Optional

import boto3
from botocore.exceptions import ClientError

from fingerprint import make_document_id, compute_file_fingerprint
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

# Get AWS credentials
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
AWS_DEFAULT_REGION = os.environ.get("AWS_DEFAULT_REGION", "eu-west-1")
BUCKET_NAME = os.environ.get("AWS_S3_BUCKET", "document-search-tenants")


def list_s3_objects(s3_client, bucket: str, prefix: str = "", max_keys: int = 1000) -> list:
    """List objects in S3 bucket"""
    objects = []
    paginator = s3_client.get_paginator('list_objects_v2')
    
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix, MaxKeys=max_keys):
        if 'Contents' in page:
            objects.extend([obj['Key'] for obj in page['Contents']])
    
    return objects


def download_s3_object(s3_client, bucket: str, key: str, local_path: Path) -> bool:
    """Download an S3 object to a local file"""
    try:
        s3_client.download_file(bucket, key, str(local_path))
        return True
    except ClientError as e:
        print(f"Error downloading {key}: {e}")
        return False


def extract_tenant_from_key(s3_key: str) -> Optional[str]:
    """Extract tenant ID from S3 key (e.g., s3-tenant-1/invoices/file.txt -> s3-tenant-1)"""
    parts = s3_key.split('/')
    if len(parts) >= 1:
        return parts[0]
    return None


def test_s3_document(s3_key: str, tenant_id: Optional[str] = None) -> Dict:
    """
    Test fetching a document from S3 and extract all information needed for queue.
    Returns a dictionary with all the metadata that would be enqueued.
    """
    print(f"\n{'='*60}")
    print(f"Testing S3 Document: {s3_key}")
    print(f"{'='*60}\n")
    
    # Initialize S3 client
    try:
        s3_client = boto3.client(
            's3',
            region_name=AWS_DEFAULT_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY
        )
    except Exception as e:
        print(f"❌ Error initializing S3 client: {e}")
        return {}
    
    # Extract tenant if not provided
    if not tenant_id:
        tenant_id = extract_tenant_from_key(s3_key)
        if not tenant_id:
            print(f"❌ Could not extract tenant from key: {s3_key}")
            return {}
    
    print(f"📁 Tenant: {tenant_id}")
    print(f"📄 S3 Key: {s3_key}")
    
    # Get object metadata from S3
    try:
        print(f"\n📥 Fetching object metadata from S3...")
        head_response = s3_client.head_object(Bucket=BUCKET_NAME, Key=s3_key)
        
        s3_size = head_response.get('ContentLength', 0)
        s3_etag = head_response.get('ETag', '').strip('"')
        s3_last_modified = head_response.get('LastModified')
        s3_content_type = head_response.get('ContentType', 'application/octet-stream')
        
        print(f"  ✓ Size: {s3_size:,} bytes")
        print(f"  ✓ ETag: {s3_etag}")
        print(f"  ✓ Last Modified: {s3_last_modified}")
        print(f"  ✓ Content-Type: {s3_content_type}")
        
    except ClientError as e:
        print(f"❌ Error fetching object metadata: {e}")
        return {}
    
    # Download file to temporary location
    print(f"\n📥 Downloading file to temporary location...")
    with tempfile.NamedTemporaryFile(delete=False, suffix=Path(s3_key).suffix) as tmp_file:
        tmp_path = Path(tmp_file.name)
    
    try:
        if not download_s3_object(s3_client, BUCKET_NAME, s3_key, tmp_path):
            return {}
        
        print(f"  ✓ Downloaded to: {tmp_path}")
        
        # Compute file fingerprint
        print(f"\n🔍 Computing file fingerprint...")
        mtime, size_bytes, content_hash = compute_file_fingerprint(tmp_path)
        mtime_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        
        print(f"  ✓ mtime: {mtime_dt.isoformat()}")
        print(f"  ✓ size: {size_bytes:,} bytes")
        if content_hash:
            print(f"  ✓ content_hash: {content_hash[:16]}...")
        else:
            print(f"  ✓ content_hash: (not computed)")
        
        # Detect MIME type
        print(f"\n🔍 Detecting MIME type...")
        mime = detect_mime_type(tmp_path)
        # Use S3 content type as fallback if detection fails
        if mime == "application/octet-stream" and s3_content_type:
            mime = s3_content_type
        print(f"  ✓ MIME type: {mime}")
        if s3_content_type and s3_content_type != mime:
            print(f"  ℹ️  S3 Content-Type: {s3_content_type}")
        
        # Generate document ID (using S3 key as the path identifier)
        # For S3, we use the S3 key as the path
        s3_path = f"s3://{BUCKET_NAME}/{s3_key}"
        document_id = make_document_id(tenant_id, s3_path)
        print(f"\n🆔 Generated document ID: {document_id}")
        
        # Extract folder/category from S3 key
        key_parts = s3_key.split('/')
        folder = key_parts[1] if len(key_parts) > 1 else "unknown"
        filename = key_parts[-1] if key_parts else s3_key
        
        # Build the message that would be enqueued
        queue_message = {
            "operation": "upsert",
            "tenant_id": tenant_id,
            "document_id": document_id,
            "path": str(tmp_path),  # Local path where file was downloaded
            "mime": mime,
            "metadata": {
                "source": "s3",
                "s3_bucket": BUCKET_NAME,
                "s3_key": s3_key,
                "s3_etag": s3_etag,
                "s3_last_modified": s3_last_modified.isoformat() if s3_last_modified else None,
                "folder": folder,
                "filename": filename,
            },
            "producer_timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        print(f"\n{'='*60}")
        print(f"✅ Queue Message (DRY RUN - NOT ENQUEUED):")
        print(f"{'='*60}")
        print(json.dumps(queue_message, indent=2, default=str))
        print(f"{'='*60}\n")
        
        # Summary
        print(f"📊 Summary:")
        print(f"  • Tenant: {tenant_id}")
        print(f"  • Document ID: {document_id}")
        print(f"  • S3 Location: s3://{BUCKET_NAME}/{s3_key}")
        print(f"  • Local Path: {tmp_path}")
        print(f"  • MIME Type: {mime}")
        print(f"  • Size: {size_bytes:,} bytes")
        print(f"  • Folder: {folder}")
        print(f"  • Filename: {filename}")
        print(f"\n✅ All information extracted successfully!")
        print(f"⚠️  This was a DRY RUN - no message was enqueued to RabbitMQ\n")
        
        # Cleanup
        try:
            tmp_path.unlink()
            print(f"🧹 Cleaned up temporary file: {tmp_path}")
        except Exception as e:
            print(f"⚠️  Could not delete temporary file: {e}")
        
        return queue_message
        
    except Exception as e:
        print(f"❌ Error processing file: {e}")
        import traceback
        traceback.print_exc()
        # Cleanup on error
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except:
            pass
        return {}


def main():
    """Main function - test with a random document or specified key"""
    if len(sys.argv) > 1:
        # Use provided S3 key
        s3_key = sys.argv[1]
        tenant_id = sys.argv[2] if len(sys.argv) > 2 else None
    else:
        # Pick a random document
        print("🔍 Finding a random document in S3...")
        
        try:
            s3_client = boto3.client(
                's3',
                region_name=AWS_DEFAULT_REGION,
                aws_access_key_id=AWS_ACCESS_KEY_ID,
                aws_secret_access_key=AWS_SECRET_ACCESS_KEY
            )
            
            # List all objects
            objects = list_s3_objects(s3_client, BUCKET_NAME)
            if not objects:
                print("❌ No objects found in bucket")
                return
            
            # Filter out .keep files and pick random
            import random
            valid_objects = [obj for obj in objects if not obj.endswith('.keep')]
            if not valid_objects:
                print("❌ No valid documents found (only .keep files)")
                return
            
            s3_key = random.choice(valid_objects)
            tenant_id = None
            print(f"✓ Selected random document: {s3_key}\n")
            
        except Exception as e:
            print(f"❌ Error listing S3 objects: {e}")
            return
    
    # Test the document
    result = test_s3_document(s3_key, tenant_id)
    
    if result:
        print("✅ Test completed successfully!")
    else:
        print("❌ Test failed!")
        sys.exit(1)


if __name__ == "__main__":
    main()

