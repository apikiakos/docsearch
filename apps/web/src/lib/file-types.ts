import {
  FileText,
  File,
  FileSpreadsheet,
  FileCode,
  FileImage,
  FileVideo,
  FileAudio,
  FileJson,
  FileType,
  FileQuestion,
} from "lucide-react";
import { LucideIcon } from "lucide-react";

export type FileTypeInfo = {
  name: string;
  icon: LucideIcon;
};

/**
 * Normalize MIME type or extension to a clean file type name
 */
export function normalizeFileType(mimeType?: string, filename?: string): string {
  // Try filename extension first (more reliable)
  if (filename) {
    const parts = filename.split(".");
    if (parts.length > 1) {
      const ext = parts[parts.length - 1].toLowerCase();
      const extMap: Record<string, string> = {
        // Documents
        doc: "DOC",
        docx: "DOCX",
        rtf: "RTF",
        odt: "ODT",
        // Spreadsheets
        xls: "XLS",
        xlsx: "XLSX",
        ods: "ODS",
        csv: "CSV",
        // Presentations
        ppt: "PPT",
        pptx: "PPTX",
        odp: "ODP",
        // Text
        txt: "TXT",
        md: "MD",
        markdown: "MD",
        // Web
        html: "HTML",
        htm: "HTML",
        css: "CSS",
        js: "JS",
        jsx: "JSX",
        ts: "TS",
        tsx: "TSX",
        // Data
        json: "JSON",
        xml: "XML",
        yaml: "YAML",
        yml: "YAML",
        // Images
        jpg: "JPG",
        jpeg: "JPG",
        png: "PNG",
        gif: "GIF",
        svg: "SVG",
        webp: "WEBP",
        // Archives
        zip: "ZIP",
        tar: "TAR",
        gz: "GZ",
        rar: "RAR",
        "7z": "7Z",
        // Audio
        mp3: "MP3",
        wav: "WAV",
        ogg: "OGG",
        // Video
        mp4: "MP4",
        avi: "AVI",
        mkv: "MKV",
        mov: "MOV",
      };
      if (extMap[ext]) {
        return extMap[ext];
      }
    }
  }

  // Try MIME type
  if (mimeType) {
    const mime = mimeType.toLowerCase();
    
    // Handle complex MIME types
    if (mime.includes("vnd.openxmlformats-officedocument.wordprocessingml.document")) {
      return "DOCX";
    }
    if (mime.includes("vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
      return "XLSX";
    }
    if (mime.includes("vnd.openxmlformats-officedocument.presentationml.presentation")) {
      return "PPTX";
    }
    if (mime.includes("msword")) {
      return "DOC";
    }
    if (mime.includes("ms-excel")) {
      return "XLS";
    }
    if (mime.includes("ms-powerpoint")) {
      return "PPT";
    }
    if (mime.includes("oasis.opendocument.text")) {
      return "ODT";
    }
    if (mime.includes("oasis.opendocument.spreadsheet")) {
      return "ODS";
    }
    if (mime.includes("oasis.opendocument.presentation")) {
      return "ODP";
    }
    
    // Handle simple MIME types
    const mimeMap: Record<string, string> = {
      "application/pdf": "PDF",
      "text/plain": "TXT",
      "text/markdown": "MD",
      "text/html": "HTML",
      "text/css": "CSS",
      "text/javascript": "JS",
      "application/javascript": "JS",
      "application/json": "JSON",
      "application/xml": "XML",
      "text/xml": "XML",
      "text/yaml": "YAML",
      "text/csv": "CSV",
      "image/jpeg": "JPG",
      "image/png": "PNG",
      "image/gif": "GIF",
      "image/svg+xml": "SVG",
      "image/webp": "WEBP",
      "application/zip": "ZIP",
      "application/x-tar": "TAR",
      "application/gzip": "GZ",
      "audio/mpeg": "MP3",
      "audio/wav": "WAV",
      "video/mp4": "MP4",
      "video/avi": "AVI",
    };
    
    if (mimeMap[mime]) {
      return mimeMap[mime];
    }
    
    // Extract from MIME type structure (type/subtype)
    const parts = mime.split("/");
    if (parts.length > 1) {
      const subtype = parts[1].split(";")[0].trim(); // Remove parameters
      // Capitalize and return
      return subtype.toUpperCase().replace(/[-_]/g, "");
    }
  }

  return "UNKNOWN";
}

/**
 * Get file type info (name and icon) for a given file type string
 */
export function getFileTypeInfo(fileType: string): FileTypeInfo {
  // If it looks like a MIME type (contains / or vnd. or application/), normalize it first
  const lowerType = fileType.toLowerCase();
  if (lowerType.includes("/") || lowerType.includes("vnd.") || lowerType.includes("application/") || lowerType.includes("text/")) {
    // It's a MIME type, normalize it
    const normalized = normalizeFileType(fileType);
    return getFileTypeInfoFromNormalized(normalized);
  }
  
  // Otherwise, treat it as already normalized or an extension
  let normalized = fileType.toUpperCase();
  
  // Handle ugly MIME types that might already be uppercase
  if (normalized.includes("VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT") ||
      normalized.includes("VNDOPENXMLFORMATSOFFICEDOCUMENTWORDPROCESSINGMLDOCUMENT")) {
    normalized = "DOCX";
  } else if (normalized.includes("VND.OPENXMLFORMATS-OFFICEDOCUMENT.SPREADSHEETML.SHEET") ||
             normalized.includes("VNDOPENXMLFORMATSOFFICEDOCUMENTSPREADSHEETMLSHEET")) {
    normalized = "XLSX";
  } else if (normalized.includes("VND.OPENXMLFORMATS-OFFICEDOCUMENT.PRESENTATIONML.PRESENTATION") ||
             normalized.includes("VNDOPENXMLFORMATSOFFICEDOCUMENTPRESENTATIONMLPRESENTATION")) {
    normalized = "PPTX";
  } else if (normalized.includes("MSWORD")) {
    normalized = "DOC";
  } else if (normalized.includes("MS-EXCEL") || normalized.includes("MSEXCEL")) {
    normalized = "XLS";
  } else if (normalized.includes("MS-POWERPOINT") || normalized.includes("MSPOWERPOINT")) {
    normalized = "PPT";
  } else if (normalized.includes("OASIS.OPENDOCUMENT.TEXT") || normalized.includes("OASISOPENDOCUMENTTEXT")) {
    normalized = "ODT";
  } else if (normalized.includes("OASIS.OPENDOCUMENT.SPREADSHEET") || normalized.includes("OASISOPENDOCUMENTSPREADSHEET")) {
    normalized = "ODS";
  } else if (normalized.includes("OASIS.OPENDOCUMENT.PRESENTATION") || normalized.includes("OASISOPENDOCUMENTPRESENTATION")) {
    normalized = "ODP";
  }
  
  return getFileTypeInfoFromNormalized(normalized);
}

/**
 * Get file type info from a normalized file type string
 */
function getFileTypeInfoFromNormalized(normalized: string): FileTypeInfo {
  
  const iconMap: Record<string, LucideIcon> = {
    // Documents
    DOC: FileText,
    DOCX: FileText,
    RTF: FileText,
    ODT: FileText,
    TXT: FileText,
    MD: FileText,
    MARKDOWN: FileText,
    PDF: FileText,
    // Spreadsheets
    XLS: FileSpreadsheet,
    XLSX: FileSpreadsheet,
    ODS: FileSpreadsheet,
    CSV: FileSpreadsheet,
    // Presentations
    PPT: FileType,
    PPTX: FileType,
    ODP: FileType,
    // Code
    HTML: FileCode,
    CSS: FileCode,
    JS: FileCode,
    JSX: FileCode,
    TS: FileCode,
    TSX: FileCode,
    JSON: FileJson,
    XML: FileCode,
    YAML: FileCode,
    // Images
    JPG: FileImage,
    JPEG: FileImage,
    PNG: FileImage,
    GIF: FileImage,
    SVG: FileImage,
    WEBP: FileImage,
    // Archives
    ZIP: File,
    TAR: File,
    GZ: File,
    RAR: File,
    "7Z": File,
    // Audio
    MP3: FileAudio,
    WAV: FileAudio,
    OGG: FileAudio,
    // Video
    MP4: FileVideo,
    AVI: FileVideo,
    MKV: FileVideo,
    MOV: FileVideo,
  };

  return {
    name: normalized,
    icon: iconMap[normalized] || FileQuestion,
  };
}

/**
 * Get file type from metadata (used in API routes)
 */
export function getFileType(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return "UNKNOWN";
  
  const mime = metadata.mime as string | undefined;
  const filename = metadata.filename as string | undefined;
  
  return normalizeFileType(mime, filename);
}

