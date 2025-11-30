#!/usr/bin/env python3
"""Clear all documents from Elasticsearch indices"""
import os
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

ELASTIC_URL = os.environ.get("ELASTICSEARCH_URL", "http://localhost:9200")

def clear_all_indices():
    """Delete all documents from all tenant indices"""
    es = Elasticsearch(ELASTIC_URL)
    
    # List all indices matching the pattern
    indices = es.indices.get_alias(index="docs_*")
    
    if not indices:
        print("No indices found matching 'docs_*'")
        return
    
    print(f"Found {len(indices)} indices:")
    for index_name in indices.keys():
        print(f"  - {index_name}")
    
    # Delete all documents from each index
    for index_name in indices.keys():
        try:
            # Delete all documents but keep the index
            result = es.delete_by_query(
                index=index_name,
                body={"query": {"match_all": {}}},
                refresh=True
            )
            deleted = result.get("deleted", 0)
            print(f"✓ Deleted {deleted} documents from {index_name}")
        except Exception as e:
            print(f"✗ Error deleting from {index_name}: {e}")
    
    print("\n✓ All documents cleared from Elasticsearch")

if __name__ == "__main__":
    clear_all_indices()

