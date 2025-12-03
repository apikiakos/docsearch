#!/usr/bin/env python3
"""Check which documents are in manifest but not in Elasticsearch"""
import sys
import os
import requests
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from manifest import ManifestDB
from elasticsearch import Elasticsearch
from fingerprint import make_document_id

# Load environment variables
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

ES_URL = os.environ.get("ELASTICSEARCH_URL", "http://localhost:9200")
BUCKET_NAME = os.environ.get("AWS_S3_BUCKET", "document-search-tenants")
DATA_DIR = Path(__file__).parent.parent / "data" / "s3_downloads"


def get_es_document_ids(tenant_id: str, es_url: str) -> set:
    """Get all document IDs from Elasticsearch for a tenant"""
    index_name = f"docs_{tenant_id}"
    
    try:
        # Check if index exists
        check_url = f"{es_url}/{index_name}"
        check_response = requests.head(check_url, timeout=5)
        if check_response.status_code == 404:
            return set()
        
        # Use terms aggregation to get all unique document_ids
        search_url = f"{es_url}/{index_name}/_search"
        query = {
            "size": 0,
            "aggs": {
                "document_ids": {
                    "terms": {
                        "field": "document_id",
                        "size": 10000,
                    }
                }
            }
        }
        
        response = requests.post(search_url, json=query, timeout=10)
        response.raise_for_status()
        result = response.json()
        
        buckets = result.get("aggregations", {}).get("document_ids", {}).get("buckets", [])
        return {bucket["key"] for bucket in buckets}
    except Exception as e:
        print(f"Error querying Elasticsearch: {e}")
        return set()


def check_local_file(tenant_id: str, s3_key: str) -> tuple[bool, str]:
    """Check if local file exists for an S3 document"""
    tenant_data_dir = DATA_DIR / tenant_id
    key_parts = s3_key.split('/')
    if len(key_parts) > 1:
        local_filename = '_'.join(key_parts[1:])
    else:
        local_filename = key_parts[-1]
    
    local_path = tenant_data_dir / local_filename
    exists = local_path.exists()
    return exists, str(local_path)


def main():
    if len(sys.argv) < 2:
        print("Usage: python check_missing_documents.py <tenant_id>")
        print("Example: python check_missing_documents.py s3-tenant-1")
        sys.exit(1)
    
    tenant_id = sys.argv[1]
    
    print(f"Checking documents for tenant: {tenant_id}")
    print("=" * 70)
    
    # Get manifest entries
    db = ManifestDB()
    manifest_entries = db.get_all_manifest_entries(tenant_id)
    
    print(f"Manifest entries: {len(manifest_entries)}")
    
    # Get Elasticsearch document IDs
    es_doc_ids = get_es_document_ids(tenant_id, ES_URL)
    
    print(f"Elasticsearch documents: {len(es_doc_ids)}")
    print()
    
    # Find missing documents
    missing = []
    for entry in manifest_entries:
        doc_id = entry.get("documentId") or entry.get("document_id")
        path = entry.get("path")
        
        if not doc_id:
            print(f"⚠ Warning: Manifest entry has no documentId: {path}")
            continue
        
        if doc_id not in es_doc_ids:
            missing.append((doc_id, path, entry))
    
    # Check for documents in ES but not in manifest (API-created documents)
    manifest_doc_ids = {entry.get("documentId") or entry.get("document_id") for entry in manifest_entries if entry.get("documentId") or entry.get("document_id")}
    inESNotInManifest = es_doc_ids - manifest_doc_ids
    
    if not missing and not inESNotInManifest:
        print("✓ All manifest documents are indexed in Elasticsearch!")
        print("✓ No extra documents in Elasticsearch (all match manifest)")
        return
    
    if inESNotInManifest:
        print(f"ℹ Found {len(inESNotInManifest)} document(s) in Elasticsearch but NOT in manifest:")
        print("  (These are likely API-created documents, which use UUIDs and don't appear in manifest)")
        for doc_id in sorted(inESNotInManifest):
            print(f"    - {doc_id}")
        print()
    
    if missing:
        print(f"❌ Found {len(missing)} documents in manifest but NOT in Elasticsearch:")
        print()
        
        for doc_id, path, entry in missing:
            print(f"Document ID: {doc_id}")
            print(f"  Path: {path}")
            print(f"  Last Indexed At: {entry.get('lastIndexedAt', 'N/A')}")
            
            # Check if local file exists (for S3 documents)
            if tenant_id.startswith("s3-"):
                exists, local_path = check_local_file(tenant_id, path)
                if exists:
                    print(f"  ✓ Local file exists: {local_path}")
                else:
                    print(f"  ❌ Local file MISSING: {local_path}")
            print()
        
        print("=" * 70)
        print("Possible causes:")
        print("  1. Files don't exist locally (download failed)")
        print("  2. Consumer failed to process (check consumer logs)")
        print("  3. Extraction failed (empty or unreadable content)")
        print("  4. Consumer not running when documents were enqueued")
        print()
        print("To fix:")
        print(f"  1. Check consumer logs for errors")
        if tenant_id.startswith("s3-"):
            print(f"  2. Re-run producer to re-download missing files:")
            print(f"     python s3_producer.py {tenant_id} --check-existing")
        else:
            print(f"  2. Re-run producer to reindex missing files:")
            print(f"     python {tenant_id}_producer.py")
        print(f"  3. Or force reindex specific documents")


if __name__ == "__main__":
    main()

