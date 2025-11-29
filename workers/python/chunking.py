from typing import List, Tuple


def chunk_text(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 200,
) -> List[Tuple[int, str]]:
    """
    Split text into overlapping chunks (word-based).
    Returns list of (chunk_index, chunk_text).
    """
    if not text:
        return []

    words = text.split()
    chunks = []
    start = 0
    chunk_index = 0

    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]
        chunk_text_value = " ".join(chunk_words)
        chunks.append((chunk_index, chunk_text_value))

        # move start forward by chunk_size - overlap
        if end >= len(words):
            break

        start = end - overlap
        chunk_index += 1

    return chunks

