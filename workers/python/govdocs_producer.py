#!/usr/bin/env python3
"""GovDocs Producer: Scans local folder for govdocs tenant"""
import sys
from pathlib import Path
from producer import scan_folder, connect_rabbitmq
from manifest import ManifestDB

TENANT_ID = "govdocs"
DEFAULT_FOLDER = Path(__file__).parent.parent / "data" / "govdocs-test"

def main():
    if len(sys.argv) < 2:
        folder = DEFAULT_FOLDER
        print(f"Usage: govdocs_producer.py <folder_path>")
        print(f"  Using default folder: {folder}")
        print(f"  Tenant: {TENANT_ID}")
    else:
        folder = Path(sys.argv[1]).expanduser().resolve()
    
    if not folder.exists() or not folder.is_dir():
        print(f"Error: Folder {folder} does not exist or is not a directory")
        sys.exit(1)
    
    print(f"[govdocs-producer] Scanning folder: {folder}")
    print(f"[govdocs-producer] Tenant: {TENANT_ID}")
    
    # Initialize database and RabbitMQ
    db = ManifestDB()
    connection, channel = connect_rabbitmq()
    
    try:
        scan_folder(folder, TENANT_ID, db, channel)
    finally:
        connection.close()

if __name__ == "__main__":
    main()

