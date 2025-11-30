"""MIME Type Detection: Detects MIME types from files using multiple methods"""
import os
from pathlib import Path
from typing import Optional

try:
    import magic
except ImportError:
    magic = None


def detect_mime_type(file_path: Path) -> str:
    """
    Detect MIME type from a file using multiple methods.
    
    Priority:
    1. python-magic (libmagic) - most accurate, reads file content
    2. File extension - fallback if magic not available
    
    Args:
        file_path: Path to the file
    
    Returns:
        MIME type string (e.g., "application/pdf", "text/html")
    """
    # Method 1: Use python-magic (libmagic) if available - reads actual file content
    if magic is not None:
        try:
            mime = magic.Magic(mime=True)
            detected = mime.from_file(str(file_path))
            if detected and detected != "application/octet-stream":
                return detected
        except Exception as e:
            print(f"[mime_detector] python-magic failed for {file_path}: {e}")
    
    # Method 2: Fallback to extension-based detection
    return _detect_mime_from_extension(file_path)


def _detect_mime_from_extension(file_path: Path) -> str:
    """Detect MIME type from file extension (fallback method)"""
    ext = file_path.suffix.lower()
    
    mime_map = {
        # Text formats
        ".txt": "text/plain",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".csv": "text/csv",
        
        # HTML
        ".html": "text/html",
        ".htm": "text/html",
        ".xhtml": "application/xhtml+xml",
        
        # Documents
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".rtf": "application/rtf",
        ".odt": "application/vnd.oasis.opendocument.text",
        
        # Spreadsheets
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ods": "application/vnd.oasis.opendocument.spreadsheet",
        
        # Presentations
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        
        # Archives
        ".zip": "application/zip",
        ".tar": "application/x-tar",
        ".gz": "application/gzip",
        
        # Images
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        
        # Code
        ".py": "text/x-python",
        ".js": "text/javascript",
        ".json": "application/json",
        ".xml": "application/xml",
        ".yaml": "text/yaml",
        ".yml": "text/yaml",
    }
    
    return mime_map.get(ext, "application/octet-stream")


def detect_mime_from_content_type(content_type: Optional[str]) -> str:
    """
    Parse and clean MIME type from HTTP Content-Type header.
    
    Args:
        content_type: Content-Type header value (e.g., "text/html; charset=utf-8")
    
    Returns:
        Clean MIME type string (e.g., "text/html")
    """
    if not content_type:
        return "application/octet-stream"
    
    # Remove charset and other parameters
    mime = content_type.split(";")[0].strip()
    return mime or "application/octet-stream"

