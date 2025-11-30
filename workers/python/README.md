# Document Ingestion Workers

Python workers for document ingestion pipeline using RabbitMQ and Elasticsearch with incremental change detection.

## Architecture

```
[Local Folder] → [Producer] → [RabbitMQ Queue] → [Consumer] → [Elasticsearch]
[HTTP Sources] → [HTTP Producer] → [RabbitMQ Queue] → [Consumer] → [Elasticsearch]
                      ↓
              [PostgreSQL Manifest]
```

1. **Producer** (local): Scans folder, compares with manifest, sends only changes to RabbitMQ
2. **HTTP Producer** (remote): Fetches HTTP resources using ETags, sends only changed resources to RabbitMQ
3. **S3 Producer** (S3 bucket): Discovers documents from S3, downloads to local cache, uses ETags for change detection
4. **RabbitMQ** queues messages (`doc_ingest` queue)
5. **Consumer** reads files, chunks with overlap, bulk indexes to Elasticsearch
6. **Manifest** tracks file state (path, mtime, size, hash, etag) in PostgreSQL

## Change Detection

The producer maintains a manifest table in PostgreSQL that tracks:
- File path and tenant
- Document ID (stable SHA-1 hash)
- Last modified time (mtime)
- File size (bytes)
- Optional content hash (SHA-256)
- HTTP ETag (for remote sources)
- Last indexed timestamp
- Deletion status

### Local Files (Producer)

On each scan, the producer:
1. **Detects new files**: Path not in manifest → enqueue `upsert`
2. **Detects changed files**: mtime/size/hash differ → enqueue `upsert`
3. **Detects deleted files**: Path in manifest but file missing → enqueue `delete`
4. **Skips unchanged files**: No action needed

### Remote HTTP Sources (HTTP Producer)

For remote resources (e.g., Gutenberg, S3, HTTP feeds):
1. **First run**: Fetches resource, stores ETag in manifest, enqueues `upsert`
2. **Subsequent runs**: Sends `If-None-Match` header with stored ETag
   - If `304 Not Modified`: Skips download and indexing
   - If `200 OK` with new ETag: Downloads, updates manifest, enqueues `upsert`
3. **Efficient**: Only downloads when content actually changes

## Setup

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
pip install -r requirements.txt
```

4. **Set database URL** (if different from default):
```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch"
```

## Usage

### Producer (Local Files)

Scans a folder, detects changes, and enqueues only new/changed/deleted files:

```bash
python producer.py <folder_path> <tenant_id>
```

Example:
```bash
python producer.py /Users/you/Documents/docsearch alex-local
```

**First run**: All files are detected as new and enqueued.

**Subsequent runs**: Only changed files are enqueued.

### S3 Producer

Discovers documents from S3 buckets and enqueues them for processing:

```bash
# Process documents for s3-tenant-1
python s3_producer.py s3-tenant-1

# Process documents for s3-tenant-2
python s3_producer.py s3-tenant-2
```

**Features:**
- Discovers all documents in S3 bucket for a tenant
- Downloads documents to local cache (`workers/data/s3_downloads/`)
- Uses **S3 ETags** for change detection (avoids re-downloading unchanged files)
- Enqueues local file paths to RabbitMQ
- Tracks state in manifest database

**Testing:**
Use `test_s3_producer.py` to test S3 access and verify MIME type and ETag extraction:
```bash
python test_s3_producer.py  # Random document
python test_s3_producer.py "s3-tenant-1/books/file.txt"  # Specific document
```

See [S3_PRODUCER.md](./S3_PRODUCER.md) for detailed documentation.

### HTTP Producer (Remote Sources)

Fetches remote HTTP resources using ETags for change detection:

```bash
# Single URL
python http_producer.py https://www.gutenberg.org/files/1342/1342-0.txt gutenberg

# Multiple URLs
python http_producer.py \
  https://www.gutenberg.org/files/1342/1342-0.txt \
  https://www.gutenberg.org/files/11/11-0.txt \
  gutenberg

# URLs from file
python http_producer.py --file urls.txt gutenberg
```

**First run**: Downloads resource, stores ETag, enqueues for indexing.

**Subsequent runs**: 
- If resource unchanged (304): Skips download and indexing
- If resource changed (200): Downloads, updates ETag, reindexes

See [HTTP_PRODUCER.md](./HTTP_PRODUCER.md) for detailed documentation.

### S3 Seeding Tool

Populates an S3 bucket with French romantic literature documents for testing multi-tenant scenarios.

The tool:
1. Fetches French romantic books from Gutendex (50 books by default)
2. Downloads plain text versions
3. Slices each book into "virtual documents" (2-5 paragraphs, ~250-500 words each)
4. Generates files in random formats (txt, md, html, pdf, docx)
5. Uploads to S3 with proper folder structure (invoices/, reports/, legal/, books/)
6. Distributes documents across multiple tenants

**Prerequisites:**
```bash
# Install additional dependencies
pip install boto3 reportlab python-dotenv

# Configure AWS credentials (add to root .env file)
# Create .env in project root with:
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_DEFAULT_REGION="us-east-1"
AWS_S3_BUCKET="your-bucket-name"
```

**Note**: The script automatically loads environment variables from the root `.env` file. The bucket will be created automatically if it doesn't exist.

**Usage:**
```bash
# Basic usage (defaults: 2000 docs for tenant1, 3000 for tenant2)
python seed_s3_from_gutendex.py --bucket my-bucket-name

# Custom configuration
python seed_s3_from_gutendex.py \
  --bucket my-bucket-name \
  --max-books 50 \
  --target-docs-tenant-1 2000 \
  --target-docs-tenant-2 3000 \
  --tenants s3-tenant-1,s3-tenant-2 \
  --region us-west-2
```

**S3 Structure:**
```
s3://my-bucket/
  s3-tenant-1/
    invoices/
      12345_0001_les-miserables-a1b2.txt
      12345_0002_les-miserables-c3d4.pdf
    reports/
      12345_0003_les-miserables-e5f6.html
    legal/
    books/
  s3-tenant-2/
    invoices/
    reports/
    legal/
    books/
```

**File Formats:**
- **txt**: Plain text with title
- **md**: Markdown with level-1 heading
- **html**: Minimal HTML with `<h1>` and `<p>` tags
- **pdf**: PDF with title and paragraphs (using reportlab)
- **docx**: DOCX with title and paragraphs (using python-docx)

**Example Output:**
```
Configuration:
  Bucket: my-bucket
  Region: us-east-1
  Tenants: ['s3-tenant-1', 's3-tenant-2']
  Target docs: {'s3-tenant-1': 2000, 's3-tenant-2': 3000}
  Max books: 50

Discovering French romantic literature books...
  Found: Les Misérables (ID: 12345)
  Found: Notre-Dame de Paris (ID: 12346)
  ...

Processing books and creating virtual documents...
  Sliced into 45 virtual documents
  ...

Document distribution:
  s3-tenant-1: 2000 documents
  s3-tenant-2: 3000 documents

✓ Complete! Uploaded 5000 files to s3://my-bucket/
```

### Consumer

Consumes messages, chunks files, and indexes to Elasticsearch:

```bash
ELASTIC_URL=http://localhost:9200 python consumer.py
```

Or with default:
```bash
python consumer.py
```

## Message Format

Messages sent to RabbitMQ include an `operation` field:

**Upsert (new or changed file):**
```json
{
  "operation": "upsert",
  "tenant_id": "alex-local",
  "document_id": "sha1_hash",
  "path": "/absolute/path/to/file.txt",
  "mime": "text/plain"
}
```

**Delete (removed file):**
```json
{
  "operation": "delete",
  "tenant_id": "alex-local",
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

## Content Hash (Optional)

For stronger change detection, enable content hashing:

```bash
export USE_CONTENT_HASH=true
python producer.py <folder> <tenant>
```

Note: This computes SHA-256 hash of file contents, which can be slow for large files.

## Elasticsearch Indexes

- Index name: `docs_{tenant_id}`
- Each chunk indexed as: `{document_id}#chunk_{chunk_index}`
- Automatically created if doesn't exist

## Verify

Check indexed documents:
```bash
curl "http://localhost:9200/docs_alex-local/_search?pretty"
```

Count documents:
```bash
curl "http://localhost:9200/docs_alex-local/_count"
```

Check manifest:
```sql
SELECT * FROM file_manifest WHERE tenant_id = 'alex-local';
```

## Production Considerations

### Periodic Scanning

The current implementation uses periodic full scans. For production:

1. **Schedule scans**: Run producer via cron/systemd timer
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
