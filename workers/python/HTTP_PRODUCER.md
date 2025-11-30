# HTTP Producer

The HTTP producer fetches remote resources (e.g., from Gutenberg, S3, or other HTTP sources) and uses ETags for efficient change detection.

## Features

- **ETag-based change detection**: Uses HTTP ETags to avoid unnecessary downloads
- **304 Not Modified handling**: Skips reindexing when resources haven't changed
- **Idempotent operations**: Safe to run multiple times
- **Automatic cleanup**: Temporary files are cleaned up after processing

## How It Works

1. **First Run**: 
   - Fetches resource without `If-None-Match` header
   - Downloads content, stores ETag in manifest
   - Enqueues for indexing

2. **Subsequent Runs**:
   - Sends `If-None-Match` header with stored ETag
   - If server returns `304 Not Modified`: Skip download and indexing
   - If server returns `200 OK` with new ETag: Download, update manifest, reindex

## Usage

### Single URL

```bash
python http_producer.py https://www.gutenberg.org/files/1342/1342-0.txt gutenberg
```

### Multiple URLs

```bash
python http_producer.py \
  https://www.gutenberg.org/files/1342/1342-0.txt \
  https://www.gutenberg.org/files/11/11-0.txt \
  gutenberg
```

### URLs from File

Create a file `urls.txt`:
```
https://www.gutenberg.org/files/1342/1342-0.txt
https://www.gutenberg.org/files/11/11-0.txt
# Comments are ignored
```

Then run:
```bash
python http_producer.py --file urls.txt gutenberg
```

## Environment Variables

- `RABBITMQ_URL`: RabbitMQ connection URL (default: `amqp://guest:guest@localhost:5672/`)
- `DATABASE_URL`: PostgreSQL connection URL (default: `postgresql://postgres:postgres@localhost:5432/docsearch`)

## Example Workflow

1. **First ingestion**:
   ```bash
   python http_producer.py https://example.com/doc.txt my-tenant
   ```
   - Downloads `doc.txt`
   - Stores ETag in manifest
   - Enqueues for indexing

2. **Second run (no changes)**:
   ```bash
   python http_producer.py https://example.com/doc.txt my-tenant
   ```
   - Server returns `304 Not Modified`
   - Skips download and indexing
   - Logs: `Resource unchanged (304): https://example.com/doc.txt`

3. **After resource update**:
   ```bash
   python http_producer.py https://example.com/doc.txt my-tenant
   ```
   - Server returns `200 OK` with new ETag
   - Downloads updated content
   - Updates manifest with new ETag
   - Reindexes document

## Integration with Consumer

The consumer automatically:
- Processes temporary files from HTTP producer
- Cleans up temporary files after indexing
- Handles both local files and remote downloads

## Notes

- ETags are stored per resource URL in the manifest table
- Temporary files are created in the system temp directory
- The consumer is responsible for cleaning up temporary files
- If a resource doesn't support ETags, it will be re-downloaded on each run

