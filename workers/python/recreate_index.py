#!/usr/bin/env python3
"""Recreate an Elasticsearch index with correct shard settings"""
import os
import sys
from pathlib import Path
from elasticsearch import Elasticsearch

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

def recreate_index(tenant_id: str):
    """Delete and recreate an index with 3 shards and 1 replica"""
    es = Elasticsearch(ELASTIC_URL)
    index_name = f"docs_{tenant_id}"
    
    print(f"Recreating index: {index_name}")
    
    # Check if index exists
    try:
        exists = es.indices.exists(index=index_name)
    except Exception as e:
        print(f"Error checking index existence: {e}")
        exists = False
    
    if exists:
        print(f"  - Index exists, deleting...")
        es.indices.delete(index=index_name)
        print(f"  - Index deleted")
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
    
    es.indices.create(index=index_name, body=mapping)
    print(f"  - Index created with 3 shards and 1 replica")
    
    # Verify settings
    settings = es.indices.get_settings(index=index_name)
    index_settings = settings[index_name]["settings"]["index"]
    shards = index_settings.get("number_of_shards", "1")
    replicas = index_settings.get("number_of_replicas", "0")
    
    print(f"\n✓ Index {index_name} recreated successfully")
    print(f"  - Shards: {shards}")
    print(f"  - Replicas: {replicas}")
    print(f"  - Total shards: {int(shards) * (1 + int(replicas))}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 recreate_index.py <tenant_id>")
        print("Example: python3 recreate_index.py gutenberg")
        sys.exit(1)
    
    tenant_id = sys.argv[1]
    recreate_index(tenant_id)

