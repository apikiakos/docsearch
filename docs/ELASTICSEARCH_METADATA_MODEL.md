# Elasticsearch Index Metadata Model

## Proposed Structure

### Core Document Fields (Top Level)
```json
{
  "id": "document_id#chunk_0",
  "document_id": "sha1_hash",
  "tenant_id": "gutenberg",
  "chunk_index": 0,
  "chunk_offset": 0,
  "title": "Document Title",
  "content": "Chunk text content...",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### Metadata Object Structure

#### Core Metadata Fields (Always Present)
```json
{
  "metadata": {
    "filename": "document.pdf",
    "mime": "application/pdf",
    "source": "s3",              // Source type: "s3", "local_file", "api", "gutendex", "http", etc.
    "source_url": "s3://bucket/key",  // Source URL: S3 URL, API URL, local file path, HTTP URL, etc.
    "type": "book",               // Document type: "book", "invoice", "report", "legal", "article", etc.
    "originalUrl": "s3://bucket/key"  // For display/viewing purposes (may differ from source_url)
  }
}
```

#### Extras Object (Type-Specific Descriptive Information)
```json
{
  "metadata": {
    // ... core fields above ...
    "extras": {
      // Type-specific fields based on document type and source
      // Examples:
      
      // For Gutenberg books:
      "book_id": 123,
      "author": "Jane Austen",
      
      // For S3 documents:
      "s3_bucket": "bucket-name",
      "s3_key": "path/to/file",
      "s3_etag": "etag-value",
      "s3_last_modified": "2024-01-01T00:00:00Z",
      "folder": "books",
      
      // For HTML documents:
      "html_meta": {
        "title": "Page Title",
        "description": "Page description",
        "keywords": ["keyword1", "keyword2"],
        "author": "Author Name",
        "url": "https://example.com",
        "canonical_url": "https://example.com/canonical",
        "image": "https://example.com/image.jpg",
        "type": "article",
        "og:title": "OG Title",
        "og:description": "OG Description"
      },
      
      // For invoices:
      "invoice_number": "INV-2024-001",
      "invoice_date": "2024-01-01",
      "amount": 1000.00,
      "currency": "USD",
      
      // For reports:
      "report_date": "2024-01-01",
      "report_type": "quarterly",
      "department": "Finance"
    }
  }
}
```

## Complete Example Documents

### Example 1: Gutenberg Book
```json
{
  "id": "sha1#chunk_0",
  "document_id": "sha1",
  "tenant_id": "gutenberg",
  "chunk_index": 0,
  "title": "Pride and Prejudice",
  "content": "It is a truth universally acknowledged...",
  "metadata": {
    "filename": "1342_Pride_and_Prejudice.txt",
    "mime": "text/plain",
    "source": "gutendex",
    "source_url": "https://www.gutenberg.org/ebooks/1342.txt.utf-8",
    "type": "book",
    "originalUrl": "https://www.gutenberg.org/ebooks/1342.txt.utf-8",
    "extras": {
      "book_id": 1342,
      "author": "Jane Austen"
    }
  }
}
```

### Example 2: S3 Document
```json
{
  "id": "sha1#chunk_0",
  "document_id": "sha1",
  "tenant_id": "s3-tenant-1",
  "chunk_index": 0,
  "title": "La Comédie Humaine - Volume 01",
  "content": "French text content...",
  "metadata": {
    "filename": "books_12137_0002_la-comédie-humaine-volume-01_gqaz.docx",
    "mime": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "source": "s3",
    "source_url": "s3://document-search-tenants/s3-tenant-1/books/12137_0002_la-comédie-humaine-volume-01_gqaz.docx",
    "type": "book",
    "originalUrl": "s3://document-search-tenants/s3-tenant-1/books/12137_0002_la-comédie-humaine-volume-01_gqaz.docx",
    "extras": {
      "s3_bucket": "document-search-tenants",
      "s3_key": "s3-tenant-1/books/12137_0002_la-comédie-humaine-volume-01_gqaz.docx",
      "s3_etag": "etag-value",
      "s3_last_modified": "2024-01-01T00:00:00Z",
      "folder": "books"
    }
  }
}
```

### Example 3: Local File
```json
{
  "id": "sha1#chunk_0",
  "document_id": "sha1",
  "tenant_id": "alex-local",
  "chunk_index": 0,
  "title": "test1.txt",
  "content": "This is a test document...",
  "metadata": {
    "filename": "test1.txt",
    "mime": "text/plain",
    "source": "local_file",
    "source_url": "/Users/alex/Documents/docsearch-test/test1.txt",
    "type": "document",
    "originalUrl": "/Users/alex/Documents/docsearch-test/test1.txt",
    "extras": {}
  }
}
```

### Example 4: HTML Document
```json
{
  "id": "sha1#chunk_0",
  "document_id": "sha1",
  "tenant_id": "govdocs",
  "chunk_index": 0,
  "title": "Government Report",
  "content": "Report content...",
  "metadata": {
    "filename": "report.html",
    "mime": "text/html",
    "source": "api",
    "source_url": "https://api.gov.example.com/reports/123",
    "type": "report",
    "originalUrl": "https://api.gov.example.com/reports/123",
    "extras": {
      "html_meta": {
        "title": "Government Report",
        "description": "Quarterly government report",
        "keywords": ["government", "report"],
        "author": "Government Agency",
        "url": "https://api.gov.example.com/reports/123",
        "canonical_url": "https://gov.example.com/reports/123",
        "og:title": "Government Report",
        "og:description": "Quarterly government report"
      }
    }
  }
}
```

## Mapping Structure

### Core Metadata Fields (Required)
- `filename`: keyword - Base filename
- `mime`: keyword - MIME type
- `source`: keyword - Source type (s3, local_file, api, gutendex, http, etc.)
- `source_url`: keyword - Source URL/path
- `type`: keyword - Document type (book, invoice, report, legal, article, document, etc.)
- `originalUrl`: keyword - URL for display/viewing

### Extras Object (Optional, Dynamic)
- `extras`: object with `dynamic: true`
  - Can contain any type-specific fields
  - Examples: book_id, s3_bucket, s3_key, html_meta, invoice_number, etc.

## Benefits

1. **Generic Core Structure**: Core fields work for all document types
2. **Extensible**: New document types can add fields to `extras` without breaking compatibility
3. **Type-Safe**: Clear separation between core metadata and type-specific information
4. **Multi-Tenant Compatible**: All indices share the same core structure
5. **Searchable**: Core fields are always searchable, extras can be queried when present

