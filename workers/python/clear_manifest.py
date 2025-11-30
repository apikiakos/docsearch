#!/usr/bin/env python3
"""Clear all entries from the file_manifest table"""
import os
from pathlib import Path
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

def clear_manifest():
    """Delete all entries from file_manifest table"""
    db = ManifestDB()
    
    with db._get_connection() as conn:
        with conn.cursor() as cur:
            # Count entries first
            cur.execute("SELECT COUNT(*) FROM file_manifest")
            count = cur.fetchone()[0]
            print(f"Found {count} entries in file_manifest table")
            
            if count == 0:
                print("Manifest table is already empty")
                return
            
            # Delete all entries
            cur.execute("DELETE FROM file_manifest")
            conn.commit()
            print(f"✓ Deleted {count} entries from file_manifest table")

if __name__ == "__main__":
    clear_manifest()

