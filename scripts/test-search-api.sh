#!/bin/bash

# Debug script to test search API
# Usage: ./scripts/test-search-api.sh [base_url] [query]

# Load config from .stress-test.env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.stress-test.env" ]; then
  source "$SCRIPT_DIR/.stress-test.env"
fi

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
QUERY="${2:-test}"

if [ -z "$SESSION_TOKEN" ]; then
  echo "Error: Session token required"
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

echo "Testing: $BASE_URL/api/search?q=$QUERY"
echo "Session Token: ${SESSION_TOKEN:0:30}..."
echo ""

# Test with curl first to see the actual error
echo "=== Testing with curl ==="
curl -v "$BASE_URL/api/search?q=$QUERY" \
  -H "Cookie: $COOKIE_STRING" \
  -H "Accept: application/json" \
  2>&1 | head -40
