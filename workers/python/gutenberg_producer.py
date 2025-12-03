"""Gutenberg Producer: Discovers Gutenberg books and enqueues for processing"""
import json
import os
import sys
import time
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import pika
import requests

from manifest import ManifestDB
from fingerprint import make_document_id, compute_file_fingerprint, has_file_changed, compute_content_hash

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
MAX_BOOKS = int(os.environ.get("MAX_BOOKS", "5"))  # how many books to process in this run (default: 5)


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
        
        # Get ETag from response if available (for efficient change detection)
        etag = resp.headers.get("ETag")
        
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
                content_hash,
                etag=etag
            )
        else:
            db.insert_manifest(
                TENANT_ID,
                path_str,
                document_id,
                mtime_dt,
                size_bytes,
                content_hash,
                etag=etag
            )
        
        time.sleep(REQUEST_DELAY_SECONDS)
        return target
        
    except Exception as e:
        print(f"[gutenberg-producer] Failed to download {book_id}: {e}")
        return None


# --- Main logic ---
def force_reindex_all_documents(db: ManifestDB, channel):
    """Force reindex all existing documents in manifest"""
    manifest_entries = db.get_all_manifest_entries(TENANT_ID)
    reindexed = 0
    
    print(f"[gutenberg-producer] Force reindexing {len(manifest_entries)} documents in manifest")
    
    for entry in manifest_entries:
        # Skip permanently deleted documents
        if entry.get("permanentlyDeleted", False):
            print(f"[gutenberg-producer] Skipping permanently deleted document: {entry.get('path', 'N/A')}")
            continue
        
        path_str = entry.get("path")
        if not path_str:
            continue
        
        local_path = Path(path_str)
        if not local_path.exists():
            print(f"[gutenberg-producer] File no longer exists: {path_str}, skipping")
            continue
        
        # Extract book_id from filename
        filename = local_path.stem
        try:
            book_id = int(filename.split("_")[0])
        except:
            print(f"[gutenberg-producer] Could not extract book_id from {path_str}, skipping")
            continue
        
        # Get book metadata from Gutendex API
        try:
            book_url = f"{GUTENDEX_BASE_URL}{book_id}/"
            book_data = fetch_gutendex_page(book_url)
            if not book_data:
                print(f"[gutenberg-producer] Could not fetch metadata for book {book_id}, skipping")
                continue
            
            title = book_data.get("title", f"book-{book_id}")
            publish_file(channel, TENANT_ID, local_path, book_id, title, book_data)
            reindexed += 1
            print(f"[gutenberg-producer] Force re-enqueued: {path_str}")
        except Exception as e:
            print(f"[gutenberg-producer] Error fetching metadata for book {book_id}: {e}, skipping")
    
    print(f"[gutenberg-producer] Force reindexed {reindexed} documents")
    return len(manifest_entries), reindexed


def reindex_single_document(db: ManifestDB, channel, document_path: str):
    """Reindex a single document by path"""
    path_str = document_path
    local_path = Path(path_str)
    
    if not local_path.exists():
        print(f"[gutenberg-producer] File not found: {path_str}")
        return False
    
    # Check if document is in manifest
    manifest = db.get_manifest(TENANT_ID, path_str)
    if manifest and manifest.get("permanentlyDeleted", False):
        print(f"[gutenberg-producer] Document is permanently deleted, cannot reindex: {path_str}")
        return False
    
    # Extract book_id from filename
    filename = local_path.stem
    try:
        book_id = int(filename.split("_")[0])
    except:
        print(f"[gutenberg-producer] Could not extract book_id from {path_str}")
        return False
    
    # Get book metadata from Gutendex API
    try:
        book_url = f"{GUTENDEX_BASE_URL}{book_id}/"
        book_data = fetch_gutendex_page(book_url)
        if not book_data:
            print(f"[gutenberg-producer] Could not fetch metadata for book {book_id}")
            return False
        
        title = book_data.get("title", f"book-{book_id}")
        publish_file(channel, TENANT_ID, local_path, book_id, title, book_data)
        print(f"[gutenberg-producer] Re-enqueued single document: {path_str}")
        return True
    except Exception as e:
        print(f"[gutenberg-producer] Error reindexing document: {e}")
        return False


def check_existing_documents(db: ManifestDB, channel):
    """Check existing manifest entries for changes (no-op for Gutenberg since content is static)"""
    print(f"[gutenberg-producer] Gutenberg content is static and never changes. Skipping check.")
    print(f"[gutenberg-producer] Use --force-reindex to reindex all existing documents.")
    return 0, 0


def fetch_new_documents(db: ManifestDB, channel, max_books: int):
    """Fetch new documents from Gutendex"""
    print(f"[gutenberg-producer] Fetching up to {max_books} NEW books from Gutendex...")
    print(f"[gutenberg-producer] Already-indexed books will be automatically skipped")
    
    page_url = GUTENDEX_BASE_URL + "?languages=en"
    processed = 0
    enqueued = 0
    skipped = 0
    
    # Safety limit: don't process more than 10x the requested number to avoid infinite loops
    # If we've processed 50 books and only found 1 new one, something is wrong
    max_processed = max(max_books * 10, 50)
    
    # Continue until we've enqueued max_books NEW documents (not just processed that many)
    while page_url and processed < max_processed:
        print(f"[gutenberg-producer] Fetching Gutendex page: {page_url}")
        
        try:
            data = fetch_gutendex_page(page_url)
        except Exception as e:
            print(f"[gutenberg-producer] Error fetching page: {e}")
            break
        
        results = data.get("results", [])
        next_page = data.get("next")
        
        for book in results:
            # Check limit - we want max_books NEW documents, so continue until we've enqueued that many
            if enqueued >= max_books:
                print(f"[gutenberg-producer] Reached limit of {max_books} new books enqueued, stopping")
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
            
            # When fetching new documents only, skip if document already exists in manifest
            # This prevents re-processing existing documents when --fetch-new is used
            if manifest:
                # Document already in manifest - skip it (we only want NEW documents)
                print(f"[gutenberg-producer] Book {book_id} already in manifest: {path_str} - skipping (fetch_new_only=True)")
                skipped += 1
                processed += 1
                continue
            
            # This is a new document (not in manifest), so enqueue it
            publish_file(channel, TENANT_ID, local_path, book_id, title, book)
            enqueued += 1
            if enqueued >= max_books:
                print(f"[gutenberg-producer] Reached limit of {max_books} new books enqueued, stopping")
                break
            
            processed += 1
        
        if enqueued >= max_books:
            break
        
        if processed >= max_processed:
            print(f"[gutenberg-producer] Reached safety limit of {max_processed} processed books, stopping")
            break
        
        page_url = next_page
    
    if enqueued < max_books and processed >= max_processed:
        print(f"[gutenberg-producer] WARNING: Only found {enqueued} new books after processing {processed} books (limit: {max_books})")
    
    print(f"[gutenberg-producer] Done. Processed {processed} books, enqueued {enqueued}, skipped {skipped}")
    return processed, enqueued, skipped


def main():
    parser = argparse.ArgumentParser(description="Gutenberg Producer")
    parser.add_argument("--check-existing", action="store_true", help="Check existing manifest entries for changes (no-op for Gutenberg)")
    parser.add_argument("--force-reindex", action="store_true", help="Force reindex all existing documents in manifest")
    parser.add_argument("--reindex-document", type=str, help="Reindex a specific document by path")
    parser.add_argument("--fetch-new", type=int, help="Number of new documents to fetch")
    
    # Legacy support: if first arg is a number, treat it as fetch-new
    args = parser.parse_args()
    
    # Handle legacy format: python gutenberg_producer.py 10
    if len(sys.argv) > 1 and sys.argv[1].isdigit() and not args.fetch_new:
        args.fetch_new = int(sys.argv[1])
    
    # Default behavior: if no flags, check existing only
    if not args.check_existing and not args.force_reindex and not args.reindex_document and not args.fetch_new:
        args.check_existing = True
    
    # Confirmation prompt when run manually (not via FastAPI)
    # Skip prompt if stdin is not a TTY (e.g., when run via subprocess with stdin=DEVNULL)
    if sys.stdin.isatty():
        print("\n" + "="*70)
        print(f"Gutenberg Producer - Tenant: {TENANT_ID}")
        print("="*70)
        if args.check_existing:
            print("⚠ Will check existing books (Gutenberg content is static, this is a no-op)")
        if args.force_reindex:
            print("⚠ Will FORCE REINDEX all existing books in manifest")
            print("  WARNING: This can be time-consuming and resource-intensive!")
        if args.reindex_document:
            print(f"✓ Will reindex single document: {args.reindex_document}")
        if args.fetch_new:
            print(f"✓ Will fetch up to {args.fetch_new} NEW books from Gutendex API")
            print("  (Already-indexed books will be automatically skipped)")
        print("="*70)
        try:
            response = input("\nProceed? (y/N): ")
            if response.lower() != 'y':
                print("Cancelled.")
                sys.exit(0)
        except (EOFError, OSError):
            # stdin is not available (e.g., when run via subprocess)
            # Proceed without confirmation
            print("\n[gutenberg-producer] Running in non-interactive mode (no stdin)")
        print()
    
    connection, channel = connect_rabbitmq()
    db = ManifestDB()
    
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        
        total_checked = 0
        total_enqueued = 0
        
        # Reindex single document
        if args.reindex_document:
            print(f"\n[gutenberg-producer] Reindexing single document: {args.reindex_document}")
            success = reindex_single_document(db, channel, args.reindex_document)
            if success:
                total_enqueued += 1
        # Force reindex all existing documents
        elif args.force_reindex:
            print(f"\n[gutenberg-producer] Force reindexing all existing documents for tenant '{TENANT_ID}'...")
            checked, enqueued = force_reindex_all_documents(db, channel)
            total_checked += checked
            total_enqueued += enqueued
        # Check existing documents (no-op for Gutenberg)
        elif args.check_existing:
            print(f"\n[gutenberg-producer] Checking existing documents for tenant '{TENANT_ID}'...")
            checked, enqueued = check_existing_documents(db, channel)
            total_checked += checked
            total_enqueued += enqueued
        
        # Fetch new documents
        if args.fetch_new:
            print(f"\n[gutenberg-producer] Fetching new documents for tenant '{TENANT_ID}'...")
            processed, enqueued, skipped = fetch_new_documents(db, channel, args.fetch_new)
            total_enqueued += enqueued
        
        print(f"\n[gutenberg-producer] ===== SUMMARY =====")
        print(f"[gutenberg-producer] Checked existing: {total_checked} files")
        print(f"[gutenberg-producer] Total enqueued: {total_enqueued} documents")
        print(f"[gutenberg-producer] ====================")
    finally:
        connection.close()
        # ManifestDB uses context managers, no need to close


if __name__ == "__main__":
    main()

