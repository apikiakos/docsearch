#!/usr/bin/env python3
"""Clear manifest entries for a specific tenant"""
import os
import sys
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

def clear_tenant_manifest(tenant_id: str):
    """Delete all manifest entries for a specific tenant"""
    db = ManifestDB()
    
    with db._get_connection() as conn:
        with conn.cursor() as cur:
            # Count entries first
            cur.execute("SELECT COUNT(*) FROM file_manifest WHERE \"tenantId\" = %s", (tenant_id,))
            count = cur.fetchone()[0]
            print(f"Found {count} entries for tenant '{tenant_id}' in file_manifest table")
            
            if count == 0:
                print(f"Manifest table has no entries for tenant '{tenant_id}'")
                return
            
            # Delete entries for this tenant
            cur.execute("DELETE FROM file_manifest WHERE \"tenantId\" = %s", (tenant_id,))
            conn.commit()
            print(f"✓ Deleted {count} entries for tenant '{tenant_id}' from file_manifest table")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 clear_tenant_manifest.py <tenant_id>")
        print("Example: python3 clear_tenant_manifest.py gutenberg")
        sys.exit(1)
    
    tenant_id = sys.argv[1]
    clear_tenant_manifest(tenant_id)

