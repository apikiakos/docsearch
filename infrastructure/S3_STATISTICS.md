# S3 Bucket Statistics

This document tracks the current state of documents in the S3 bucket.

**Last Updated:** November 30, 2025

## Current Document Count

### Total Documents: **17,202**

### By Tenant and Folder

#### s3-tenant-1: **14,182 documents**
- `books/`: 3,520 documents
- `invoices/`: 3,505 documents
- `legal/`: 3,571 documents
- `reports/`: 3,586 documents

#### s3-tenant-2: **3,020 documents**
- `books/`: 793 documents
- `invoices/`: 738 documents
- `legal/`: 753 documents
- `reports/`: 736 documents

### By Category (Across All Tenants)

- `books/`: 4,313 documents
- `invoices/`: 4,243 documents
- `legal/`: 4,324 documents
- `reports/`: 4,322 documents

## Target vs Actual

| Tenant | Target | Actual | Status |
|--------|--------|--------|--------|
| s3-tenant-1 | 2,000 | 14,182 | ✅ Exceeded (709% of target) |
| s3-tenant-2 | 3,000 | 3,020 | ✅ Met (101% of target) |
| **Total** | **5,000** | **17,202** | ✅ Exceeded (344% of target) |

## Bucket Information

- **Bucket Name:** `document-search-tenants`
- **Region:** `eu-west-1`
- **Stack Name:** `docsearch-s3-bucket`
- **Created:** November 30, 2025

## Document Sources

All documents are generated from French romantic literature books sourced from Project Gutenberg via the Gutendex API. Books are:
- **Downloaded in UTF-8 encoding** - The script explicitly prefers and uses UTF-8 encoded text files (`.txt.utf-8` URLs from Gutendex)
- Downloaded and cached locally in `workers/data/s3_seed_cache/` (all cached files verified as valid UTF-8)
- Sliced into virtual documents (250-500 words each)
- Converted to multiple formats (TXT, MD, HTML, PDF, DOCX) - all in UTF-8
- Randomly distributed across folders and tenants

**Encoding Verification:**
- All cached books are verified as valid UTF-8
- The script explicitly decodes downloaded content as UTF-8
- Gutendex provides `.txt.utf-8` URLs which are guaranteed UTF-8 encoded

## How to Update This Document

Run the following command to get current statistics:

```bash
# Count by tenant and folder
for tenant in s3-tenant-1 s3-tenant-2; do
  echo "📁 $tenant:"
  for folder in books invoices legal reports; do
    count=$(aws s3 ls s3://document-search-tenants/$tenant/$folder/ --recursive --region eu-west-1 2>&1 | grep -v ".keep" | wc -l | tr -d ' ')
    echo "  └─ $folder/: $count documents"
  done
done

# Total count
total=$(aws s3 ls s3://document-search-tenants/ --recursive --region eu-west-1 2>&1 | grep -v ".keep" | wc -l | tr -d ' ')
echo "Total: $total documents"
```

## Notes

- Documents are distributed randomly across folders (books, invoices, legal, reports)
- Each document is a slice from a larger book (2-5 paragraphs, ~250-500 words)
- Formats are randomly assigned (TXT, MD, HTML, PDF, DOCX)
- The parallel processing optimization allows for fast bulk uploads (up to 20 concurrent workers)

