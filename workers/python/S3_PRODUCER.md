# S3 Producer

Producer that discovers documents from S3 buckets and enqueues them for processing.

## Overview

The S3 producer:
1. **Discovers** documents in an S3 bucket for a specific tenant
2. **Downloads** documents to local cache
3. **Detects changes** using ETag and file fingerprinting
4. **Enqueues** local file paths to RabbitMQ for processing

## Architecture

Following the producer/consumer separation:
- **Producer responsibility**: Discover where documents live (S3), fetch raw bytes, store in local storage
- **Consumer responsibility**: Process stored files (extract text, chunk, index)

## Usage

```bash
# Process documents for s3-tenant-1
python s3_producer.py s3-tenant-1

# Process documents for s3-tenant-2
python s3_producer.py s3-tenant-2
```

## Configuration

Set in root `.env` file:

```env
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_DEFAULT_REGION="eu-west-1"
AWS_S3_BUCKET="document-search-tenants"
```

## Change Detection

The producer uses:
- **ETag**: S3 object ETag for change detection (from S3 metadata)
- **File fingerprinting**: mtime, size, content hash (for local cached files)
- **Manifest database**: Tracks which documents have been processed

## Testing

Use `test_s3_producer.py` to test S3 access and document extraction:

```bash
# Test with random document
python test_s3_producer.py

# Test with specific document
python test_s3_producer.py "s3-tenant-1/books/file.txt"
```

The test script verifies:
- ✅ S3 access and authentication
- ✅ Document download capability
- ✅ **MIME type detection** - Verifies correct MIME type is detected from downloaded files
- ✅ **ETag extraction** - Verifies S3 ETags are correctly extracted from object metadata
- ✅ File fingerprinting
- ✅ Document ID generation
- ✅ Queue message structure (dry-run, no actual enqueueing)

**Note**: The test script specifically validates that MIME types and ETags are correctly extracted from S3 objects, which are critical for change detection and proper document processing.

