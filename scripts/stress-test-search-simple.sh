#!/bin/bash

# Simple stress test - just run one test
# Usage: ./scripts/stress-test-search-simple.sh [base_url] [query] [requests] [concurrent]

# Load config from .stress-test.env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.stress-test.env" ]; then
  source "$SCRIPT_DIR/.stress-test.env"
fi

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
QUERY="${2:-test}"
REQUESTS="${3:-100}"
CONCURRENT="${4:-10}"

if [ -z "$SESSION_TOKEN" ]; then
  echo "Error: Session token required"
  echo ""
  echo "Create scripts/.stress-test.env with:"
  echo "  SESSION_TOKEN=\"your-token-here\""
  echo "  CSRF_TOKEN=\"your-csrf-token-here\""
  echo ""
  echo "Or set environment variable:"
  echo "  SESSION_TOKEN=\"your-token\" $0 [base_url] [query] [requests] [concurrent]"
  echo ""
  echo "Example:"
  echo "  $0 http://localhost:3000 'search' 100 10"
  exit 1
fi

# Build cookie string with all required cookies
COOKIE_STRING="authjs.session-token=$SESSION_TOKEN"
if [ -n "$CSRF_TOKEN" ]; then
  COOKIE_STRING="$COOKIE_STRING; authjs.csrf-token=$CSRF_TOKEN"
fi
if [ -n "$CALLBACK_URL" ]; then
  COOKIE_STRING="$COOKIE_STRING; authjs.callback-url=$CALLBACK_URL"
fi

# URL encode the query
ENCODED_QUERY=$(echo -n "$QUERY" | jq -sRr @uri 2>/dev/null || python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))" <<< "$QUERY" 2>/dev/null || echo "$QUERY")

echo "Stress Testing: $BASE_URL/api/search?q=$ENCODED_QUERY"
echo "Requests: $REQUESTS | Concurrent: $CONCURRENT"
echo ""
echo "Note: 'Length' failures are expected when rate limiting kicks in (200 OK vs 429 responses)"
echo ""

# Run ab with -l flag to ignore length mismatches (we expect different lengths for 200 vs 429)
ab -n "$REQUESTS" -c "$CONCURRENT" \
  -C "$COOKIE_STRING" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -l \
  "$BASE_URL/api/search?q=$ENCODED_QUERY"

echo ""
echo "=========================================="
echo "Summary:"
echo "=========================================="
echo "- 'Non-2xx responses' = Rate limit errors (429)"
echo "- Rate limit: 100 requests per 60 seconds"
echo "- If you see 429 errors, the rate limiter is working correctly!"
echo "- To test with higher limits, increase the limit in apps/web/src/app/api/search/route.ts"

