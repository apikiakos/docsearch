"""HTTP Producer: Discovers remote resources, downloads and stores them locally"""
import json
import sys
import os
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, List
import requests
import pika

from manifest import ManifestDB
from fingerprint import make_document_id, compute_file_fingerprint
from mime_detector import detect_mime_type, detect_mime_from_content_type

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
DATA_DIR = Path(__file__).parent.parent / "data" / "http_downloads"


def connect_rabbitmq():
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    return connection, channel


# Removed get_mime_type_from_response - now using detect_mime_from_content_type


# Removed fetch_with_etag - discovery now happens inline in discover_remote_resource


def download_and_store_file(url: str, tenant_id: str, local_path: Path) -> bool:
    """
    Download a remote file and store it locally.
    
    Producer responsibility: fetch raw bytes and store in local storage.
    Returns True if download successful, False otherwise.
    """
    headers = {
        "User-Agent": "distributed-docsearch-prototype/0.1"
    }
    
    try:
        print(f"[http_producer] Downloading {url} to {local_path}")
        response = requests.get(url, headers=headers, timeout=60, stream=True)
        response.raise_for_status()
        
        # Ensure parent directory exists
        local_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Download and write to file
        with open(local_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        print(f"[http_producer] Downloaded and stored: {local_path}")
        return True
    except Exception as e:
        print(f"[http_producer] Error downloading {url}: {e}")
        # Clean up partial file if exists
        if local_path.exists():
            try:
                local_path.unlink()
            except:
                pass
        return False


def discover_and_store_remote_resource(
    url: str,
    tenant_id: str,
    db: ManifestDB,
    channel
) -> bool:
    """
    Discover a remote resource, download it if changed, and enqueue local path.
    
    Producer responsibilities:
    1. Check ETag to detect changes (avoids unnecessary downloads)
    2. Download raw bytes and store locally if changed
    3. Update manifest with file fingerprint
    4. Enqueue local file path (not URL) for consumer to process
    
    Returns True if resource was downloaded and enqueued, False if skipped.
    """
    import time
    discovery_start = time.time()
    
    # Create safe filename from URL
    from urllib.parse import urlparse
    parsed = urlparse(url)
    filename = os.path.basename(parsed.path) or "index.html"
    # Sanitize filename
    safe_filename = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_"))[:200]
    if not safe_filename:
        # Fallback: use hash of URL
        import hashlib
        safe_filename = hashlib.md5(url.encode()).hexdigest()[:16] + ".txt"
    
    # Store in tenant-specific subdirectory
    tenant_dir = DATA_DIR / tenant_id
    tenant_dir.mkdir(parents=True, exist_ok=True)
    local_path = tenant_dir / safe_filename
    local_path_str = str(local_path)
    
    # Get existing manifest entry (tracked by local path, not URL)
    manifest_entry = db.get_manifest(tenant_id, local_path_str)
    stored_etag = manifest_entry.get("etag") if manifest_entry else None
    
    # Check ETag with HEAD request first (lightweight)
    headers = {}
    if stored_etag:
        headers["If-None-Match"] = stored_etag
    
    try:
        response = requests.head(url, headers=headers, timeout=30, allow_redirects=True)
        
        # If HEAD doesn't work, try GET but only check headers
        if response.status_code not in [200, 304]:
            response = requests.get(url, headers=headers, timeout=30, stream=True)
            response.close()
    except requests.exceptions.RequestException as e:
        print(f"[http_producer] Error checking ETag for {url}: {e}")
        return False
    
    # Check if resource unchanged (304 Not Modified)
    if response.status_code == 304:
        # Resource unchanged - check if local file exists and is valid
        if local_path.exists() and manifest_entry:
            # File exists and unchanged - check if we need to reindex
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
            
            # If file exists and matches manifest, skip
            if (current_size == manifest_size and 
                (not manifest_hash or current_hash == manifest_hash)):
                print(f"[http_producer] Resource unchanged (304) and local file valid: {url} - skipping")
                return False
        
        # File missing or changed - need to download
        print(f"[http_producer] Resource unchanged (304) but local file missing/changed, downloading: {url}")
    
    if response.status_code != 200:
        print(f"[http_producer] Unexpected status {response.status_code} for {url}")
        return False
    
    # Resource changed or new - download it
    if not download_and_store_file(url, tenant_id, local_path):
        return False
    
    # Get new ETag and metadata
    new_etag = response.headers.get("ETag", "")
    if new_etag:
        new_etag = new_etag.strip('"')
    
    # Compute file fingerprint
    mtime, size_bytes, content_hash = compute_file_fingerprint(local_path)
    mtime_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
    
    # Get MIME type from HTTP headers first, then from file content/extension
    content_type_header = response.headers.get("Content-Type", "")
    mime = detect_mime_from_content_type(content_type_header)
    
    # If header detection failed or returned generic type, detect from file
    if not mime or mime == "application/octet-stream":
        mime = detect_mime_type(local_path)
    
    # Generate stable document ID (based on local path, not URL)
    document_id = make_document_id(tenant_id, local_path_str)
    
    # Update manifest with local file path and fingerprint
    if manifest_entry:
        db.update_manifest(
            tenant_id,
            local_path_str,
            mtime_dt,
            size_bytes,
            content_hash=content_hash,
            etag=new_etag
        )
    else:
        db.insert_manifest(
            tenant_id,
            local_path_str,
            document_id,
            mtime_dt,
            size_bytes,
            content_hash=content_hash,
            etag=new_etag
        )
    
    # Enqueue LOCAL FILE PATH (not URL) - consumer processes local files only
    # Build metadata according to new generic model
    message = {
        "operation": "upsert",
        "tenant_id": tenant_id,
        "document_id": document_id,
        "path": local_path_str,  # Local file path, not URL
        "mime": mime,
        "metadata": {
            "filename": os.path.basename(local_path_str),
            "mime": mime,
            "source": "http",
            "source_url": url,  # Original HTTP URL as source_url
            "type": "document",
            "originalUrl": url,  # Keep original URL for reference
            "extras": {
                "etag": new_etag,
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
    
    print(f"[http_producer] Downloaded and enqueued: {url} -> {local_path_str}")
    return True


def scan_remote_sources(
    urls: List[str],
    tenant_id: str,
    db: ManifestDB,
    channel
):
    """
    Scan remote HTTP sources, download changed resources, and enqueue local paths.
    
    Producer responsibility: discover, download, and store files locally.
    """
    import time
    scan_start = time.time()
    enqueued = 0
    skipped = 0
    errors = 0
    
    print(f"[http_producer] Starting scan of {len(urls)} remote resources for tenant {tenant_id}...")
    
    for url in urls:
        try:
            if discover_and_store_remote_resource(url, tenant_id, db, channel):
                enqueued += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"[http_producer] Error processing {url}: {e}")
            import traceback
            traceback.print_exc()
            errors += 1
    
    scan_total_time = time.time() - scan_start
    print(f"[http_producer] Scan complete: {enqueued} downloaded and enqueued, {skipped} skipped, {errors} errors")
    print(f"[http_producer] Total scan time: {scan_total_time:.3f}s")


def main():
    if len(sys.argv) < 3:
        print("Usage: http_producer.py <url1> [url2] ... <tenant_id>")
        print("   OR: http_producer.py --file <urls_file> <tenant_id>")
        sys.exit(1)
    
    # Parse arguments
    if sys.argv[1] == "--file":
        # Read URLs from file (one per line)
        urls_file = sys.argv[2]
        tenant_id = sys.argv[3]
        with open(urls_file, "r") as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]
    else:
        # URLs provided as arguments
        tenant_id = sys.argv[-1]
        urls = sys.argv[1:-1]
    
    if not urls:
        print("No URLs provided")
        sys.exit(1)
    
    # Initialize database and RabbitMQ
    db = ManifestDB()
    connection, channel = connect_rabbitmq()
    
    try:
        scan_remote_sources(urls, tenant_id, db, channel)
    finally:
        connection.close()


if __name__ == "__main__":
    main()

