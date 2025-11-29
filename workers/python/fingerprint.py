"""File fingerprinting utilities"""
import hashlib
import os
from pathlib import Path
from typing import Tuple, Optional


def make_document_id(tenant_id: str, path: str) -> str:
    """
    Generate a stable document ID from tenant and path.
    Uses SHA-1 hash for consistency.
    """
    key = f"{tenant_id}:{path}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


def compute_file_fingerprint(file_path: Path) -> Tuple[float, int, Optional[str]]:
    """
    Compute file fingerprint: (mtime, size, content_hash)
    Returns: (mtime, size_bytes, content_hash)
    """
    stat = file_path.stat()
    mtime = stat.st_mtime
    size_bytes = stat.st_size
    
    # Optional: compute content hash for strong change detection
    # For large files, this can be slow, so we make it optional
    content_hash = None
    if os.getenv("USE_CONTENT_HASH", "false").lower() == "true":
        content_hash = compute_content_hash(file_path)
    
    return (mtime, size_bytes, content_hash)


def compute_content_hash(file_path: Path) -> str:
    """Compute SHA-256 hash of file content"""
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        # Read in chunks to handle large files
        for chunk in iter(lambda: f.read(4096), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def has_file_changed(
    current_mtime: float,
    current_size: int,
    current_hash: Optional[str],
    manifest_mtime: float,
    manifest_size: int,
    manifest_hash: Optional[str]
) -> bool:
    """
    Check if file has changed by comparing fingerprints.
    Returns True if file changed, False otherwise.
    """
    # Quick checks: mtime and size
    if current_mtime != manifest_mtime or current_size != manifest_size:
        return True
    
    # If both have hashes, compare them
    if current_hash and manifest_hash:
        return current_hash != manifest_hash
    
    # If only one has a hash, we can't be sure, so assume changed
    if current_hash or manifest_hash:
        return True
    
    # No hash comparison, rely on mtime/size (already checked)
    return False

