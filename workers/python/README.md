# Document Ingestion Workers

Python workers for document ingestion pipeline using RabbitMQ and Elasticsearch with incremental change detection.

## Table of Contents

- [Architecture](#architecture)
- [Setup](#setup)
- [Producers](#producers)
- [Consumer](#consumer)
- [Change Detection](#change-detection)
- [Document Extraction](#document-extraction)
- [Elasticsearch Schema](#elasticsearch-schema)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Architecture

```
[Sources] → [Producers] → [RabbitMQ Queue] → [Consumer] → [Elasticsearch]
                      ↓
              [PostgreSQL Manifest]
```

1. **Producers**: Discover documents from various sources, compare with manifest, send only changes to RabbitMQ
2. **RabbitMQ**: Queues messages (`doc_ingest` queue)
3. **Consumer**: Processes queued documents, extracts text, chunks content, and indexes to Elasticsearch
4. **Manifest**: Tracks document state (path, mtime, size, hash, etag) in PostgreSQL

## Setup

### Prerequisites

1. **Start Docker services:**
   ```bash
   docker compose up -d
   ```

2. **Run Prisma migration** (to create manifest table):
   ```bash
   cd apps/web
   pnpm db:push
   ```

3. **Install Python dependencies:**
   ```bash
   cd workers/python
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

4. **Verify setup:**
   ```bash
   python test_setup.py
   ```

   This should verify:
   - All packages installed correctly
   - RabbitMQ connection works
   - Elasticsearch connection works
   - PostgreSQL connection works

### Environment Variables

Set in root `.env` file:

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch?schema=public"

# RabbitMQ
RABBITMQ_URL="amqp://guest:guest@localhost:5672/%2F"
RABBITMQ_QUEUE_NAME="doc_ingest"

# Elasticsearch
ELASTICSEARCH_URL="http://localhost:9200"

# AWS S3 (for S3 producer)
AWS_ACCESS_KEY_ID="your-access-key-id"
AWS_SECRET_ACCESS_KEY="your-secret-access-key"
AWS_DEFAULT_REGION="eu-west-1"
AWS_S3_BUCKET="document-search-tenants"
```

## Producers

### Gutenberg Producer

Discovers books from Project Gutenberg via Gutendex API and enqueues them for processing.

**Usage:**
```bash
cd workers/python
source venv/bin/activate

# Fetch new books (default: 5 books)
python gutenberg_producer.py --fetch-new 10

# Check existing documents
python gutenberg_producer.py --check-existing

# Force reindex all
python gutenberg_producer.py --force-reindex
```

**Features:**
- Uses manifest system to avoid re-downloading unchanged books
- Downloads books to local cache (`workers/data/gutendex_books/`)
- Rate limiting (2s delay between API calls)
- Idempotent: Safe to run multiple times

**Configuration:**
- `MAX_BOOKS`: Maximum books to process per run (default: 5)
- `GUTENDEX_DELAY`: Delay between API calls in seconds (default: 2.0)

### S3 Producer

Discovers documents from S3 buckets and enqueues them for processing.

**Usage:**
```bash
cd workers/python
source venv/bin/activate

# Process documents for a tenant
python s3_producer.py s3-tenant-1

# Fetch only new documents
python s3_producer.py s3-tenant-1 --fetch-new 100

# Check existing documents
python s3_producer.py s3-tenant-1 --check-existing

# Force reindex all
python s3_producer.py s3-tenant-1 --force-reindex
```

**Features:**
- Discovers all documents in S3 bucket for a tenant
- Downloads documents to local cache (`workers/data/s3_downloads/`)
- Uses **S3 ETags** for change detection (avoids re-downloading unchanged files)
- Enqueues local file paths to RabbitMQ
- Tracks state in manifest database

**S3 Structure:**
```
s3://bucket-name/
  s3-tenant-1/
    books/
    invoices/
    reports/
    legal/
  s3-tenant-2/
    books/
    invoices/
    ...
```

**Testing:**
```bash
# Test S3 access and document extraction
python test_s3_producer.py

# Test specific document
python test_s3_producer.py "s3-tenant-1/books/file.txt"
```

### Uploads Producer

Processes documents uploaded via the web UI to S3 `uploads/{tenant}/` folders.

**Usage:**
```bash
cd workers/python
source venv/bin/activate

# Process uploads for all tenants
python uploads_producer.py

# Process uploads for specific tenant
python uploads_producer.py --tenant s3-tenant-1
```

**Features:**
- Scans `uploads/{tenant}/` folders in S3
- Processes documents uploaded via web interface
- Uses manifest for change detection
- Automatically triggered after document uploads

### GovDocs Producer

Processes government documents from a local folder.

**Usage:**
```bash
cd workers/python
source venv/bin/activate

# Process documents
python govdocs_producer.py

# Fetch only new documents
python govdocs_producer.py --fetch-new 100

# Check existing documents
python govdocs_producer.py --check-existing

# Force reindex all
python govdocs_producer.py --force-reindex
```

## Consumer

The consumer processes messages from RabbitMQ, extracts text, chunks content, and indexes to Elasticsearch.

**Usage:**
```bash
cd workers/python
source venv/bin/activate
python consumer.py
```

**What it does:**
1. Listens to RabbitMQ `doc_ingest` queue
2. Processes queued documents
3. Extracts text from files (PDF, DOCX, HTML, plain text, etc.)
4. Chunks content with overlap (400 words/chunk, 100 word overlap)
5. Bulk indexes chunks to Elasticsearch
6. Updates manifest with indexing status

**Keep this running** while ingesting documents.

## Change Detection

The system uses incremental change detection to avoid reindexing unchanged documents.

### Manifest Table

Stores file state in PostgreSQL:

```sql
CREATE TABLE file_manifest (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  path TEXT NOT NULL,
  document_id TEXT NOT NULL,
  last_mtime TIMESTAMP WITH TIME ZONE NOT NULL,
  size_bytes BIGINT NOT NULL,
  content_hash TEXT,  -- Optional SHA-256
  s3_etag TEXT,       -- For S3 objects
  last_indexed_at TIMESTAMP WITH TIME ZONE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id, path)
);
```

### Change Detection Algorithm

1. **New files**: Path not in manifest → enqueue `upsert`
2. **Changed files**: mtime/size/hash/etag differ → enqueue `upsert`
3. **Deleted files**: Path in manifest but file missing → enqueue `delete`
4. **Unchanged files**: No action needed

### Document Identity

Stable document ID generated from tenant + path:
```python
document_id = sha1(f"{tenant_id}:{path}")
```

This ensures:
- Same file always gets same document_id
- Works across renames (if path changes, new ID)
- Deterministic and consistent

### Benefits

✅ **Incremental**: Only changed files are processed  
✅ **Efficient**: Skips unchanged files (no I/O, no indexing)  
✅ **Idempotent**: Safe to re-run producers  
✅ **Accurate**: Detects creates, updates, deletes  
✅ **Fast**: mtime/size comparison is very quick  

## Document Extraction

The consumer uses `document_extractor.py` to extract text from various file formats.

### Supported Formats

**Fully Supported:**
- **text/plain** (.txt) - Direct file reading
- **text/markdown** (.md, .markdown) - Direct file reading
- **application/pdf** (.pdf) - Uses `pdfminer.six`
- **text/html** (.html, .htm) - Uses `beautifulsoup4` with proper tag stripping
- **application/vnd.openxmlformats-officedocument.wordprocessingml.document** (.docx) - Uses `python-docx` (extracts paragraphs and tables)

**Partially Supported:**
- **application/msword** (.doc) - Old Word format
  - **Best**: Install `antiword` command-line tool for full support
  - **Alternative**: Install `textract` Python library
  - **Fallback**: Basic binary text extraction (limited success)

### MIME Type Detection

Producers detect MIME types using:
1. **python-magic** (libmagic) - Reads actual file content (most accurate)
2. **File extension** - Fallback if python-magic not available
3. **HTTP Content-Type header** - For remote resources

The consumer uses the MIME type from the RabbitMQ message to select the appropriate extraction method.

### HTML Extraction Details

The HTML extractor:
- Removes: `script`, `style`, `noscript`, `iframe`, `embed`, `object`, `meta`, `link`, `head`, `title`
- Removes HTML comments
- Preserves structure from: `p`, `h1-h6`, `li`, `td`, `th`, `div`, `span`
- Extracts text with proper line breaks
- Cleans up excessive whitespace
- Extracts meta tags (title, description, keywords, author, OG tags, etc.)

### DOCX Extraction Details

The DOCX extractor:
- Extracts all paragraphs
- Extracts tables (cell by cell, row by row)
- Preserves structure with line breaks

### Error Handling

If extraction fails:
- Logs error with traceback
- Returns empty string
- Consumer skips indexing (logs warning)

## Elasticsearch Schema

### Index Pattern

Each tenant has its own index: `docs_{tenant_id}`

Example: `docs_gutenberg`, `docs_s3-tenant-1`, `docs_govdocs`

### Document Structure

Each document represents a **chunk** of a larger file. Multiple chunks are created from a single source file.

```json
{
  "id": "document_id#chunk_0",
  "document_id": "sha1_hash_of_tenant_path",
  "tenant_id": "gutenberg",
  "chunk_index": 0,
  "chunk_offset": 0,
  "title": "Pride and Prejudice",
  "content": "It is a truth universally...",
  "metadata": {
    "filename": "pride_and_prejudice.txt",
    "mime": "text/plain",
    "source": "gutendex",
    "originalUrl": null,
    "book_id": 1342,
    "html_meta": null
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "producer_timestamp": "2024-01-01T00:00:00Z",
  "producer_scan_time": 0.123,
  "queue_time": 45.67,
  "extraction_time": 12.34,
  "chunking_time": 5.67,
  "es_delete_time": 2.34,
  "es_indexing_time": 8.90
}
```

### Field Types

**Text Fields (Searchable):**
- `title` - Full-text searchable, also has `.keyword` sub-field for exact matches
- `content` - Main searchable content (chunk text)
- `metadata.html_meta.title` - Searchable HTML title
- `metadata.html_meta.description` - Searchable HTML description

**Keyword Fields (Exact Match):**
- `id`, `document_id`, `tenant_id` - Identifiers
- `metadata.filename`, `metadata.mime`, `metadata.source` - File metadata
- `metadata.originalUrl`, `metadata.html_meta.url` - URLs

**Numeric Fields:**
- `chunk_index`, `chunk_offset` - Integers
- `metadata.book_id` - Integer (Gutenberg books)
- Timing fields - Floats (milliseconds or seconds)

**Date Fields:**
- `created_at`, `updated_at`, `producer_timestamp` - ISO 8601 dates

## Testing

### Quick Test Setup

1. **Create test folder:**
   ```bash
   mkdir -p ~/Documents/docsearch-test
   ```

2. **Add test files:**
   ```bash
   echo "This is a test document about search engines." > ~/Documents/docsearch-test/test1.txt
   echo "Distributed systems require careful architecture." > ~/Documents/docsearch-test/test2.txt
   ```

3. **Start consumer** (Terminal 1):
   ```bash
   cd workers/python
   source venv/bin/activate
   python consumer.py
   ```

4. **Run producer** (Terminal 2):
   ```bash
   cd workers/python
   source venv/bin/activate
   python s3_producer.py s3-tenant-1 --fetch-new 10
   ```

5. **Verify in Elasticsearch:**
   ```bash
   # Count documents
   curl "http://localhost:9200/docs_s3-tenant-1/_count?pretty"

   # Search documents
   curl "http://localhost:9200/docs_s3-tenant-1/_search?q=search&pretty"
   ```

### Test Change Detection

1. **First run**: All files are detected as new and enqueued
2. **Second run** (no changes): All files are skipped
3. **Modify a file**, then run again: Only changed file is reindexed
4. **Delete a file**, then run again: Deleted file is deindexed

### Verify Setup

```bash
# Test all connections
python test_setup.py

# Should show:
# ✓ pika installed
# ✓ elasticsearch installed
# ✓ RabbitMQ connection successful
# ✓ Elasticsearch connection successful
# ✓ PostgreSQL connection successful
```

## Troubleshooting

### Consumer Not Processing Messages

1. **Check RabbitMQ queue**:
   - Visit http://localhost:15672 (guest/guest)
   - Go to "Queues" tab
   - Check `doc_ingest` queue has messages

2. **Check consumer logs** for errors

3. **Verify Python dependencies**:
   ```bash
   python test_setup.py
   ```

### Files Not Being Indexed

1. **Check file format**: Supported formats are PDF, DOCX, HTML, plain text
2. **Check file permissions**: Ensure files are readable
3. **Check consumer logs**: Look for errors in consumer terminal
4. **Check MIME type detection**: Verify correct MIME type is detected

### Elasticsearch Not Showing Results

1. **Check index exists**: `curl http://localhost:9200/_cat/indices`
2. **Check documents**: `curl http://localhost:9200/docs_{tenant}/_count`
3. **Check consumer logs**: Look for indexing errors

### Producer Not Finding Documents

1. **Check S3 access** (for S3 producer):
   ```bash
   python test_s3_producer.py
   ```

2. **Check manifest table**:
   ```sql
   SELECT * FROM file_manifest WHERE tenant_id = 's3-tenant-1';
   ```

3. **Check producer logs** for errors

### Common Errors

**"ModuleNotFoundError: No module named 'pika'"**
- Solution: Activate venv and install dependencies
  ```bash
  source venv/bin/activate
  pip install -r requirements.txt
  ```

**"ERROR: Could not find a version that satisfies the requirement requirements.txt"**
- Solution: Use `-r` flag: `pip install -r requirements.txt` (not `pip install requirements.txt`)

**"Connection refused" errors**
- Check Docker services are running: `docker compose ps`
- Verify environment variables are set correctly

## Message Format

Messages sent to RabbitMQ include an `operation` field:

**Upsert (new or changed file):**
```json
{
  "operation": "upsert",
  "tenant_id": "s3-tenant-1",
  "document_id": "sha1_hash",
  "path": "/absolute/path/to/file.txt",
  "mime": "text/plain",
  "metadata": {
    "filename": "file.txt",
    "source": "s3"
  }
}
```

**Delete (removed file):**
```json
{
  "operation": "delete",
  "tenant_id": "s3-tenant-1",
  "document_id": "sha1_hash",
  "path": "/absolute/path/to/file.txt"
}
```

## Chunking

- **Word-based chunking** with overlap
- Default: 400 words per chunk, 100 word overlap
- Prevents data loss at boundaries
- Configurable in `chunking.py`

## Idempotent Operations

- **Upsert**: Deletes old chunks, then indexes new chunks
- **Delete**: Removes all chunks for a document
- Uses `delete_by_query` for clean reindexing

## Production Considerations

### Periodic Scanning

The current implementation uses periodic full scans. For production:

1. **Schedule scans**: Run producers via cron/systemd timer
2. **Add file watching**: Use `watchdog` library for real-time events
3. **Reconciliation**: Periodic full scan as safety net

### File Watching (Future Enhancement)

```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class FileChangeHandler(FileSystemEventHandler):
    def on_created(self, event):
        # Enqueue upsert
    def on_modified(self, event):
        # Enqueue upsert
    def on_deleted(self, event):
        # Enqueue delete
```

Even with file watching, keep periodic scans for correctness.

## Key Features

✅ **Incremental indexing**: Only changed files are processed  
✅ **No duplicate work**: Unchanged files are skipped  
✅ **Deletion handling**: Removed files are deindexed  
✅ **Stable document IDs**: SHA-1 hash ensures consistency  
✅ **Idempotent operations**: Safe to re-run  
✅ **Bulk indexing**: Efficient batch processing  
✅ **Overlapping chunks**: Prevents data loss at boundaries  
✅ **Multi-format support**: PDF, DOCX, HTML, plain text  
✅ **Change detection**: ETag, mtime, size, content hash  
