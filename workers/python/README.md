# Document Ingestion Workers

Python workers for document ingestion pipeline using RabbitMQ and Elasticsearch with incremental change detection.

## Architecture

```
[Local Folder] → [Producer] → [RabbitMQ Queue] → [Consumer] → [Elasticsearch]
                      ↓
              [PostgreSQL Manifest]
```

1. **Producer** scans folder, compares with manifest, sends only changes to RabbitMQ
2. **RabbitMQ** queues messages (`doc_ingest` queue)
3. **Consumer** reads files, chunks with overlap, bulk indexes to Elasticsearch
4. **Manifest** tracks file state (path, mtime, size, hash) in PostgreSQL

## Change Detection

The producer maintains a manifest table in PostgreSQL that tracks:
- File path and tenant
- Document ID (stable SHA-1 hash)
- Last modified time (mtime)
- File size (bytes)
- Optional content hash (SHA-256)
- Last indexed timestamp
- Deletion status

On each scan, the producer:
1. **Detects new files**: Path not in manifest → enqueue `upsert`
2. **Detects changed files**: mtime/size/hash differ → enqueue `upsert`
3. **Detects deleted files**: Path in manifest but file missing → enqueue `delete`
4. **Skips unchanged files**: No action needed

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

### Producer

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
