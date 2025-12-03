#!/usr/bin/env python3
"""
Find and cleanup documents with incomplete metadata in Elasticsearch and manifest.

This script:
1. Searches Elasticsearch for documents with minimal/incomplete metadata
2. Lists them with details
3. Optionally deletes them from both Elasticsearch and manifest
"""

import os
import sys
from pathlib import Path
from typing import List, Dict, Any
from elasticsearch import Elasticsearch
import psycopg2
from urllib.parse import urlparse
from dotenv import load_dotenv

# Load environment variables
root_dir = Path(__file__).parent.parent
env_path = root_dir / ".env"
if env_path.exists():
    load_dotenv(env_path)

# Get environment variables
ES_URL = os.getenv("ELASTICSEARCH_URL", "http://localhost:9200")
DB_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/docsearch")

# Connect to Elasticsearch
es = Elasticsearch([ES_URL])

# Connect to PostgreSQL
parsed = urlparse(DB_URL)
conn = psycopg2.connect(
    host=parsed.hostname,
    port=parsed.port or 5432,
    database=parsed.path[1:],
    user=parsed.username,
    password=parsed.password
)
cur = conn.cursor()


def find_documents_with_incomplete_metadata() -> List[Dict[str, Any]]:
    """Find documents in Elasticsearch with incomplete metadata."""
    print("Searching Elasticsearch for documents with incomplete metadata...")
    
    # Search all tenant indices
    result = es.search(
        index="docs_*",
        query={
            "match_all": {}
        },
        size=10000,  # Adjust if you have more documents
        _source=["document_id", "tenant_id", "metadata", "title"]
    )
    
    incomplete_docs = []
    
    for hit in result["hits"]["hits"]:
        source = hit["_source"]
        document_id = source.get("document_id")
        tenant_id = source.get("tenant_id")
        metadata = source.get("metadata", {})
        
        # Check if metadata is incomplete
        # For S3 documents, we expect: source, originalUrl or source_url, and extras.s3_key
        # For other documents, we expect at least: source, filename
        
        is_incomplete = False
        missing_fields = []
        
        if tenant_id and tenant_id.startswith("s3-"):
            # S3 documents should have:
            # - source = "s3"
            # - originalUrl or source_url with s3://
            # - extras.s3_key
            if not metadata.get("source"):
                is_incomplete = True
                missing_fields.append("source")
            
            if not metadata.get("originalUrl") and not metadata.get("source_url"):
                is_incomplete = True
                missing_fields.append("originalUrl or source_url")
            
            extras = metadata.get("extras", {})
            if not extras.get("s3_key") and not metadata.get("s3_key"):
                is_incomplete = True
                missing_fields.append("s3_key (in extras or metadata)")
        
        elif tenant_id == "gutenberg":
            # Gutenberg documents should have:
            # - source = "gutendex" or similar
            # - filename
            if not metadata.get("source"):
                is_incomplete = True
                missing_fields.append("source")
            
            if not metadata.get("filename"):
                is_incomplete = True
                missing_fields.append("filename")
        
        else:
            # Other documents should have at least source and filename
            if not metadata.get("source"):
                is_incomplete = True
                missing_fields.append("source")
            
            if not metadata.get("filename"):
                is_incomplete = True
                missing_fields.append("filename")
        
        # Also check if metadata is too minimal (only filename, nothing else)
        metadata_keys = set(metadata.keys())
        if len(metadata_keys) <= 1 and "filename" in metadata_keys:
            is_incomplete = True
            missing_fields.append("metadata too minimal (only filename)")
        
        if is_incomplete:
            incomplete_docs.append({
                "document_id": document_id,
                "tenant_id": tenant_id,
                "index": hit["_index"],
                "metadata": metadata,
                "title": source.get("title", "N/A"),
                "missing_fields": missing_fields,
                "metadata_keys": list(metadata_keys),
            })
    
    return incomplete_docs


def list_incomplete_documents(docs: List[Dict[str, Any]]):
    """List documents with incomplete metadata."""
    print(f"\n{'='*80}")
    print(f"Found {len(docs)} documents with incomplete metadata:")
    print(f"{'='*80}\n")
    
    for i, doc in enumerate(docs, 1):
        print(f"{i}. Document ID: {doc['document_id']}")
        print(f"   Tenant: {doc['tenant_id']}")
        print(f"   Index: {doc['index']}")
        print(f"   Title: {doc['title']}")
        print(f"   Missing fields: {', '.join(doc['missing_fields'])}")
        print(f"   Metadata keys: {', '.join(doc['metadata_keys'])}")
        print(f"   Metadata: {doc['metadata']}")
        print()


def delete_documents(docs: List[Dict[str, Any]], dry_run: bool = True):
    """Delete documents from Elasticsearch and manifest."""
    if dry_run:
        print("\n[DRY RUN] Would delete the following documents:")
    else:
        print("\nDeleting documents from Elasticsearch and manifest...")
    
    deleted_from_es = 0
    deleted_from_manifest = 0
    
    for doc in docs:
        document_id = doc["document_id"]
        tenant_id = doc["tenant_id"]
        
        if dry_run:
            print(f"  - Would delete: {document_id} (tenant: {tenant_id})")
        else:
            # Delete from Elasticsearch
            try:
                # Delete all chunks for this document
                es.delete_by_query(
                    index=doc["index"],
                    query={
                        "term": {"document_id": document_id}
                    },
                    refresh=True
                )
                deleted_from_es += 1
                print(f"  ✓ Deleted from ES: {document_id}")
            except Exception as e:
                print(f"  ✗ Error deleting from ES {document_id}: {e}")
            
            # Delete from manifest
            try:
                cur.execute("""
                    DELETE FROM file_manifest 
                    WHERE "tenantId" = %s AND "documentId" = %s
                """, (tenant_id, document_id))
                if cur.rowcount > 0:
                    deleted_from_manifest += 1
                    print(f"  ✓ Deleted from manifest: {document_id}")
                else:
                    print(f"  ⚠ Not found in manifest: {document_id}")
            except Exception as e:
                print(f"  ✗ Error deleting from manifest {document_id}: {e}")
    
    if not dry_run:
        conn.commit()
        print(f"\nSummary:")
        print(f"  - Deleted from Elasticsearch: {deleted_from_es} documents")
        print(f"  - Deleted from manifest: {deleted_from_manifest} documents")


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Find and cleanup documents with incomplete metadata")
    parser.add_argument("--delete", action="store_true", help="Actually delete the documents (default: dry run)")
    parser.add_argument("--dry-run", action="store_true", default=True, help="Show what would be deleted (default)")
    args = parser.parse_args()
    
    print("="*80)
    print("Find and Cleanup Documents with Incomplete Metadata")
    print("="*80)
    
    # Find incomplete documents
    incomplete_docs = find_documents_with_incomplete_metadata()
    
    if not incomplete_docs:
        print("\n✓ No documents with incomplete metadata found!")
        return
    
    # List them
    list_incomplete_documents(incomplete_docs)
    
    # Handle deletion based on arguments
    if args.delete:
        print(f"\n{'='*80}")
        print(f"⚠️  WARNING: This will permanently delete {len(incomplete_docs)} documents!")
        print(f"{'='*80}")
        delete_documents(incomplete_docs, dry_run=False)
        print("\n✓ Cleanup complete!")
    else:
        print(f"\n{'='*80}")
        print("DRY RUN MODE - No documents will be deleted")
        print(f"{'='*80}")
        delete_documents(incomplete_docs, dry_run=True)
        print("\nTo actually delete these documents, run with --delete flag:")
        print("  python3 scripts/find_and_cleanup_incomplete_metadata.py --delete")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✗ Interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cur.close()
        conn.close()

