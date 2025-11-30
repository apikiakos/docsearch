"use client";

import { useMemo } from "react";

/**
 * Lightweight JSON syntax highlighter using CSS classes
 * No external dependencies, pure CSS styling
 */
export function JsonHighlight({ data }: { data: unknown }) {
  const jsonString = useMemo(() => {
    return JSON.stringify(data, null, 2);
  }, [data]);

  // Simple token-based highlighting
  const highlightedJson = useMemo(() => {
    let result = jsonString;
    
    // Highlight strings (including keys)
    result = result.replace(/("(?:[^"\\]|\\.)*")(\s*:)?/g, (match, str, colon) => {
      const escaped = escapeHtml(str);
      if (colon) {
        return `<span class="json-key">${escaped}</span><span class="json-punctuation">${escapeHtml(colon)}</span>`;
      }
      return `<span class="json-string">${escaped}</span>`;
    });
    
    // Highlight booleans
    result = result.replace(/\b(true|false)\b/g, (match) => {
      return `<span class="json-boolean">${escapeHtml(match)}</span>`;
    });
    
    // Highlight null
    result = result.replace(/\bnull\b/g, (match) => {
      return `<span class="json-null">${escapeHtml(match)}</span>`;
    });
    
    // Highlight numbers
    result = result.replace(/-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, (match) => {
      // Don't highlight if it's part of a string (already highlighted)
      if (match.includes('"')) return match;
      return `<span class="json-number">${escapeHtml(match)}</span>`;
    });
    
    // Highlight punctuation (brackets, braces, commas)
    result = result.replace(/([{}[\]])/g, (match) => {
      return `<span class="json-punctuation">${escapeHtml(match)}</span>`;
    });
    
    return result;
  }, [jsonString]);

  return (
    <pre className="text-xs text-[#d4d4d4] font-mono leading-relaxed">
      <code 
        className="json-highlight"
        dangerouslySetInnerHTML={{ __html: highlightedJson }}
      />
    </pre>
  );
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

