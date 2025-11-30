#!/usr/bin/env python3
"""Recreate all tenant indices with correct shard settings and clear their manifests"""
import os
import sys
from pathlib import Path
from elasticsearch import Elasticsearch
from manifest import ManifestDB

# Load environment variables from root .env file
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

ELASTIC_URL = os.environ.get("ELASTICSEARCH_URL", os.environ.get("ELASTIC_URL", "http://localhost:9200"))

def recreate_index(es: Elasticsearch, tenant_id: str):
    """Delete and recreate an index with 3 shards and 1 replica"""
    index_name = f"docs_{tenant_id}"
    
    print(f"\nRecreating index: {index_name}")
    
    # Check if index exists
    try:
        exists = es.indices.exists(index=index_name)
    except Exception as e:
        print(f"  ✗ Error checking index existence: {e}")
        return False
    
    if exists:
        print(f"  - Index exists, deleting...")
        try:
            es.indices.delete(index=index_name)
            print(f"  - Index deleted")
        except Exception as e:
            print(f"  ✗ Error deleting index: {e}")
            return False
    else:
        print(f"  - Index does not exist, will create new one")
    
    # Create index with correct settings
    mapping = {
        "settings": {
            "number_of_shards": 3,
            "number_of_replicas": 1,
        },
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "document_id": {"type": "keyword"},
                "tenant_id": {"type": "keyword"},
                "chunk_index": {"type": "integer"},
                "chunk_offset": {"type": "integer"},
                "title": {
                    "type": "text",
                    "fields": {
                        "keyword": {"type": "keyword"},
                    },
                },
                "content": {
                    "type": "text",
                    "analyzer": "standard",
                },
                "metadata": {
                    "type": "object",
                    "dynamic": False,
                    "properties": {
                        "filename": {"type": "keyword"},
                        "mime": {"type": "keyword"},
                        "source": {"type": "keyword"},
                        "source_url": {"type": "keyword"},
                        "type": {"type": "keyword"},
                        "originalUrl": {"type": "keyword"},
                        "extras": {
                            "type": "object",
                            "dynamic": True,
                            "properties": {
                                "book_id": {"type": "integer"},
                                "author": {"type": "keyword"},
                                "s3_bucket": {"type": "keyword"},
                                "s3_key": {"type": "keyword"},
                                "s3_etag": {"type": "keyword"},
                                "s3_last_modified": {"type": "date"},
                                "folder": {"type": "keyword"},
                                "html_meta": {
                                    "type": "object",
                                    "dynamic": True,
                                },
                            },
                        },
                    },
                },
                "created_at": {"type": "date"},
                "updated_at": {"type": "date"},
            },
        },
    }
    
    try:
        es.indices.create(index=index_name, body=mapping)
        print(f"  - Index created with 3 shards and 1 replica")
        
        # Verify settings
        settings = es.indices.get_settings(index=index_name)
        index_settings = settings[index_name]["settings"]["index"]
        shards = index_settings.get("number_of_shards", "1")
        replicas = index_settings.get("number_of_replicas", "0")
        
        print(f"  ✓ Verified: {shards} shards, {replicas} replicas")
        return True
    except Exception as e:
        print(f"  ✗ Error creating index: {e}")
        return False

def clear_tenant_manifest(db: ManifestDB, tenant_id: str):
    """Delete all manifest entries for a specific tenant"""
    try:
        with db._get_connection() as conn:
            with conn.cursor() as cur:
                # Count entries first
                cur.execute("SELECT COUNT(*) FROM file_manifest WHERE \"tenantId\" = %s", (tenant_id,))
                count = cur.fetchone()[0]
                
                if count == 0:
                    print(f"  - No manifest entries for tenant '{tenant_id}'")
                    return
                
                # Delete entries for this tenant
                cur.execute("DELETE FROM file_manifest WHERE \"tenantId\" = %s", (tenant_id,))
                conn.commit()
                print(f"  ✓ Deleted {count} manifest entries for tenant '{tenant_id}'")
    except Exception as e:
        print(f"  ✗ Error clearing manifest for '{tenant_id}': {e}")

def main():
    es = Elasticsearch(ELASTIC_URL)
    db = ManifestDB()
    
    # Get all tenant indices
    try:
        indices = es.indices.get_alias(index="docs_*")
        tenant_indices = [idx.replace("docs_", "") for idx in indices.keys()]
    except Exception as e:
        print(f"Error getting indices: {e}")
        return
    
    if not tenant_indices:
        print("No tenant indices found matching 'docs_*'")
        return
    
    print(f"Found {len(tenant_indices)} tenant indices:")
    for tenant_id in sorted(tenant_indices):
        print(f"  - {tenant_id}")
    
    print("\n" + "="*60)
    print("Recreating indices and clearing manifests...")
    print("="*60)
    
    success_count = 0
    for tenant_id in sorted(tenant_indices):
        if recreate_index(es, tenant_id):
            clear_tenant_manifest(db, tenant_id)
            success_count += 1
    
    print("\n" + "="*60)
    print(f"✓ Completed: {success_count}/{len(tenant_indices)} tenants processed")
    print("="*60)

if __name__ == "__main__":
    main()

