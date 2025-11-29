/**
 * Split a document into overlapping chunks for indexing
 */
export interface Chunk {
  content: string;
  index: number;
  offset: number;
}

export function chunkDocument(
  content: string,
  chunkSize: number = 1000,
  overlap: number = 200
): Chunk[] {
  const chunks: Chunk[] = [];
  let offset = 0;

  while (offset < content.length) {
    const end = Math.min(offset + chunkSize, content.length);
    const chunkContent = content.slice(offset, end);

    chunks.push({
      content: chunkContent,
      index: chunks.length,
      offset,
    });

    // Move forward by chunkSize - overlap to create overlap
    offset += chunkSize - overlap;

    // If we're at the end, break
    if (end >= content.length) {
      break;
    }
  }

  return chunks;
}

