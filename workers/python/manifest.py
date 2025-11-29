"""Database access for file manifest (PostgreSQL)"""
import os
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from typing import Optional, Dict, List

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/docsearch"
)


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
                            "lastIndexedAt" TIMESTAMP(3) WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
                            UNIQUE ("tenantId", path)
                        );
                        CREATE INDEX IF NOT EXISTS idx_file_manifest_tenant_deleted 
                        ON file_manifest("tenantId", "isDeleted");
                    """)
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
        content_hash: Optional[str] = None
    ):
        """Insert a new manifest entry"""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO file_manifest
                    ("tenantId", path, "documentId", "lastMtime", "sizeBytes", "contentHash", "lastIndexedAt")
                    VALUES (%s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                    ON CONFLICT ("tenantId", path) DO UPDATE SET
                        "documentId" = EXCLUDED."documentId",
                        "lastMtime" = EXCLUDED."lastMtime",
                        "sizeBytes" = EXCLUDED."sizeBytes",
                        "contentHash" = EXCLUDED."contentHash",
                        "lastIndexedAt" = CURRENT_TIMESTAMP,
                        "isDeleted" = FALSE
                """, (tenant_id, path, document_id, last_mtime, size_bytes, content_hash))
                conn.commit()

    def update_manifest(
        self,
        tenant_id: str,
        path: str,
        last_mtime: datetime,
        size_bytes: int,
        content_hash: Optional[str] = None
    ):
        """Update manifest entry"""
        with self._get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE file_manifest
                    SET "lastMtime" = %s,
                        "sizeBytes" = %s,
                        "contentHash" = %s,
                        "lastIndexedAt" = CURRENT_TIMESTAMP,
                        "isDeleted" = FALSE
                    WHERE "tenantId" = %s AND path = %s
                """, (last_mtime, size_bytes, content_hash, tenant_id, path))
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
