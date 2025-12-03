"""Document Extractor: Extracts text from various file formats"""
import os
import subprocess
from pathlib import Path
from typing import Optional

try:
    from pdfminer.high_level import extract_text as extract_pdf_text
except ImportError:
    extract_pdf_text = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from docx import Document
except ImportError:
    Document = None

try:
    import magic
except ImportError:
    magic = None


def extract_text_from_file(file_path: str, mime_type: Optional[str] = None) -> str:
    """
    Extract text from a file based on its MIME type or extension.
    
    This is the CONSUMER's responsibility: process content of stored files.
    
    Supported formats:
    - text/plain (.txt)
    - text/markdown (.md, .markdown)
    - application/pdf (.pdf)
    - text/html (.html, .htm)
    - application/vnd.openxmlformats-officedocument.wordprocessingml.document (.docx)
    - application/msword (.doc) - falls back to text extraction
    
    Args:
        file_path: Path to the local file
        mime_type: Optional MIME type hint (if not provided, inferred from extension)
    
    Returns:
        Extracted text content
    """
    result = extract_text_and_metadata(file_path, mime_type)
    return result if isinstance(result, str) else result.get("text", "")


def extract_text_and_metadata(file_path: str, mime_type: Optional[str] = None) -> dict:
    """
    Extract text and metadata from a file.
    
    For HTML files, also extracts meta tags (title, og:description, og:url, etc.).
    For other formats, returns text only (backward compatible).
    
    Args:
        file_path: Path to the local file
        mime_type: Optional MIME type hint
    
    Returns:
        For HTML: dict with "text" and "html_meta" keys
        For other formats: dict with "text" key only (or just str for backward compat)
    """
    path = Path(file_path)
    
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    
    # Determine MIME type from extension if not provided
    if not mime_type:
        ext = path.suffix.lower()
        mime_map = {
            ".txt": "text/plain",
            ".md": "text/markdown",
            ".markdown": "text/markdown",
            ".pdf": "application/pdf",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ".doc": "application/msword",
            ".html": "text/html",
            ".htm": "text/html",
        }
        mime_type = mime_map.get(ext, "text/plain")
    
    # Extract based on MIME type
    if mime_type == "text/html":
        # HTML returns both text and metadata
        return _extract_html_with_metadata(path)
    elif mime_type == "text/plain":
        return {"text": _extract_text_plain(path)}
    elif mime_type == "text/markdown":
        return {"text": _extract_text_plain(path)}  # Markdown is plain text
    elif mime_type == "application/pdf":
        return {"text": _extract_pdf(path)}
    elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return {"text": _extract_docx(path)}
    elif mime_type == "application/msword":
        return {"text": _extract_doc(path)}
    else:
        # Fallback: try to read as plain text
        print(f"[extractor] Unknown MIME type {mime_type}, attempting plain text extraction")
        return {"text": _extract_text_plain(path)}


def _extract_text_plain(path: Path) -> str:
    """Extract text from plain text file"""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except Exception as e:
        print(f"[extractor] Error reading plain text file {path}: {e}")
        return ""


def _extract_pdf(path: Path) -> str:
    """Extract text from PDF file"""
    if extract_pdf_text is None:
        print(f"[extractor] pdfminer not available, cannot extract PDF: {path}")
        return ""
    
    try:
        text = extract_pdf_text(str(path))
        return text
    except Exception as e:
        print(f"[extractor] Error extracting PDF {path}: {e}")
        return ""


def _extract_html_meta_tags(soup) -> dict:
    """
    Extract meta tags from HTML soup.
    
    Extracts:
    - title (from <title> tag)
    - og:title, og:description, og:url, og:image (Open Graph tags)
    - description, keywords (standard meta tags)
    - Any other meta tags with name or property attributes
    """
    meta = {}
    
    # Extract title
    title_tag = soup.find("title")
    if title_tag:
        meta["title"] = title_tag.get_text(strip=True)
    
    # Extract meta tags
    for meta_tag in soup.find_all("meta"):
        # Check for name attribute (standard meta tags)
        name = meta_tag.get("name", "").lower()
        if name:
            content = meta_tag.get("content", "")
            if content:
                meta[name] = content
        
        # Check for property attribute (Open Graph, etc.)
        property_attr = meta_tag.get("property", "").lower()
        if property_attr:
            content = meta_tag.get("content", "")
            if content:
                meta[property_attr] = content
    
    return meta


def _extract_html_with_metadata(path: Path) -> dict:
    """
    Extract text and metadata from HTML file.
    
    Extracts:
    - Text content (with proper tag stripping)
    - Meta tags: title, og:title, og:description, og:url, og:image, description, keywords, etc.
    
    Returns:
        dict with "text" and "html_meta" keys
    """
    if BeautifulSoup is None:
        print(f"[extractor] beautifulsoup4 not available, attempting plain text extraction for HTML: {path}")
        return {"text": _extract_text_plain(path), "html_meta": {}}
    
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            html_content = f.read()
        
        soup = BeautifulSoup(html_content, "html.parser")
        
        # Extract meta tags BEFORE removing them
        html_meta = _extract_html_meta_tags(soup)
        
        # Remove unwanted elements completely (but keep title for text extraction)
        unwanted_tags = [
            "script", "style", "noscript", "iframe", "embed", "object",
            "meta", "link", "head",  # Head elements (but we already extracted meta)
            "nav", "footer", "aside",  # Navigation/sidebar (optional, but often noise)
        ]
        for tag in unwanted_tags:
            for element in soup.find_all(tag):
                element.decompose()
        
        # Remove comments
        from bs4 import Comment
        for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
            comment.extract()
        
        # Extract text with better structure preservation
        # Get text from body if it exists, otherwise from whole document
        body = soup.find("body")
        if body:
            text_elements = []
            for element in body.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "div", "span"]):
                text = element.get_text(separator=" ", strip=True)
                if text:
                    text_elements.append(text)
            
            # If we got structured text, use it
            if text_elements:
                extracted_text = "\n\n".join(text_elements)
            else:
                # Fallback to body text
                extracted_text = body.get_text(separator="\n", strip=True)
        else:
            # No body tag, extract from whole document
            extracted_text = soup.get_text(separator="\n", strip=True)
        
        # Clean up excessive whitespace
        lines = []
        for line in extracted_text.splitlines():
            line = line.strip()
            if line:
                lines.append(line)
        
        return {
            "text": "\n".join(lines),
            "html_meta": html_meta
        }
    except Exception as e:
        print(f"[extractor] Error extracting HTML {path}: {e}")
        import traceback
        traceback.print_exc()
        return {"text": "", "html_meta": {}}


def _extract_docx(path: Path) -> str:
    """
    Extract text from DOCX file (new Word format).
    
    Extracts:
    - Paragraphs
    - Tables (cell by cell)
    """
    if Document is None:
        print(f"[extractor] python-docx not available, cannot extract DOCX: {path}")
        return ""
    
    try:
        doc = Document(str(path))
        text_parts = []
        
        # Extract paragraphs
        for para in doc.paragraphs:
            if para.text.strip():
                text_parts.append(para.text)
        
        # Extract tables
        for table in doc.tables:
            table_text = []
            for row in table.rows:
                row_text = []
                for cell in row.cells:
                    cell_text = cell.text.strip()
                    if cell_text:
                        row_text.append(cell_text)
                if row_text:
                    table_text.append(" | ".join(row_text))
            if table_text:
                text_parts.append("\n".join(table_text))
        
        return "\n\n".join(text_parts)
    except Exception as e:
        print(f"[extractor] Error extracting DOCX {path}: {e}")
        import traceback
        traceback.print_exc()
        return ""


def _extract_doc(path: Path) -> str:
    """
    Extract text from DOC file (old Word format).
    
    Attempts multiple methods:
    1. Try antiword command-line tool (if available)
    2. Try textract library (if available)
    3. Fallback to plain text reading (limited success)
    """
    # Method 1: Try antiword (command-line tool)
    try:
        result = subprocess.run(
            ["antiword", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, subprocess.SubprocessError):
        pass  # antiword not available or failed
    
    # Method 2: Try textract library
    try:
        import textract
        text = textract.process(str(path), encoding="utf-8").decode("utf-8")
        if text.strip():
            return text.strip()
    except ImportError:
        pass  # textract not available
    except Exception as e:
        print(f"[extractor] textract failed for {path}: {e}")
    
    # Method 3: Fallback - try to read as plain text (limited success)
    print(f"[extractor] Warning: Limited DOC support for {path}. Install 'antiword' or 'textract' for better extraction.")
    try:
        with open(path, "rb") as f:
            # Try to extract readable text from binary
            content = f.read()
            # Look for readable ASCII/UTF-8 sequences
            text = ""
            current_word = b""
            for byte in content:
                if 32 <= byte <= 126 or byte in (9, 10, 13):  # Printable ASCII + tab, newline, carriage return
                    current_word += bytes([byte])
                else:
                    if len(current_word) > 3:  # Only add words longer than 3 chars
                        try:
                            text += current_word.decode("utf-8", errors="ignore") + " "
                        except:
                            pass
                    current_word = b""
            
            if current_word:
                try:
                    text += current_word.decode("utf-8", errors="ignore")
                except:
                    pass
            
            if text.strip():
                return text.strip()
    except Exception as e:
        print(f"[extractor] Fallback extraction failed for {path}: {e}")
    
    return ""

