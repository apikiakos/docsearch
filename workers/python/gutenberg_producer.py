"""Gutenberg Producer: Discovers Gutenberg books and enqueues for processing"""
import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import pika
import requests

from manifest import ManifestDB
from fingerprint import make_document_id, compute_file_fingerprint, has_file_changed

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

# --- Config ---
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")
QUEUE_NAME = "doc_ingest"
TENANT_ID = os.environ.get("GUTENBERG_TENANT_ID", "gutenberg")
DATA_DIR = Path(__file__).parent.parent / "data" / "gutendex_books"
DATA_DIR.mkdir(parents=True, exist_ok=True)

GUTENDEX_BASE_URL = "https://gutendex.com/books/"

# Be gentle with Gutendex API
REQUEST_DELAY_SECONDS = float(os.environ.get("GUTENDEX_DELAY", "2.0"))
MAX_BOOKS = int(os.environ.get("MAX_BOOKS", "10"))  # how many books to process in this run


# --- RabbitMQ helpers ---
def connect_rabbitmq():
    params = pika.URLParameters(RABBITMQ_URL)
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    return connection, channel


def publish_file(channel, tenant_id: str, path: Path, book_id: int, title: str, book_data: dict):
    """Enqueue a book file for processing by consumer"""
    document_id = make_document_id(tenant_id, str(path))
    
    # Extract author information from book_data
    authors = book_data.get("authors", [])
    author_names = [author.get("name", "") for author in authors if author.get("name")]
    author = ", ".join(author_names) if author_names else None
    
    # Get the text URL for originalUrl
    formats = book_data.get("formats", {})
    text_url = pick_text_url(formats)
    
    # Build metadata according to new generic model
    message = {
        "operation": "upsert",
        "tenant_id": tenant_id,
        "document_id": document_id,
        "path": str(path),
        "producer_timestamp": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "filename": os.path.basename(path),
            "mime": "text/plain",
            "source": "gutendex",
            "source_url": text_url or str(path),  # Use Gutendex URL as source_url
            "type": "book",
            "originalUrl": text_url or str(path),  # URL to view/download the book
            "extras": {
                "book_id": book_id,
                "title": title,  # Keep title in extras for searchability
                "author": author,
            },
        },
    }
    
    body = json.dumps(message).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=QUEUE_NAME,
        body=body,
        properties=pika.BasicProperties(delivery_mode=2),
    )
    
    print(f"[gutenberg-producer] Enqueued {path} for ingestion (book_id={book_id}, author={author})")


# --- Gutendex & download helpers ---
def fetch_gutendex_page(page_url: str) -> dict:
    """Fetch a page from Gutendex API"""
    headers = {
        "User-Agent": "distributed-docsearch-prototype/0.1"
    }
    resp = requests.get(page_url, headers=headers, timeout=15)
    resp.raise_for_status()
    time.sleep(REQUEST_DELAY_SECONDS)
    return resp.json()


def pick_text_url(formats: dict) -> Optional[str]:
    """
    Gutendex provides a 'formats' dict mapping MIME types to URLs.
    We want a text/plain-ish URL if possible.
    """
    # Prefer explicit UTF-8 plain text
    candidates = []
    for mime, url in formats.items():
        if not url:
            continue
        lower_mime = mime.lower()
        if "text/plain" in lower_mime:
            candidates.append(url)
    
    if candidates:
        return candidates[0]
    
    # Fallback: maybe HTML if no plain text (not ideal but workable)
    for mime, url in formats.items():
        if not url:
            continue
        lower_mime = mime.lower()
        if "text/html" in lower_mime:
            return url
    
    return None


def download_book_text(book_id: int, title: str, text_url: str, db: ManifestDB, force_download: bool = False) -> Optional[Path]:
    """
    Download the plain text of a book via the given URL.
    Uses manifest to detect if already downloaded and unchanged.
    Returns the local path or None on failure/too-short content.
    """
    safe_title = "".join(
        c for c in title.replace(" ", "_") if c.isalnum() or c in ("_", "-")
    )[:80]
    filename = f"{book_id}_{safe_title}.txt"
    target = DATA_DIR / filename
    path_str = str(target)
    
    # Initialize manifest variable
    manifest = None
    
    # If force_download is True, skip manifest check and always download
    if not force_download:
        # Check manifest to see if we already have this file
        manifest = db.get_manifest(TENANT_ID, path_str)
        
        if manifest and not manifest.get("isDeleted", False):
            # File exists in manifest - check if it's still on disk and unchanged
            if target.exists():
                # Check if file changed (compare fingerprint)
                current_mtime, current_size, current_hash = compute_file_fingerprint(target)
                manifest_mtime_value = manifest.get("lastMtime")
                if hasattr(manifest_mtime_value, "timestamp"):
                    manifest_mtime = manifest_mtime_value.timestamp()
                elif isinstance(manifest_mtime_value, datetime):
                    manifest_mtime = manifest_mtime_value.timestamp()
                else:
                    manifest_mtime = float(manifest_mtime_value) if manifest_mtime_value else 0
                
                manifest_size = int(manifest.get("sizeBytes") or 0)
                manifest_hash = manifest.get("contentHash")
                
                if not has_file_changed(
                    current_mtime, current_size, current_hash,
                    manifest_mtime, manifest_size, manifest_hash
                ):
                    # File unchanged - skip download
                    print(f"[gutenberg-producer] Book {book_id} already downloaded and unchanged: {target}")
                    return target
                else:
                    print(f"[gutenberg-producer] Book {book_id} changed, re-downloading: {target}")
            else:
                # File deleted from disk but in manifest - re-download
                print(f"[gutenberg-producer] Book {book_id} missing from disk, re-downloading: {target}")
    else:
        print(f"[gutenberg-producer] Force download enabled, downloading book {book_id}")
        # Get manifest for later update (even if force downloading)
        manifest = db.get_manifest(TENANT_ID, path_str)
    
    # Download the book
    headers = {
        "User-Agent": "distributed-docsearch-prototype/0.1"
    }
    
    print(f"[gutenberg-producer] Downloading book {book_id} from {text_url}")
    
    try:
        resp = requests.get(text_url, headers=headers, timeout=60)
        resp.raise_for_status()
        text = resp.text
        
        # Basic sanity check
        if len(text.strip()) < 2000:
            print(f"[gutenberg-producer] Book {book_id} text too short, skipping")
            return None
        
        # Write to file
        target.write_text(text, encoding="utf-8")
        print(f"[gutenberg-producer] Saved book {book_id} to {target}")
        
        # Update manifest
        mtime, size_bytes, content_hash = compute_file_fingerprint(target)
        mtime_dt = datetime.fromtimestamp(mtime, tz=timezone.utc)
        document_id = make_document_id(TENANT_ID, path_str)
        
        if manifest:
            db.update_manifest(
                TENANT_ID,
                path_str,
                mtime_dt,
                size_bytes,
                content_hash
            )
        else:
            db.insert_manifest(
                TENANT_ID,
                path_str,
                document_id,
                mtime_dt,
                size_bytes,
                content_hash
            )
        
        time.sleep(REQUEST_DELAY_SECONDS)
        return target
        
    except Exception as e:
        print(f"[gutenberg-producer] Failed to download {book_id}: {e}")
        return None


# --- Main logic ---
def main():
    if len(sys.argv) > 1:
        global MAX_BOOKS
        MAX_BOOKS = int(sys.argv[1])
    
    connection, channel = connect_rabbitmq()
    db = ManifestDB()
    
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        page_url = GUTENDEX_BASE_URL + "?languages=en"
        processed = 0
        enqueued = 0
        skipped = 0
        
        print(f"[gutenberg-producer] Starting discovery (max {MAX_BOOKS} books)")
        
        while page_url and processed < MAX_BOOKS:
            print(f"[gutenberg-producer] Fetching Gutendex page: {page_url}")
            
            try:
                data = fetch_gutendex_page(page_url)
            except Exception as e:
                print(f"[gutenberg-producer] Error fetching page: {e}")
                break
            
            results = data.get("results", [])
            next_page = data.get("next")
            
            for book in results:
                if enqueued >= MAX_BOOKS:
                    print(f"[gutenberg-producer] Reached max books limit ({MAX_BOOKS}), stopping")
                    break
                
                book_id = book.get("id")
                title = book.get("title", f"book-{book_id}")
                formats = book.get("formats", {})
                
                text_url = pick_text_url(formats)
                if not text_url:
                    print(f"[gutenberg-producer] No plain text URL for book {book_id}, skip")
                    skipped += 1
                    processed += 1
                    continue
                
                # Download book (force download from online feed, not cached)
                local_path = download_book_text(book_id, title, text_url, db, force_download=True)
                
                if local_path is None:
                    skipped += 1
                    processed += 1
                    continue
                
                # Check if we need to enqueue (new or changed file)
                path_str = str(local_path)
                manifest = db.get_manifest(TENANT_ID, path_str)
                
                # Get current file fingerprint
                current_mtime, current_size, current_hash = compute_file_fingerprint(local_path)
                mtime_dt = datetime.fromtimestamp(current_mtime, tz=timezone.utc)
                
                # Check if file was just downloaded or changed
                should_enqueue = False
                if not manifest:
                    # New file - enqueue
                    should_enqueue = True
                else:
                    # Check if file changed since last indexed
                    manifest_mtime_value = manifest.get("lastMtime")
                    if hasattr(manifest_mtime_value, "timestamp"):
                        manifest_mtime = manifest_mtime_value.timestamp()
                    elif isinstance(manifest_mtime_value, datetime):
                        manifest_mtime = manifest_mtime_value.timestamp()
                    else:
                        manifest_mtime = float(manifest_mtime_value) if manifest_mtime_value else 0
                    
                    manifest_size = int(manifest.get("sizeBytes") or 0)
                    manifest_hash = manifest.get("contentHash")
                    last_indexed = manifest.get("lastIndexedAt")
                    
                    # Enqueue if file changed or if it was never indexed
                    if has_file_changed(
                        current_mtime, current_size, current_hash,
                        manifest_mtime, manifest_size, manifest_hash
                    ):
                        should_enqueue = True
                    elif last_indexed is None:
                        # File exists but never indexed
                        should_enqueue = True
                
                if should_enqueue:
                    publish_file(channel, TENANT_ID, local_path, book_id, title, book)
                    enqueued += 1
                    if enqueued >= MAX_BOOKS:
                        print(f"[gutenberg-producer] Reached max books limit ({MAX_BOOKS}), stopping")
                        break
                else:
                    print(f"[gutenberg-producer] Book {book_id} already indexed, skipping queue")
                    skipped += 1
                
                processed += 1
            
            if enqueued >= MAX_BOOKS:
                break
            
            page_url = next_page
        
        print(f"[gutenberg-producer] Done. Processed {processed} books, enqueued {enqueued}, skipped {skipped}")
        
    finally:
        connection.close()


if __name__ == "__main__":
    main()

