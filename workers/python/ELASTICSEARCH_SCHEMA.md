# Elasticsearch Document Structure

This document describes the final structure of documents indexed in Elasticsearch.

## Index Pattern

Each tenant has its own index: `docs_{tenant_id}`

Example: `docs_gutenberg`, `docs_alex-local`, `docs_govdocs`

## Document Structure

Each document represents a **chunk** of a larger file. Multiple chunks are created from a single source file.

### Top-Level Fields

```json
{
  "id": "document_id#chunk_0",                    // Unique chunk ID
  "document_id": "sha1_hash_of_tenant_path",       // Groups chunks from same source file
  "tenant_id": "gutenberg",                        // Tenant identifier
  "chunk_index": 0,                                // Chunk number (0-based)
  "chunk_offset": 0,                               // Approximate byte offset
  "title": "Pride and Prejudice",                  // Document title (from HTML meta, message, or filename)
  "content": "It is a truth universally...",       // Chunk text content (searchable)
  "metadata": { /* see below */ },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "producer_timestamp": "2024-01-01T00:00:00Z",   // When producer discovered file
  "producer_scan_time": 0.123,                    // Producer scan duration (seconds)
  "queue_time": 45.67,                            // Time in queue (milliseconds)
  "extraction_time": 12.34,                       // Text extraction time (milliseconds)
  "chunking_time": 5.67,                          // Chunking time (milliseconds)
  "es_delete_time": 2.34,                         // ES delete old chunks time (milliseconds)
  "es_indexing_time": 8.90                        // ES indexing time (milliseconds)
}
```

### Metadata Object

The `metadata` object contains file-specific information:

```json
{
  "metadata": {
    "filename": "pride_and_prejudice.txt",         // Base filename
    "mime": "text/plain",                          // MIME type
    "source": "gutendex",                          // Source: "local_folder", "gutendex", "http"
    "originalUrl": "https://www.gutenberg.org/...", // Original URL (if from HTTP producer)
    "book_id": 1342,                               // Gutenberg book ID (if from gutendex)
    "html_meta": { /* see below, only for HTML files */ }
  }
}
```

### HTML Meta Object (HTML files only)

For HTML files, the `html_meta` object contains extracted meta tags:

```json
{
  "metadata": {
    "html_meta": {
      "title": "Page Title",                      // From <title> tag
      "description": "Page description...",        // From <meta name="description">
      "keywords": "keyword1, keyword2",            // From <meta name="keywords">
      "author": "Author Name",                     // From <meta name="author">
      "url": "https://example.com/page",          // From <meta property="og:url">
      "canonical_url": "https://example.com/page", // From <link rel="canonical">
      "image": "https://example.com/image.jpg",   // From <meta property="og:image">
      "type": "article",                          // From <meta property="og:type">
      "og:title": "OG Title",                     // From <meta property="og:title">
      "og:description": "OG description..."       // From <meta property="og:description">
    }
  }
}
```

**Note**: For non-HTML files, `html_meta` is `null` or omitted.

## Field Types

### Text Fields (Searchable)
- `title` - Full-text searchable, also has `.keyword` sub-field for exact matches
- `content` - Main searchable content (chunk text)
- `metadata.html_meta.title` - Searchable HTML title
- `metadata.html_meta.description` - Searchable HTML description

### Keyword Fields (Exact Match)
- `id`, `document_id`, `tenant_id` - Identifiers
- `metadata.filename`, `metadata.mime`, `metadata.source` - File metadata
- `metadata.originalUrl`, `metadata.html_meta.url`, `metadata.html_meta.canonical_url` - URLs
- `metadata.html_meta.keywords` - Keywords (array of keywords)
- `metadata.html_meta.author`, `metadata.html_meta.type`, `metadata.html_meta.image` - Other meta

### Numeric Fields
- `chunk_index`, `chunk_offset` - Integers
- `metadata.book_id` - Integer (Gutenberg books)
- Timing fields - Floats (milliseconds or seconds)

### Date Fields
- `created_at`, `updated_at`, `producer_timestamp` - ISO 8601 dates

## Example Documents

### Plain Text File (Gutenberg Book)

```json
{
  "id": "sha1_hash#chunk_0",
  "document_id": "sha1_hash",
  "tenant_id": "gutenberg",
  "chunk_index": 0,
  "chunk_offset": 0,
  "title": "Pride and Prejudice",
  "content": "It is a truth universally acknowledged...",
  "metadata": {
    "filename": "1342_Pride_and_Prejudice.txt",
    "mime": "text/plain",
    "source": "gutendex",
    "originalUrl": null,
    "book_id": 1342,
    "html_meta": null
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### HTML File

```json
{
  "id": "sha1_hash#chunk_0",
  "document_id": "sha1_hash",
  "tenant_id": "govdocs",
  "chunk_index": 0,
  "chunk_offset": 0,
  "title": "Government Policy Document",
  "content": "This document outlines the policy...",
  "metadata": {
    "filename": "policy.html",
    "mime": "text/html",
    "source": "http",
    "originalUrl": "https://example.gov/policy.html",
    "book_id": null,
    "html_meta": {
      "title": "Government Policy Document",
      "description": "Official policy document on...",
      "keywords": "policy, government, regulation",
      "author": "Government Agency",
      "url": "https://example.gov/policy.html",
      "canonical_url": "https://example.gov/policy.html",
      "image": "https://example.gov/image.jpg",
      "type": "article",
      "og:title": "Government Policy Document",
      "og:description": "Official policy document on..."
    }
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## Search Examples

### Search by HTML meta title
```json
{
  "query": {
    "match": {
      "metadata.html_meta.title": "policy"
    }
  }
}
```

### Search by HTML description
```json
{
  "query": {
    "match": {
      "metadata.html_meta.description": "government"
    }
  }
}
```

### Filter by canonical URL
```json
{
  "query": {
    "term": {
      "metadata.html_meta.canonical_url": "https://example.gov/policy.html"
    }
  }
}
```

### Search content with HTML meta boost
```json
{
  "query": {
    "multi_match": {
      "query": "policy",
      "fields": [
        "content^1",
        "metadata.html_meta.title^3",
        "metadata.html_meta.description^2"
      ]
    }
  }
}
```

