#!/usr/bin/env python3
"""
S3 Seeding Tool: Populates S3 bucket with French romantic literature documents.

Fetches books from Gutendex, slices them into virtual documents,
generates multiple formats, and uploads to S3 with proper folder structure.
"""
import argparse
import os
import random
import re
import string
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import boto3
import requests
from bs4 import BeautifulSoup
from docx import Document
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

# Load environment variables from root .env file
try:
    from dotenv import load_dotenv
    # Load from root .env (two levels up from workers/python)
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded environment variables from {env_path}")
    else:
        # Also try loading from current directory
        load_dotenv()
except ImportError:
    # python-dotenv not installed, use environment variables directly
    pass

# --- Configuration ---
GUTENDEX_BASE_URL = "https://gutendex.com/books/"
REQUEST_DELAY_SECONDS = 2.0  # Be gentle with Gutendex API

# French romantic authors to prioritize
FRENCH_ROMANTIC_AUTHORS = [
    "Hugo", "Balzac", "Sand", "Stendhal", "Dumas", "Flaubert",
    "Lamartine", "Musset", "Chateaubriand", "Vigny", "Nerval"
]

# Folder categories for S3
FOLDER_CATEGORIES = ["invoices", "reports", "legal", "books"]

# Format options
FORMATS = ["txt", "md", "html", "pdf", "docx"]


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
    Pick a plain text URL from formats dict.
    Prefers UTF-8 encoded text files.
    """
    # Prefer UTF-8 text files first
    utf8_candidates = []
    plain_candidates = []
    
    for mime, url in formats.items():
        if not url:
            continue
        lower_mime = mime.lower()
        lower_url = url.lower()
        
        if "text/plain" in lower_mime:
            # Prefer URLs that explicitly mention utf-8
            if "utf-8" in lower_url or "utf8" in lower_url:
                utf8_candidates.append(url)
            else:
                plain_candidates.append(url)
    
    # Return UTF-8 version if available, otherwise any plain text
    if utf8_candidates:
        return utf8_candidates[0]
    if plain_candidates:
        return plain_candidates[0]
    
    # Fallback to HTML
    for mime, url in formats.items():
        if not url:
            continue
        lower_mime = mime.lower()
        if "text/html" in lower_mime:
            return url
    
    return None


def download_book_text(book_id: int, title: str, text_url: str, cache_dir: Path) -> Optional[str]:
    """Download book text and return content. Caches to disk."""
    headers = {
        "User-Agent": "distributed-docsearch-prototype/0.1"
    }
    
    cache_file = cache_dir / f"{book_id}.txt"
    
    try:
        print(f"  📥 Downloading {title} (book {book_id}) from {text_url}...")
        resp = requests.get(text_url, headers=headers, timeout=60)
        resp.raise_for_status()
        print(f"  ✓ Downloaded {len(resp.content)} bytes")
        
        # Explicitly decode as UTF-8, with fallback handling
        # requests library auto-detects encoding, but we want to ensure UTF-8
        try:
            # Try to decode as UTF-8 first
            text = resp.content.decode('utf-8')
        except UnicodeDecodeError:
            # If that fails, use requests' auto-detection (shouldn't happen for .txt.utf-8 files)
            print(f"  ⚠️  UTF-8 decode failed, using auto-detected encoding")
            text = resp.text
        
        # Handle HTML if needed
        if "text/html" in resp.headers.get("Content-Type", "").lower():
            print(f"  🔍 Parsing HTML content...")
            soup = BeautifulSoup(text, "html.parser")
            # Remove script/style
            for tag in soup(["script", "style"]):
                tag.decompose()
            text = soup.get_text()
        
        # Basic sanity check
        if len(text.strip()) < 20000:  # At least 20k characters
            print(f"  ⚠️  Book {book_id} too short ({len(text)} chars), skipping")
            return None
        
        # Cache to disk
        try:
            cache_file.write_text(text, encoding="utf-8")
            print(f"  💾 Cached to {cache_file} ({len(text)} characters)")
        except Exception as e:
            print(f"  ⚠️  Warning: Could not cache book: {e}")
        
        return text
    except Exception as e:
        print(f"  ❌ Error downloading {book_id}: {e}")
        import traceback
        traceback.print_exc()
        return None


def slice_book_into_documents(text: str, min_words: int = 250, max_words: int = 500) -> List[str]:
    """
    Slice book text into virtual documents (2-5 paragraphs each).
    
    Returns list of document texts.
    """
    # Split into paragraphs (blank lines)
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    
    documents = []
    current_doc = []
    current_word_count = 0
    
    for para in paragraphs:
        word_count = len(para.split())
        current_doc.append(para)
        current_word_count += word_count
        
        # If we've reached a good size (2-5 paragraphs, 250-500 words), save it
        if len(current_doc) >= 2 and current_word_count >= min_words:
            if current_word_count >= max_words or len(current_doc) >= 5:
                # Save current document
                documents.append("\n\n".join(current_doc))
                current_doc = []
                current_word_count = 0
    
    # Add remaining paragraphs as last document
    if current_doc:
        documents.append("\n\n".join(current_doc))
    
    return documents


def generate_txt(title: str, content: str) -> bytes:
    """Generate TXT format"""
    text = f"{title}\n\n{content}"
    return text.encode("utf-8")


def generate_md(title: str, content: str) -> bytes:
    """Generate Markdown format"""
    md = f"# {title}\n\n{content}"
    return md.encode("utf-8")


def generate_html(title: str, content: str) -> bytes:
    """Generate HTML format"""
    # Split content into paragraphs
    paragraphs = content.split("\n\n")
    para_html = "\n".join(f"<p>{p}</p>" for p in paragraphs if p.strip())
    
    html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{title}</title>
</head>
<body>
    <h1>{title}</h1>
    {para_html}
</body>
</html>"""
    return html.encode("utf-8")


def generate_pdf(title: str, content: str) -> bytes:
    """Generate PDF format"""
    from io import BytesIO
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []
    
    # Title
    title_para = Paragraph(title, styles["Heading1"])
    story.append(title_para)
    story.append(Spacer(1, 12))
    
    # Content paragraphs
    for para_text in content.split("\n\n"):
        if para_text.strip():
            para = Paragraph(para_text.strip(), styles["Normal"])
            story.append(para)
            story.append(Spacer(1, 6))
    
    doc.build(story)
    buffer.seek(0)
    return buffer.read()


def generate_docx(title: str, content: str) -> bytes:
    """Generate DOCX format"""
    from io import BytesIO
    
    doc = Document()
    doc.add_heading(title, level=1)
    
    # Add paragraphs
    for para_text in content.split("\n\n"):
        if para_text.strip():
            doc.add_paragraph(para_text.strip())
    
    buffer = BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer.read()


def generate_file(title: str, content: str, format_type: str) -> bytes:
    """Generate file in specified format"""
    generators = {
        "txt": generate_txt,
        "md": generate_md,
        "html": generate_html,
        "pdf": generate_pdf,
        "docx": generate_docx,
    }
    
    generator = generators.get(format_type)
    if not generator:
        raise ValueError(f"Unknown format: {format_type}")
    
    return generator(title, content)


def slugify(text: str) -> str:
    """Create a URL-friendly slug from text"""
    text = text.lower()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text[:50]  # Limit length


def generate_filename(book_id: int, slice_index: int, book_title: str, format_type: str) -> str:
    """Generate filename pattern: {bookId}_{sliceIndex}_{book-name-slug}_{randomSuffix}.{ext}"""
    random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
    book_slug = slugify(book_title)
    return f"{book_id}_{slice_index:04d}_{book_slug}_{random_suffix}.{format_type}"


def create_s3_bucket(s3_client, bucket: str, region: str) -> bool:
    """Create S3 bucket if it doesn't exist"""
    try:
        # Check if bucket exists
        try:
            s3_client.head_bucket(Bucket=bucket)
            print(f"✓ Bucket '{bucket}' already exists")
            return True
        except Exception as e:
            # Check if it's a 404 (bucket doesn't exist)
            error_code = None
            if hasattr(e, "response"):
                error_code = e.response.get("Error", {}).get("Code", "")
            elif hasattr(e, "error_code"):
                error_code = e.error_code
            
            if error_code == "404" or "Not Found" in str(e):
                # Bucket doesn't exist, create it
                print(f"Creating bucket '{bucket}' in region '{region}'...")
                try:
                    if region == "us-east-1":
                        # us-east-1 doesn't support LocationConstraint
                        s3_client.create_bucket(Bucket=bucket)
                    else:
                        s3_client.create_bucket(
                            Bucket=bucket,
                            CreateBucketConfiguration={"LocationConstraint": region}
                        )
                    print(f"✓ Created bucket '{bucket}'")
                    return True
                except Exception as create_error:
                    print(f"Error creating bucket: {create_error}")
                    return False
            else:
                # Other error (permissions, etc.)
                print(f"Error checking bucket: {e}")
                return False
    except Exception as e:
        print(f"Error creating/checking bucket: {e}")
        return False


def upload_to_s3(
    s3_client,
    bucket: str,
    key: str,
    content: bytes,
    content_type: str
):
    """Upload file to S3 (thread-safe, can be called in parallel)"""
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type
    )


def discover_french_romantic_books(max_books: int = 50) -> List[Dict]:
    """Discover French romantic literature books from Gutendex"""
    books = []
    page_url = f"{GUTENDEX_BASE_URL}?languages=fr&mime_type=text%2Fplain"
    
    print(f"Discovering French romantic literature books (target: {max_books})...")
    
    while page_url and len(books) < max_books:
        try:
            data = fetch_gutendex_page(page_url)
            results = data.get("results", [])
            next_page = data.get("next")
            
            for book in results:
                if len(books) >= max_books:
                    break
                
                # Check if author matches our list
                authors = book.get("authors", [])
                author_names = " ".join([a.get("name", "") for a in authors])
                
                # Prioritize known authors or books with "roman" or "amour" in title
                title = book.get("title", "").lower()
                is_romantic = (
                    any(author in author_names for author in FRENCH_ROMANTIC_AUTHORS) or
                    "roman" in title or
                    "amour" in title or
                    "amant" in title
                )
                
                if is_romantic:
                    formats = book.get("formats", {})
                    text_url = pick_text_url(formats)
                    
                    if text_url:
                        books.append({
                            "id": book.get("id"),
                            "title": book.get("title", f"book-{book.get('id')}"),
                            "authors": authors,
                            "text_url": text_url,
                        })
                        print(f"  Found: {book.get('title')} (ID: {book.get('id')})")
            
            page_url = next_page
        except Exception as e:
            print(f"Error fetching page: {e}")
            break
    
    print(f"Discovered {len(books)} books")
    return books


def main():
    parser = argparse.ArgumentParser(
        description="Seed S3 bucket with French romantic literature documents"
    )
    parser.add_argument(
        "--max-books",
        type=int,
        default=50,
        help="Maximum number of books to fetch (default: 50)"
    )
    parser.add_argument(
        "--target-docs-tenant-1",
        type=int,
        default=200,
        help="Target number of documents for tenant 1 (default: 200)"
    )
    parser.add_argument(
        "--target-docs-tenant-2",
        type=int,
        default=300,
        help="Target number of documents for tenant 2 (default: 300)"
    )
    parser.add_argument(
        "--bucket",
        type=str,
        required=True,
        help="S3 bucket name (or set AWS_S3_BUCKET env var)"
    )
    parser.add_argument(
        "--tenants",
        type=str,
        default="s3-tenant-1,s3-tenant-2",
        help="Comma-separated list of tenant names (default: s3-tenant-1,s3-tenant-2)"
    )
    parser.add_argument(
        "--region",
        type=str,
        default=None,
        help="AWS region (default: from AWS_DEFAULT_REGION env or us-east-1)"
    )
    
    args = parser.parse_args()
    
    # Get bucket from args or env
    bucket = args.bucket or os.environ.get("AWS_S3_BUCKET")
    if not bucket:
        print("Error: --bucket required or set AWS_S3_BUCKET env var")
        print("Add to root .env file: AWS_S3_BUCKET=your-bucket-name")
        sys.exit(1)
    
    # Get region
    region = args.region or os.environ.get("AWS_DEFAULT_REGION") or os.environ.get("AWS_REGION", "us-east-1")
    
    # Get AWS credentials from environment
    aws_access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    aws_secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    
    if not aws_access_key or not aws_secret_key:
        print("Error: AWS credentials not found")
        print("Add to root .env file:")
        print("  AWS_ACCESS_KEY_ID=your-access-key")
        print("  AWS_SECRET_ACCESS_KEY=your-secret-key")
        print("  AWS_DEFAULT_REGION=us-east-1")
        sys.exit(1)
    
    # Parse tenants
    tenants = [t.strip() for t in args.tenants.split(",")]
    if len(tenants) < 2:
        print("Error: Need at least 2 tenants")
        sys.exit(1)
    
    target_docs = {
        tenants[0]: args.target_docs_tenant_1,
        tenants[1]: args.target_docs_tenant_2,
    }
    
    print(f"Configuration:")
    print(f"  Bucket: {bucket}")
    print(f"  Region: {region}")
    print(f"  Tenants: {tenants}")
    print(f"  Target docs: {target_docs}")
    print(f"  Max books: {args.max_books}")
    print()
    
    # Initialize S3 client
    try:
        s3_client = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key
        )
        
        # Create bucket if it doesn't exist
        if not create_s3_bucket(s3_client, bucket, region):
            print("Failed to create/access bucket")
            sys.exit(1)
        
        print(f"✓ Connected to S3 bucket: {bucket}")
    except Exception as e:
        print(f"Error connecting to S3: {e}")
        print("Make sure AWS credentials are configured in root .env file")
        sys.exit(1)
    
    # Discover books
    books = discover_french_romantic_books(args.max_books)
    
    if not books:
        print("No books found!")
        sys.exit(1)
    
    # Download and process books
    cache_dir = Path(__file__).parent.parent / "data" / "s3_seed_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    
    # Check what's already cached
    cached_books = {}
    if cache_dir.exists():
        for cache_file in cache_dir.glob("*.txt"):
            try:
                book_id = int(cache_file.stem)
                cached_books[book_id] = cache_file
            except ValueError:
                continue
    
    print(f"\n📚 Found {len(cached_books)} cached books")
    if cached_books:
        print(f"  Using cached books: {sorted(cached_books.keys())[:10]}{'...' if len(cached_books) > 10 else ''}")
    
    all_documents = []  # List of (book_id, slice_index, title, content)
    
    print("\nProcessing books and creating virtual documents...")
    
    for book in books:
        book_id = book["id"]
        title = book["title"]
        
        # Check cache first
        if book_id in cached_books:
            cache_file = cached_books[book_id]
            print(f"  ✓ Using cached book {book_id}: {title}")
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    text = f.read()
                print(f"    Loaded {len(text)} characters from cache")
            except Exception as e:
                print(f"    ⚠️  Error reading cache, downloading: {e}")
                text = download_book_text(book_id, title, book["text_url"], cache_dir)
        else:
            # Download book if not cached
            text = download_book_text(book_id, title, book["text_url"], cache_dir)
        
        if not text:
            continue
        
        # Slice into documents
        documents = slice_book_into_documents(text)
        print(f"  Sliced into {len(documents)} virtual documents")
        
        # Add to all_documents with metadata
        for idx, doc_content in enumerate(documents):
            all_documents.append({
                "book_id": book_id,
                "slice_index": idx,
                "book_title": title,
                "content": doc_content,
            })
    
    print(f"\nTotal virtual documents created: {len(all_documents)}")
    
    # Shuffle documents for random distribution
    random.shuffle(all_documents)
    
    # Assign documents to tenants
    tenant_docs = {tenant: [] for tenant in tenants}
    doc_counts = {tenant: 0 for tenant in tenants}
    
    for doc in all_documents:
        # Assign to tenant based on target counts
        if doc_counts[tenants[0]] < target_docs[tenants[0]]:
            tenant = tenants[0]
        elif doc_counts[tenants[1]] < target_docs[tenants[1]]:
            tenant = tenants[1]
        else:
            # Both tenants have enough, assign randomly
            tenant = random.choice(tenants)
        
        tenant_docs[tenant].append(doc)
        doc_counts[tenant] += 1
    
    print("\nDocument distribution:")
    for tenant in tenants:
        print(f"  {tenant}: {doc_counts[tenant]} documents")
    
    # Generate files and upload to S3 in parallel
    print("\n🚀 Generating files and uploading to S3 (parallel processing)...")
    
    content_types = {
        "txt": "text/plain",
        "md": "text/markdown",
        "html": "text/html",
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    
    # Prepare all upload tasks
    upload_tasks = []
    for tenant, docs in tenant_docs.items():
        for doc in docs:
            format_type = random.choice(FORMATS)
            folder = random.choice(FOLDER_CATEGORIES)
            filename = generate_filename(
                doc["book_id"],
                doc["slice_index"],
                doc["book_title"],
                format_type
            )
            s3_key = f"{tenant}/{folder}/{filename}"
            upload_tasks.append({
                "tenant": tenant,
                "doc": doc,
                "format_type": format_type,
                "folder": folder,
                "filename": filename,
                "s3_key": s3_key,
                "content_type": content_types[format_type]
            })
    
    print(f"  Prepared {len(upload_tasks)} upload tasks")
    print(f"  Using {min(20, len(upload_tasks))} parallel workers...")
    
    def process_and_upload(task: dict) -> Tuple[bool, str]:
        """Generate file and upload to S3 - runs in parallel"""
        try:
            # Generate file content
            content = generate_file(
                task["doc"]["book_title"],
                task["doc"]["content"],
                task["format_type"]
            )
            
            # Upload to S3
            upload_to_s3(
                s3_client,
                bucket,
                task["s3_key"],
                content,
                task["content_type"]
            )
            return (True, task["s3_key"])
        except Exception as e:
            return (False, f"{task['s3_key']}: {e}")
    
    # Process in parallel with ThreadPoolExecutor
    total_uploaded = 0
    total_failed = 0
    max_workers = min(20, len(upload_tasks))  # Use up to 20 parallel workers
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all tasks
        future_to_task = {
            executor.submit(process_and_upload, task): task 
            for task in upload_tasks
        }
        
        # Process completed tasks
        for future in as_completed(future_to_task):
            success, result = future.result()
            if success:
                total_uploaded += 1
                if total_uploaded % 100 == 0:
                    print(f"  ✓ Uploaded {total_uploaded}/{len(upload_tasks)} files...")
            else:
                total_failed += 1
                if total_failed <= 10:  # Only print first 10 errors
                    print(f"  ❌ Error: {result}")
    
    if total_failed > 10:
        print(f"  ⚠️  ... and {total_failed - 10} more errors (see above)")
    
    print(f"\n✓ Complete! Uploaded {total_uploaded} files to s3://{bucket}/")
    print("\nFiles are organized as:")
    print(f"  s3://{bucket}/<tenant>/<category>/<filename>")
    print("\nExample keys:")
    for tenant in tenants[:2]:
        print(f"  s3://{bucket}/{tenant}/books/12345_0001_les-miserables-a1b2.txt")
        print(f"  s3://{bucket}/{tenant}/reports/12345_0002_les-miserables-c3d4.pdf")


if __name__ == "__main__":
    main()

