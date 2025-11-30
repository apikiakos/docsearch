# Document Extraction

The consumer uses `document_extractor.py` to extract text from various file formats.

## Supported Formats

### Fully Supported
- **text/plain** (.txt) - Direct file reading
- **text/markdown** (.md, .markdown) - Direct file reading
- **application/pdf** (.pdf) - Uses `pdfminer.six`
- **text/html** (.html, .htm) - Uses `beautifulsoup4` with proper tag stripping
- **application/vnd.openxmlformats-officedocument.wordprocessingml.document** (.docx) - Uses `python-docx` (extracts paragraphs and tables)

### Partially Supported
- **application/msword** (.doc) - Old Word format
  - **Best**: Install `antiword` command-line tool for full support
  - **Alternative**: Install `textract` Python library
  - **Fallback**: Basic binary text extraction (limited success)

## MIME Type Detection

Producers detect MIME types using:
1. **python-magic** (libmagic) - Reads actual file content (most accurate)
2. **File extension** - Fallback if python-magic not available
3. **HTTP Content-Type header** - For remote resources (http_producer)

The consumer uses the MIME type from the RabbitMQ message to select the appropriate extraction method.

## Installation

Required packages (already in `requirements.txt`):
```bash
pip install pdfminer.six beautifulsoup4 python-docx python-magic
```

Optional for better DOC support:
```bash
# Option 1: Install antiword (system package)
# macOS: brew install antiword
# Ubuntu/Debian: sudo apt-get install antiword

# Option 2: Install textract (Python)
pip install textract
```

## HTML Extraction Details

The HTML extractor:
- Removes: `script`, `style`, `noscript`, `iframe`, `embed`, `object`, `meta`, `link`, `head`, `title`
- Removes HTML comments
- Preserves structure from: `p`, `h1-h6`, `li`, `td`, `th`, `div`, `span`
- Extracts text with proper line breaks
- Cleans up excessive whitespace

## DOCX Extraction Details

The DOCX extractor:
- Extracts all paragraphs
- Extracts tables (cell by cell, row by row)
- Preserves structure with line breaks

## Error Handling

If extraction fails:
- Logs error with traceback
- Returns empty string
- Consumer skips indexing (logs warning)

