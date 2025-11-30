# Gutendex Producer

The Gutendex producer discovers Gutenberg books from the Gutendex API, downloads them to a local cache, and enqueues them for processing by the consumer.

## Features

- **Change Detection**: Uses manifest system to avoid re-downloading unchanged books
- **Incremental Processing**: Only enqueues new or changed books
- **Local Cache**: Downloads books to `data/gutendex_books/` directory
- **Rate Limiting**: Respects Gutendex API with configurable delays
- **Idempotent**: Safe to run multiple times

## How It Works

1. **Discovery**: Fetches book metadata from Gutendex API
2. **Download**: Downloads plain text versions to local cache
3. **Change Detection**: Compares with manifest to detect new/changed books
4. **Enqueue**: Only enqueues books that need processing (new or changed)
5. **Consumer**: Reads, chunks, and indexes the books

## Setup

1. **Install dependencies** (if not already installed):
```bash
pip install -r requirements.txt
```

2. **Set environment variables** (optional):
```bash
export GUTENBERG_TENANT_ID="gutenberg"  # Default: "gutenberg"
export GUTENDEX_DELAY="2.0"             # Delay between API calls (default: 2.0s)
export MAX_BOOKS="100"                   # Max books per run (default: 100)
export RABBITMQ_URL="amqp://guest:guest@localhost:5672/"
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch"
```

## Usage

**Important**: Always activate the virtual environment first:

```bash
cd workers/python
source venv/bin/activate
```

### Basic Usage

```bash
python gutendex_producer.py
```

This will process up to 100 books (default).

### Custom Limit

```bash
python gutendex_producer.py 50
```

Process up to 50 books.

### Using Helper Script

Alternatively, use the helper script (automatically activates venv):

```bash
./run_gutendex.sh 50
```

### First Run

On the first run:
- Discovers books from Gutendex API
- Downloads plain text versions to `data/gutendex_books/`
- Enqueues all books for processing
- Updates manifest with file fingerprints

### Subsequent Runs

On subsequent runs:
- Checks manifest to see which books are already downloaded
- Only downloads new books or books that changed
- Only enqueues books that need re-indexing (new or changed)
- Skips unchanged books

## Integration with Consumer

The consumer automatically:
- Reads the book files from the cache directory
- Chunks them using word-based chunking (400 words/chunk, 100 word overlap)
- Indexes chunks to Elasticsearch with metadata (title, book_id, source)
- Handles both local files and remote URLs

## Chunking Details

- **Chunk Size**: 400 words per chunk
- **Overlap**: 100 words between chunks
- **Method**: Word-based splitting (preserves word boundaries)
- **Purpose**: Prevents data loss at chunk boundaries, improves search relevance

## File Structure

```
workers/
  python/
    gutendex_producer.py
    consumer.py
    chunking.py
    ...
data/
  gutendex_books/
    1342_Pride_and_Prejudice.txt
    11_Alice_s_Adventures_in_Wonderland.txt
    ...
```

## Message Format

Messages sent to RabbitMQ:

```json
{
  "operation": "upsert",
  "tenant_id": "gutenberg",
  "document_id": "sha1_hash",
  "path": "/path/to/data/gutendex_books/1342_Pride_and_Prejudice.txt",
  "mime": "text/plain",
  "producer_timestamp": "2024-01-01T00:00:00Z",
  "metadata": {
    "title": "Pride and Prejudice",
    "source": "gutendex",
    "book_id": 1342
  }
}
```

## Verify

Check indexed books:
```bash
curl "http://localhost:9200/docs_gutenberg/_search?pretty&q=title:Pride"
```

Count indexed chunks:
```bash
curl "http://localhost:9200/docs_gutenberg/_count"
```

## Production Considerations

- **Rate Limiting**: Default 2s delay between API calls (be gentle with Gutendex)
- **Batch Size**: Process in batches (e.g., 100 books at a time)
- **Error Handling**: Failed downloads are skipped, not retried automatically
- **Storage**: Books are cached locally - ensure sufficient disk space
- **Monitoring**: Check RabbitMQ queue size and consumer processing rate

## Troubleshooting

**Books not downloading:**
- Check internet connection
- Verify Gutendex API is accessible
- Check rate limiting (increase `GUTENDEX_DELAY` if needed)

**Books not indexing:**
- Ensure consumer is running
- Check RabbitMQ queue for messages
- Verify Elasticsearch is running and accessible

**Duplicate indexing:**
- Check manifest table to see if books are marked as indexed
- Verify change detection is working (compare file mtime/size)

