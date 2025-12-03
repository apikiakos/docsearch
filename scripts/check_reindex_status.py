#!/usr/bin/env python3
"""Check reindexing status for a tenant"""
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta
import json

# Add workers/python to path
sys.path.insert(0, str(Path(__file__).parent.parent / "workers" / "python"))

try:
    from manifest import ManifestDB
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError as e:
    print(f"❌ Error importing modules: {e}")
    print("Make sure you're in the project root and Python dependencies are installed")
    sys.exit(1)

# Load environment variables
try:
    from dotenv import load_dotenv
    root_dir = Path(__file__).parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

def check_elasticsearch(tenant_id: str):
    """Check Elasticsearch index status"""
    import urllib.request
    import urllib.error
    
    es_url = os.environ.get("ELASTICSEARCH_URL", "http://localhost:9200")
    index_name = f"documents_{tenant_id}"
    
    try:
        # Check if index exists and get count
        count_url = f"{es_url}/{index_name}/_count"
        with urllib.request.urlopen(count_url, timeout=5) as response:
            data = json.loads(response.read())
            doc_count = data.get("count", 0)
            return doc_count, True
    except urllib.error.URLError:
        return 0, False
    except Exception as e:
        print(f"  ⚠ Error checking Elasticsearch: {e}")
        return 0, False

def check_rabbitmq():
    """Check RabbitMQ queue status"""
    import urllib.request
    import urllib.error
    import base64
    
    rabbitmq_url = os.environ.get("RABBITMQ_URL", "http://guest:guest@localhost:15672")
    queue_name = "doc_ingest"
    
    try:
        # Parse URL
        if "@" in rabbitmq_url:
            auth_part, host_part = rabbitmq_url.split("@")
            if "://" in auth_part:
                _, creds = auth_part.split("://")
                user, passwd = creds.split(":")
            else:
                user, passwd = auth_part.split(":")
            api_url = f"http://{host_part}/api/queues/%2F/{queue_name}"
            
            # Create basic auth header
            credentials = base64.b64encode(f"{user}:{passwd}".encode()).decode()
            request = urllib.request.Request(api_url)
            request.add_header("Authorization", f"Basic {credentials}")
            
            with urllib.request.urlopen(request, timeout=5) as response:
                data = json.loads(response.read())
                return data.get("messages", 0), True
    except Exception as e:
        return 0, False

def main():
    tenant_id = sys.argv[1] if len(sys.argv) > 1 else "gutenberg"
    
    print("=" * 60)
    print(f"Checking Reindex Status for: {tenant_id}")
    print("=" * 60)
    print()
    
    # Check manifest
    print("📊 MANIFEST TABLE STATUS")
    print("-" * 60)
    try:
        db = ManifestDB()
        entries = db.get_all_manifest_entries(tenant_id)
        
        total = len(entries)
        now = datetime.now()
        five_min_ago = now - timedelta(minutes=5)
        one_hour_ago = now - timedelta(hours=1)
        
        recently_indexed = 0
        recently_indexed_list = []
        deleted = 0
        permanently_deleted = 0
        most_recent_time = None
        
        for entry in entries:
            last_indexed = entry.get("lastIndexedAt")
            if isinstance(last_indexed, str):
                try:
                    last_indexed = datetime.fromisoformat(last_indexed.replace("Z", "+00:00"))
                except:
                    last_indexed = None
            
            if last_indexed:
                if most_recent_time is None or last_indexed > most_recent_time:
                    most_recent_time = last_indexed
                
                if last_indexed > five_min_ago:
                    recently_indexed += 1
                    recently_indexed_list.append({
                        "path": entry.get("path", "N/A"),
                        "time": last_indexed.isoformat()
                    })
            
            if entry.get("isDeleted"):
                deleted += 1
            if entry.get("permanentlyDeleted"):
                permanently_deleted += 1
        
        print(f"  Total documents: {total}")
        print(f"  Recently indexed (last 5 min): {recently_indexed}")
        print(f"  Deleted: {deleted}")
        print(f"  Permanently deleted: {permanently_deleted}")
        if most_recent_time:
            time_diff = now - most_recent_time
            print(f"  Most recent index time: {most_recent_time.strftime('%Y-%m-%d %H:%M:%S')}")
            print(f"  Time since last index: {time_diff}")
        else:
            print(f"  Most recent index time: None")
        
        if recently_indexed_list:
            print()
            print("  Recently indexed documents:")
            for item in recently_indexed_list[:5]:
                path = item["path"]
                filename = Path(path).name if path != "N/A" else "N/A"
                print(f"    - {filename[:60]} ({item['time']})")
        
        print()
        print("📋 RECENT INDEXING ACTIVITY (Last 10 documents)")
        print("-" * 60)
        sorted_entries = sorted(entries, key=lambda x: x.get("lastIndexedAt", ""), reverse=True)
        for entry in sorted_entries[:10]:
            path = entry.get("path", "N/A")
            filename = Path(path).name if path != "N/A" else "N/A"
            last_indexed = entry.get("lastIndexedAt", "N/A")
            size = entry.get("sizeBytes", 0)
            is_deleted = "✓" if entry.get("isDeleted") else " "
            print(f"  [{is_deleted}] {filename[:50]:<50} | {last_indexed} | {size:,} bytes")
        
    except Exception as e:
        print(f"❌ Error checking manifest: {e}")
        import traceback
        traceback.print_exc()
    
    print()
    print("🔍 ELASTICSEARCH STATUS")
    print("-" * 60)
    es_count, es_ok = check_elasticsearch(tenant_id)
    if es_ok:
        print(f"  ✓ Index exists: documents_{tenant_id}")
        print(f"  Document count: {es_count:,}")
    else:
        print(f"  ❌ Could not connect to Elasticsearch")
    
    print()
    print("📬 RABBITMQ QUEUE STATUS")
    print("-" * 60)
    queue_count, queue_ok = check_rabbitmq()
    if queue_ok:
        print(f"  Queue: doc_ingest")
        print(f"  Pending messages: {queue_count}")
        if queue_count > 0:
            print(f"  ⚠ There are {queue_count} messages waiting to be processed")
    else:
        print(f"  ⚠ Could not check RabbitMQ queue")
    
    print()
    print("=" * 60)
    print("Summary:")
    print("  - Check 'recently_indexed' count above")
    print("  - Check 'most_recent_index_time' - should be recent if reindexing happened")
    print("  - Compare Elasticsearch doc count with manifest count")
    print("  - Check RabbitMQ queue for pending messages")
    if most_recent_time and (now - most_recent_time) > timedelta(minutes=10):
        print()
        print("  ⚠ WARNING: Last indexing was more than 10 minutes ago.")
        print("     If you just ran force reindex, it may not have completed yet.")
        print("     Check the FastAPI terminal for producer output.")
    print("=" * 60)

if __name__ == "__main__":
    main()

