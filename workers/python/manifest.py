"""Database access for file manifest (PostgreSQL)"""
import os
from pathlib import Path
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Optional, Dict, List

# Load environment variables from root .env file
try:
    from dotenv import load_dotenv
    # Load from root .env (two levels up from workers/python)
    root_dir = Path(__file__).parent.parent.parent
    env_path = root_dir / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    # python-dotenv not installed, use environment variables directly
    pass

# Get DATABASE_URL and strip Prisma-specific query parameters
_raw_db_url = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/docsearch"
)
# Remove ?schema=public and other Prisma-specific parameters (psycopg2 doesn't understand them)
if "?" in _raw_db_url:
    DATABASE_URL = _raw_db_url.split("?")[0]
else:
    DATABASE_URL = _raw_db_url


class ManifestDB:
    def __init__(self, db_url: str = DATABASE_URL):
        self.db_url = db_url
        self._ensure_table()

    def _get_connection(self):
        return psycopg2.connect(self.db_url)

    def _ensure_table(self):
        """Create file_manifest table if it doesn't exist (Prisma uses camelCase)"""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                # Check if table exists, if not Prisma will create it
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'file_manifest'
                    );
                """)
                table_exists = cur.fetchone()[0]
                
                if not table_exists:
                    # Table should be created by Prisma, but if it doesn't exist, create it
                    # Note: This matches Prisma's camelCase column names
                    cur.execute("""
                        CREATE TABLE IF NOT EXISTS file_manifest (
                            id SERIAL PRIMARY KEY,
                            "tenantId" TEXT NOT NULL,
                            path TEXT NOT NULL,
                            "documentId" TEXT NOT NULL,
                            "lastMtime" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL,
                            "sizeBytes" BIGINT NOT NULL,
                            "contentHash" TEXT,
                            etag TEXT,
                            "lastIndexedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
                            UNIQUE ("tenantId", path)
                        );
                        CREATE INDEX IF NOT EXISTS idx_file_manifest_tenant_deleted 
                        ON file_manifest("tenantId", "isDeleted");
                    """)
                    conn.commit()
                else:
                    # Check if etag column exists, add it if not
                    cur.execute("""
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'file_manifest' AND column_name = 'etag';
                    """)
                    if not cur.fetchone():
                        cur.execute('ALTER TABLE file_manifest ADD COLUMN IF NOT EXISTS etag TEXT;')
                        conn.commit()

    def get_manifest(self, tenant_id: str, path: str) -> Optional[Dict]:
        """Get manifest entry for a file"""
        with self._get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT * FROM file_manifest
                    WHERE "tenantId" = %s AND path = %s
                """, (tenant_id, path))
                row = cur.fetchone()
                return dict(row) if row else None

    def insert_manifest(
        self,
        tenant_id: str,
        path: str,
        document_id: str,
        last_mtime: datetime,
        size_bytes: int,
        content_hash: Optional[str] = None,
        etag: Optional[str] = None
    ):
        """Insert a new manifest entry"""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO file_manifest
                    ("tenantId", path, "documentId", "lastMtime", "sizeBytes", "contentHash", etag, "lastIndexedAt")
                    VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT ("tenantId", path) DO UPDATE SET
                        "documentId" = EXCLUDED."documentId",
                        "lastMtime" = EXCLUDED."lastMtime",
                        "sizeBytes" = EXCLUDED."sizeBytes",
                        "contentHash" = EXCLUDED."contentHash",
                        etag = EXCLUDED.etag,
                        "lastIndexedAt" = CURRENT_TIMESTAMP,
                        "isDeleted" = FALSE
                """, (tenant_id, path, document_id, last_mtime, size_bytes, content_hash, etag))
                conn.commit()

    def update_manifest(
        self,
        tenant_id: str,
        path: str,
        last_mtime: datetime,
        size_bytes: int,
        content_hash: Optional[str] = None,
        etag: Optional[str] = None
    ):
        """Update manifest entry"""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE file_manifest
                    SET "lastMtime" = %s,
                        "sizeBytes" = %s,
                        "contentHash" = %s,
                        etag = %s,
                        "lastIndexedAt" = CURRENT_TIMESTAMP,
                        "isDeleted" = FALSE
                    WHERE "tenantId" = %s AND path = %s
                """, (last_mtime, size_bytes, content_hash, etag, tenant_id, path))
                conn.commit()

    def mark_deleted(self, tenant_id: str, path: str):
        """Mark a file as deleted"""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE file_manifest
                    SET "isDeleted" = TRUE,
                        "lastIndexedAt" = CURRENT_TIMESTAMP
                    WHERE "tenantId" = %s AND path = %s
                """, (tenant_id, path))
                conn.commit()

    def list_manifest_for_tenant(self, tenant_id: str, include_deleted: bool = False) -> List[Dict]:
        """List all manifest entries for a tenant"""
        with self._get_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if include_deleted:
                    cur.execute("""
                        SELECT * FROM file_manifest
                        WHERE "tenantId" = %s
                        ORDER BY path
                    """, (tenant_id,))
                else:
                    cur.execute("""
                        SELECT * FROM file_manifest
                        WHERE "tenantId" = %s AND "isDeleted" = FALSE
                        ORDER BY path
                    """, (tenant_id,))
                return [dict(row) for row in cur.fetchall()]
