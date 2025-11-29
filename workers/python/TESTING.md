# Testing Guide

## Where to Put Your Test Files

### Recommended Location

Create a test folder in your home directory:

```bash
mkdir -p ~/Documents/docsearch-test
```

Or use any folder you prefer:

```bash
mkdir -p ~/test-documents
# or
mkdir -p /path/to/your/test/folder
```

### Supported File Types

The producer supports these file types:
- **Text files**: `.txt`, `.md`, `.markdown`
- **PDF**: `.pdf` (requires pdfminer.six)
- **Word documents**: `.docx` (requires python-docx)
- **HTML**: `.html`, `.htm`
- **CSV**: `.csv`

**Note**: Currently, the consumer only reads plain text files (UTF-8). PDF and DOCX extraction can be added later.

### Quick Test Setup

1. **Create test folder:**
```bash
mkdir -p ~/Documents/docsearch-test
```

2. **Add some test files:**
```bash
# Create a simple text file
echo "This is a test document about distributed systems and search engines." > ~/Documents/docsearch-test/test1.txt

# Create a markdown file
cat > ~/Documents/docsearch-test/readme.md << EOF
# Test Document

This is a markdown document for testing the document search system.

## Features

- Full-text search
- Multi-tenant support
- Incremental indexing
EOF

# Create another text file
cat > ~/Documents/docsearch-test/article.txt << EOF
Distributed document search systems require careful architecture.

Key components include:
1. Message queues for async processing
2. Search engines for full-text indexing
3. Databases for metadata storage

The system uses Elasticsearch for search, RabbitMQ for queuing, and PostgreSQL for persistence.
EOF
```

3. **Verify files are created:**
```bash
ls -la ~/Documents/docsearch-test
```

## Step-by-Step Testing

### 1. Start Services

```bash
# From project root
docker compose up -d
```

Wait for services to start (about 30 seconds), then verify:
```bash
# Check RabbitMQ
curl http://localhost:15672

# Check Elasticsearch
curl http://localhost:9200
```

### 2. Install Python Dependencies

```bash
cd workers/python
pip install -r requirements.txt
```

### 3. Test Setup

```bash
python test_setup.py
```

Should show:
```
✓ pika installed
✓ elasticsearch installed
✓ RabbitMQ connection successful
✓ Elasticsearch connection successful
```

### 4. Start Consumer (Terminal 1)

```bash
cd workers/python
python consumer.py
```

You should see:
```
[consumer] Waiting for messages. Press Ctrl+C to exit.
```

**Keep this terminal open!**

### 5. Run Producer (Terminal 2)

```bash
cd workers/python
python producer.py ~/Documents/docsearch-test alex-local
```

You should see:
```
[producer] Enqueued NEW: /Users/you/Documents/docsearch-test/test1.txt
[producer] Enqueued NEW: /Users/you/Documents/docsearch-test/readme.md
[producer] Enqueued NEW: /Users/you/Documents/docsearch-test/article.txt
[producer] Scan complete: 3 upserted, 0 skipped, 0 deleted
```

### 6. Watch Consumer Process (Terminal 1)

Back in the consumer terminal, you should see:
```
[consumer] Processing UPSERT: /Users/you/Documents/docsearch-test/test1.txt (tenant=alex-local, doc=abc123...)
[consumer] Deleted old chunks for document abc123...
[consumer] Indexed 1 chunks for /Users/you/Documents/docsearch-test/test1.txt
[consumer] Processing UPSERT: /Users/you/Documents/docsearch-test/readme.md ...
```

### 7. Verify in Elasticsearch

```bash
# Count indexed documents
curl "http://localhost:9200/docs_alex-local/_count?pretty"

# Search for "search"
curl "http://localhost:9200/docs_alex-local/_search?q=search&pretty"

# Get all documents
curl "http://localhost:9200/docs_alex-local/_search?q=*&pretty"
```

### 8. Test Change Detection

**Modify a file:**
```bash
echo "Updated content with new information." >> ~/Documents/docsearch-test/test1.txt
```

**Run producer again:**
```bash
python producer.py ~/Documents/docsearch-test alex-local
```

You should see:
```
[producer] Enqueued UPDATED: /Users/you/Documents/docsearch-test/test1.txt
[producer] Scan complete: 1 upserted, 2 skipped, 0 deleted
```

Notice: Only the changed file was processed!

### 9. Test Deletion

**Delete a file:**
```bash
rm ~/Documents/docsearch-test/article.txt
```

**Run producer again:**
```bash
python producer.py ~/Documents/docsearch-test alex-local
```

You should see:
```
[producer] Enqueued DELETED: /Users/you/Documents/docsearch-test/article.txt
[producer] Scan complete: 0 upserted, 2 skipped, 1 deleted
```

**Check consumer terminal:**
```
[consumer] Processing DELETE: /Users/you/Documents/docsearch-test/article.txt ...
[consumer] Deleted 2 chunks for document xyz789...
```

## Testing via Next.js UI

After indexing, you can search via the web interface:

1. **Start Next.js app:**
```bash
cd apps/web
pnpm dev
```

2. **Login:**
   - Go to http://localhost:3000
   - Login as `admin@example.com` / `admin123`

3. **Search:**
   - Go to http://localhost:3000/dashboard/search
   - Select tenant: `alex-local`
   - Search for terms like "search", "distributed", "system"

## Test Scenarios

### Scenario 1: First Time Indexing
- Create folder with 10 files
- Run producer → all 10 files indexed
- Run producer again → 0 files (all skipped)

### Scenario 2: File Updates
- Modify 2 files
- Run producer → 2 files reindexed, 8 skipped

### Scenario 3: New Files
- Add 3 new files
- Run producer → 3 new files indexed, 10 skipped

### Scenario 4: File Deletions
- Delete 1 file
- Run producer → 1 file deindexed, 9 skipped

### Scenario 5: Mixed Changes
- Add 2 files, modify 1 file, delete 1 file
- Run producer → 2 upserted (new), 1 upserted (updated), 1 deleted

## Troubleshooting

### Files Not Being Indexed

1. **Check file format**: Currently only plain text (UTF-8) is supported
2. **Check file permissions**: Ensure files are readable
3. **Check consumer logs**: Look for errors in consumer terminal

### Consumer Not Processing

1. **Check RabbitMQ**: Visit http://localhost:15672 (guest/guest)
2. **Check queue**: Should see messages in `doc_ingest` queue
3. **Check consumer**: Should be running and connected

### Elasticsearch Not Showing Results

1. **Check index exists**: `curl http://localhost:9200/_cat/indices`
2. **Check documents**: `curl http://localhost:9200/docs_alex-local/_count`
3. **Check consumer logs**: Look for indexing errors

## Recommended Test Folder Structure

```
~/Documents/docsearch-test/
├── test1.txt
├── test2.txt
├── readme.md
├── article.txt
└── subfolder/
    └── nested.txt
```

The producer scans recursively, so subfolders are included automatically.

## Next Steps

Once basic testing works:
1. Add more files to test performance
2. Test with larger files (multi-chunk documents)
3. Test with different file types
4. Test change detection edge cases
5. Integrate with Next.js search UI

