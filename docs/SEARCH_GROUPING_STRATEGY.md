# Search Grouping Strategy: ES Collapsing vs App-Side Grouping

## Current Implementation: App-Side Grouping

We currently use **app-side grouping** in the Next.js API route.

### How It Works

1. **Elasticsearch Query**: Search all chunks, return top N chunk hits
2. **App-Side Processing**: Group chunk hits by `document_id` in JavaScript
3. **Aggregation**: Compute document score (max chunk score), combine highlights
4. **Pagination**: Paginate at document level after grouping

### Code Location

`apps/web/src/app/api/search/route.ts` - lines 199-290

```typescript
// Fetch chunks from ES
const searchResult = await elasticsearch.search({
  index: indexPattern,
  query: { ... },
  size: Math.max(100, pageSize * 10), // Fetch enough chunks
});

// Group chunks by document_id in app
const documentMap = new Map<string, DocumentResult>();
for (const hit of searchResult.hits.hits) {
  const documentKey = `${tenant_id}:${document_id}`;
  // Aggregate chunks per document...
}
```

### Pros

✅ **Flexibility**: Full control over grouping logic
✅ **Custom Aggregation**: Easy to implement max score, highlight merging
✅ **Debugging**: Easy to inspect intermediate results
✅ **No ES Version Constraints**: Works with any ES version
✅ **Complex Logic**: Can implement sophisticated scoring/aggregation

### Cons

❌ **Network Overhead**: Must fetch more chunks than needed
❌ **Memory Usage**: Loads all chunk hits into memory
❌ **CPU**: Grouping happens in Node.js, not ES
❌ **Less Efficient**: ES does the work, then we re-process

---

## Alternative: Elasticsearch Collapsing

Elasticsearch supports **field collapsing** which groups results at the ES level.

### How It Would Work

1. **ES Collapse**: Use `collapse` parameter to group by `document_id`
2. **Inner Hits**: Get top chunks per document via `inner_hits`
3. **ES Returns**: One result per document (already grouped)
4. **App Processing**: Just format the results, no grouping needed

### Implementation Example

```typescript
const searchResult = await elasticsearch.search({
  index: indexPattern,
  query: { ... },
  collapse: {
    field: "document_id",
    inner_hits: {
      name: "chunks",
      size: 5, // Top 5 chunks per document
      highlight: {
        fields: {
          content: { fragment_size: 200, number_of_fragments: 3 }
        }
      },
      sort: [{ _score: { order: "desc" } }] // Best chunks first
    }
  },
  size: pageSize, // Direct pagination at document level
  sort: [{ _score: { order: "desc" } }]
});

// Results are already grouped - just format
const results = searchResult.hits.hits.map((hit) => {
  const bestChunk = hit.inner_hits?.chunks?.hits?.hits?.[0];
  return {
    document_id: hit._source.document_id,
    score: hit._score, // ES already computed max score
    highlights: bestChunk?.highlight?.content || [],
    // ...
  };
});
```

### Pros

✅ **Efficiency**: ES does grouping, less data transfer
✅ **Performance**: ES optimized for this operation
✅ **Memory**: Only fetch what you need
✅ **Pagination**: Direct document-level pagination
✅ **Scalability**: Better for large result sets

### Cons

❌ **Less Flexible**: Limited to ES's grouping capabilities
❌ **Complex Aggregation**: Harder to implement custom scoring
❌ **Inner Hits Limitation**: Can't easily aggregate all matching chunks
❌ **ES Version**: Requires ES 6.3+ (we have 8.15.0, so OK)

---

## Recommendation

### For Prototype: **App-Side Grouping** (Current)

- ✅ Easier to implement and debug
- ✅ Full control over aggregation logic
- ✅ Can easily combine highlights from multiple chunks
- ✅ Works well for prototype scale

### For Production: **ES Collapsing** (Consider Migration)

- ✅ Better performance at scale
- ✅ Less network/memory overhead
- ✅ ES handles pagination efficiently
- ⚠️ May need to adjust highlight aggregation logic

---

## Hybrid Approach

You could also use a **hybrid**:

1. Use ES collapsing for initial grouping
2. Use inner_hits to get top chunks per document
3. Do light app-side processing for highlight merging

This gives you ES efficiency with app-side flexibility.

---

## Current Implementation Details

### Grouping Key

```typescript
const documentKey = `${tenant_id}:${document_id}`;
```

Ensures uniqueness across tenants (document_id might not be globally unique).

### Score Aggregation

```typescript
// Document score = max chunk score
if (score > existing.bestChunkScore) {
  existing.score = score;
}
```

### Highlight Merging

```typescript
// Combine highlights from multiple chunks (up to 5)
existing.highlights = [
  ...existing.highlights,
  ...highlights.content,
].filter((h, i, arr) => arr.indexOf(h) === i) // Remove duplicates
 .slice(0, 5);
```

### Fetch Strategy

```typescript
size: Math.max(100, pageSize * 10)
```

Fetches enough chunks to account for grouping (multiple chunks per document).

---

## Migration Path (If Needed)

If you want to switch to ES collapsing:

1. Update ES query to use `collapse` parameter
2. Process `inner_hits` instead of grouping manually
3. Adjust highlight aggregation to use inner_hits
4. Update pagination (now direct at document level)
5. Test thoroughly (behavior may differ slightly)

The current app-side approach is perfectly fine for a prototype and gives you more control.

