#!/usr/bin/env python3
"""
Update all existing Elasticsearch indices to use the new mapping structure.
This script:
1. Updates number_of_replicas to 1 (number_of_shards cannot be changed on existing indices)
2. Adds missing mapping fields (source_url, type, extras) to existing indices
"""
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

ELASTIC_URL = os.environ.get("ELASTICSEARCH_URL", "http://localhost:9200")

# Standard mapping structure (matches the desired mapping)
STANDARD_MAPPING = {
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
                            "properties": {
                                "title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                                "description": {"type": "text"},
                                "keywords": {"type": "keyword"},
                                "author": {"type": "keyword"},
                                "url": {"type": "keyword"},
                                "canonical_url": {"type": "keyword"},
                                "image": {"type": "keyword"},
                                "type": {"type": "keyword"},
                                "og:title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                                "og:description": {"type": "text"},
                            },
                        },
                    },
                },
            },
        },
        "created_at": {"type": "date"},
        "updated_at": {"type": "date"},
        "producer_timestamp": {"type": "date"},
        "producer_scan_time": {"type": "float"},
        "queue_time": {"type": "float"},
        "extraction_time": {"type": "float"},
        "chunking_time": {"type": "float"},
        "es_delete_time": {"type": "float"},
        "es_indexing_time": {"type": "float"},
    },
}


def update_indices(dry_run=False):
    """Update all tenant indices to use the standard mapping"""
    es = Elasticsearch(ELASTIC_URL)
    
    # Get all tenant indices
    try:
        indices_response = es.cat.indices(index="docs_*", format="json")
        indices = [idx["index"] for idx in indices_response]
    except Exception as e:
        print(f"Error listing indices: {e}")
        return
    
    if not indices:
        print("No tenant indices found (docs_*)")
        return
    
    print(f"Found {len(indices)} tenant index(es): {', '.join(indices)}")
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Updating indices to standard mapping...")
    print("Note: number_of_shards cannot be changed on existing indices (requires reindexing)")
    print("      number_of_replicas will be updated to 1")
    print("      Missing mapping fields (source_url, type, extras) will be added\n")
    
    updated = []
    errors = []
    
    for index_name in indices:
        try:
            if dry_run:
                # Check current state
                current_settings = es.indices.get_settings(index=index_name)
                current_mapping = es.indices.get_mapping(index=index_name)
                
                settings = current_settings[index_name]["settings"]["index"]
                shards = settings.get("number_of_shards", "1")
                replicas = settings.get("number_of_replicas", "0")
                
                mapping = current_mapping[index_name]["mappings"]
                metadata_props = mapping.get("properties", {}).get("metadata", {}).get("properties", {})
                
                needs_update = False
                changes = []
                
                if replicas != "1":
                    needs_update = True
                    changes.append(f"replicas: {replicas} -> 1")
                
                if "source_url" not in metadata_props:
                    needs_update = True
                    changes.append("add source_url field")
                
                if "type" not in metadata_props:
                    needs_update = True
                    changes.append("add type field")
                
                if "extras" not in metadata_props:
                    needs_update = True
                    changes.append("add extras object")
                
                if needs_update:
                    print(f"  {index_name}: Would update - {', '.join(changes)}")
                    updated.append(index_name)
                else:
                    print(f"  {index_name}: Already up to date")
            else:
                # Update replicas
                current_settings = es.indices.get_settings(index=index_name)
                current_replicas = current_settings[index_name]["settings"]["index"].get("number_of_replicas", "0")
                
                if current_replicas != "1":
                    es.indices.put_settings(
                        index=index_name,
                        settings={"number_of_replicas": 1}
                    )
                    print(f"  {index_name}: Updated replicas to 1")
                
                # Update mapping (add missing fields only)
                # Get current mapping to check what's missing
                current_mapping = es.indices.get_mapping(index=index_name)
                current_props = current_mapping[index_name]["mappings"].get("properties", {})
                current_metadata_props = current_props.get("metadata", {}).get("properties", {})
                
                # Build a mapping update with only missing fields
                mapping_update = {"properties": {}}
                
                # Add missing metadata fields
                if "source_url" not in current_metadata_props:
                    mapping_update["properties"]["metadata"] = {
                        "properties": {
                            "source_url": {"type": "keyword"}
                        }
                    }
                
                if "type" not in current_metadata_props:
                    if "metadata" not in mapping_update["properties"]:
                        mapping_update["properties"]["metadata"] = {"properties": {}}
                    mapping_update["properties"]["metadata"]["properties"]["type"] = {"type": "keyword"}
                
                if "extras" not in current_metadata_props:
                    if "metadata" not in mapping_update["properties"]:
                        mapping_update["properties"]["metadata"] = {"properties": {}}
                    mapping_update["properties"]["metadata"]["properties"]["extras"] = {
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
                                "properties": {
                                    "title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                                    "description": {"type": "text"},
                                    "keywords": {"type": "keyword"},
                                    "author": {"type": "keyword"},
                                    "url": {"type": "keyword"},
                                    "canonical_url": {"type": "keyword"},
                                    "image": {"type": "keyword"},
                                    "type": {"type": "keyword"},
                                    "og:title": {"type": "text", "fields": {"keyword": {"type": "keyword"}}},
                                    "og:description": {"type": "text"},
                                },
                            },
                        },
                    }
                
                # Only update if there are missing fields
                if mapping_update["properties"]:
                    if "metadata" in mapping_update["properties"]:
                        # Need to merge with existing metadata properties
                        # Elasticsearch requires the full metadata.properties structure
                        full_metadata_update = {
                            "properties": {
                                "metadata": {
                                    "properties": {
                                        **current_metadata_props,
                                        **mapping_update["properties"]["metadata"].get("properties", {})
                                    }
                                }
                            }
                        }
                        es.indices.put_mapping(index=index_name, body=full_metadata_update)
                    else:
                        es.indices.put_mapping(index=index_name, body=mapping_update)
                    
                    added_fields = []
                    if "source_url" not in current_metadata_props:
                        added_fields.append("source_url")
                    if "type" not in current_metadata_props:
                        added_fields.append("type")
                    if "extras" not in current_metadata_props:
                        added_fields.append("extras")
                    
                    print(f"  {index_name}: Updated mapping (added: {', '.join(added_fields)})")
                else:
                    print(f"  {index_name}: Mapping already up to date")
                
                updated.append(index_name)
        except Exception as e:
            error_msg = str(e)
            print(f"  {index_name}: ERROR - {error_msg}")
            errors.append({"index": index_name, "error": error_msg})
    
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Summary:")
    print(f"  Updated: {len(updated)} index(es)")
    if errors:
        print(f"  Errors: {len(errors)}")
        for err in errors:
            print(f"    - {err['index']}: {err['error']}")
    
    if dry_run:
        print("\nRun without --dry-run to apply changes")


def main():
    dry_run = "--dry-run" in sys.argv or "-n" in sys.argv
    
    if dry_run:
        print("=" * 60)
        print("DRY RUN MODE - No changes will be made")
        print("=" * 60)
        print()
    
    update_indices(dry_run=dry_run)


if __name__ == "__main__":
    main()

