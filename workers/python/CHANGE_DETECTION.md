# Change Detection Implementation

## Overview

The producer now implements incremental change detection to avoid reindexing unchanged documents. It maintains a manifest table in PostgreSQL that tracks file state and compares it with the current filesystem on each scan.

## Architecture

```
┌─────────────┐
│   Folder    │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────┐
│    Producer     │────▶│  PostgreSQL  │
│  (scans &       │     │   Manifest   │
│   compares)     │◀────│    Table     │
└──────┬──────────┘     └──────────────┘
       │
       │ (only changes)
       ▼
┌──────────────┐
│  RabbitMQ    │
│  doc_ingest  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Consumer   │
│  (indexes)   │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Elasticsearch│
└──────────────┘
```

## Components

### 1. Manifest Table (PostgreSQL)

Stores file state for comparison:

```sql
CREATE TABLE file_manifest (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  path TEXT NOT NULL,
  document_id TEXT NOT NULL,
  last_mtime TIMESTAMP WITH TIME ZONE NOT NULL,
  size_bytes BIGINT NOT NULL,
  content_hash TEXT,  -- Optional SHA-256
  last_indexed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (tenant_id, path)
);
```

### 2. Document Identity

Stable document ID generated from tenant + path:

```python
document_id = sha1(f"{tenant_id}:{path}")
```

This ensures:
- Same file always gets same document_id
- Works across renames (if path changes, new ID)
- Deterministic and consistent

### 3. File Fingerprint

Three-part fingerprint to detect changes:

1. **mtime** (last modified time) - Fast, OS-provided
2. **size_bytes** - Quick check
3. **content_hash** (optional SHA-256) - Strong guarantee

Default uses mtime + size. Enable content hash for stronger detection:

```bash
export USE_CONTENT_HASH=true
```

### 4. Change Detection Algorithm

```python
for each file in folder:
    compute current fingerprint (mtime, size, hash)
    lookup in manifest
    
    if not in manifest:
        → NEW FILE: enqueue upsert, insert manifest
    
    else if fingerprint changed:
        → CHANGED FILE: enqueue upsert, update manifest
    
    else:
        → UNCHANGED: skip

for each manifest entry:
    if file not on disk:
        → DELETED FILE: enqueue delete, mark deleted
```

## Message Operations

### Upsert Operation

Sent for new or changed files:

```json
{
  "operation": "upsert",
  "tenant_id": "alex-local",
  "document_id": "abc123...",
  "path": "/path/to/file.txt",
  "mime": "text/plain"
}
```

Consumer behavior:
1. Delete all existing chunks for `document_id`
2. Read file and chunk it
3. Bulk index new chunks

### Delete Operation

Sent for deleted files:

```json
{
  "operation": "delete",
  "tenant_id": "alex-local",
  "document_id": "abc123...",
  "path": "/path/to/file.txt"
}
```

Consumer behavior:
1. Delete all chunks for `document_id` from Elasticsearch

## Benefits

✅ **Incremental**: Only changed files are processed  
✅ **Efficient**: Skips unchanged files (no I/O, no indexing)  
✅ **Idempotent**: Safe to re-run producer  
✅ **Accurate**: Detects creates, updates, deletes  
✅ **Fast**: mtime/size comparison is very quick  
✅ **Reliable**: Optional content hash for strong guarantees

## Usage Example

```bash
# First run: indexes all files
python producer.py ~/Documents/docsearch alex-local
# Output: Enqueued 100 files

# Second run (no changes): skips all files
python producer.py ~/Documents/docsearch alex-local
# Output: Scan complete: 0 upserted, 100 skipped, 0 deleted

# Modify a file, then run again: only changed file indexed
python producer.py ~/Documents/docsearch alex-local
# Output: Enqueued UPDATED: /path/to/changed.txt
#         Scan complete: 1 upserted, 99 skipped, 0 deleted

# Delete a file, then run: deleted file deindexed
python producer.py ~/Documents/docsearch alex-local
# Output: Enqueued DELETED: /path/to/deleted.txt
#         Scan complete: 0 upserted, 99 skipped, 1 deleted
```

## Production Enhancements

### Periodic Scanning (Current)

Run producer on schedule:

```bash
# Cron job: every hour
0 * * * * cd /path/to/workers/python && python producer.py /folder tenant
```

### File Watching (Future)

Add real-time detection with `watchdog`:

```python
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Watch for file system events
# Still run periodic full scan as safety net
```

### Reconciliation

Periodic full scan ensures correctness:
- Catches missed events
- Handles edge cases
- Validates manifest state

## Interview Talking Points

**About avoiding reindexing:**
> "The producer maintains a manifest of all previously indexed files (path, last-modified time, size, and optionally a hash). On each scan, it compares the current filesystem state to the manifest and enqueues jobs only for new, changed, or deleted files. This makes ingestion incremental and idempotent rather than reindexing everything on every run."

**About detection:**
> "File creation is detected when a path appears that has no manifest entry; updates are detected when the file's last-modified time or size differ from the manifest; deletions are detected when a manifest entry no longer has a corresponding file on disk. Each of these changes is translated into an upsert or delete ingestion job for the consumer, which updates the Elasticsearch index accordingly."

