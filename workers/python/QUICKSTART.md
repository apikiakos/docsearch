# Quick Start Guide

## 1. Start Services

```bash
docker compose up -d
```

This starts:
- RabbitMQ (ports 5672, 15672)
- Elasticsearch (port 9200)
- PostgreSQL, Redis

Verify RabbitMQ UI: http://localhost:15672 (guest/guest)

## 2. Install Dependencies

```bash
cd workers/python
pip install -r requirements.txt
```

## 3. Test Setup

```bash
python test_setup.py
```

This verifies:
- All packages installed
- RabbitMQ connection
- Elasticsearch connection

## 4. Start Consumer

In one terminal:

```bash
cd workers/python
python consumer.py
```

You should see:
```
[consumer] Waiting for messages. Press Ctrl+C to exit.
```

## 5. Create Test Folder and Add Files

Create a test folder and add some test files:

```bash
# Create test folder
mkdir -p ~/Documents/docsearch-test

# Add test files
echo "This is a test document about search engines." > ~/Documents/docsearch-test/test1.txt
echo "Distributed systems require careful architecture." > ~/Documents/docsearch-test/test2.txt
```

**See `TESTING.md` for detailed testing instructions and where to put files.**

## 6. Run Producer

In another terminal:

```bash
cd workers/python
python producer.py ~/Documents/docsearch-test alex-local
```

**Note**: You can use any folder path. The producer will scan it recursively.

You should see:
```
[producer] Enqueued /path/to/file1.txt
[producer] Enqueued /path/to/file2.txt
[producer] Done. Enqueued 2 files from /path/to/folder
```

## 7. Watch Consumer Process

Back in the consumer terminal, you'll see:
```
[consumer] Processing /path/to/file1.txt (tenant=alex-local, doc=file1)
[consumer] Indexed 3 chunks for /path/to/file1.txt
```

## 8. Verify in Elasticsearch

```bash
# Count documents
curl "http://localhost:9200/docs_alex-local/_count?pretty"

# Search documents
curl "http://localhost:9200/docs_alex-local/_search?q=*&pretty"
```

## Architecture

```
[Folder] → [Producer] → [RabbitMQ: doc_ingest] → [Consumer] → [Elasticsearch: docs_{tenant}]
```

- **Producer**: Scans folder, sends file paths to queue
- **RabbitMQ**: Queues messages (durable, persistent)
- **Consumer**: Reads files, chunks with overlap, bulk indexes

## Message Format

```json
{
  "tenant_id": "alex-local",
  "document_id": "filename",
  "path": "/absolute/path/to/file.txt",
  "mime": "text/plain"
}
```

## Chunking

- Word-based chunking with overlap
- Default: 400 words per chunk, 100 word overlap
- Prevents data loss at boundaries
- Each chunk indexed separately

## Next Steps

- **See `TESTING.md`** for comprehensive testing guide and where to put test files
- Add PDF/DOCX extraction (extend `read_file()`)
- Add file watching for auto re-indexing
- Monitor queue in RabbitMQ UI: http://localhost:15672
- Search via Next.js API: `GET /api/search?q=query&tenant=alex-local`
- Test change detection: modify files and run producer again

