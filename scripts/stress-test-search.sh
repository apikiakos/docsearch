#!/bin/bash

# Stress test script for search API
# Usage: ./scripts/stress-test-search.sh [base_url] [query]

# Load config from .stress-test.env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.stress-test.env" ]; then
  source "$SCRIPT_DIR/.stress-test.env"
fi

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
QUERY="${2:-test}"

if [ -z "$SESSION_TOKEN" ]; then
  echo "Error: Session token required"
  echo ""
  echo "Option 1: Create scripts/.stress-test.env with:"
  echo "  SESSION_TOKEN=\"your-token-here\""
  echo ""
  echo "Option 2: Pass as environment variable:"
  echo "  SESSION_TOKEN=\"your-token\" $0 [base_url] [query]"
  echo ""
  echo "Option 3: Pass as argument (deprecated):"
  echo "  $0 [base_url] [session_token] [query]"
  echo ""
  echo "To get a session token:"
  echo "1. Login at $BASE_URL/auth/signin"
  echo "2. Open browser DevTools > Application > Cookies"
  echo "3. Copy the values of 'authjs.session-token' and 'authjs.csrf-token'"
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

echo "=========================================="
echo "Search API Stress Test"
echo "=========================================="
echo "Base URL: $BASE_URL"
echo "Query: $QUERY"
echo "Session Token: ${SESSION_TOKEN:0:20}..."
echo ""

# URL encode the query
ENCODED_QUERY=$(echo -n "$QUERY" | jq -sRr @uri 2>/dev/null || python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read()))" <<< "$QUERY" 2>/dev/null || echo "$QUERY")

# Test 1: Light load - 100 requests, 10 concurrent
echo "Test 1: Light Load (100 requests, 10 concurrent)"
echo "----------------------------------------"
ab -n 100 -c 10 \
  -C "$COOKIE_STRING" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/search?q=$ENCODED_QUERY" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests|Complete requests|Non-2xx responses)"

echo ""
echo ""

# Test 2: Medium load - 500 requests, 25 concurrent
echo "Test 2: Medium Load (500 requests, 25 concurrent)"
echo "----------------------------------------"
ab -n 500 -c 25 \
  -C "$COOKIE_STRING" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/search?q=$ENCODED_QUERY" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests|Complete requests|Non-2xx responses)"

echo ""
echo ""

# Test 3: Heavy load - 1000 requests, 50 concurrent
echo "Test 3: Heavy Load (1000 requests, 50 concurrent)"
echo "----------------------------------------"
ab -n 1000 -c 50 \
  -C "$COOKIE_STRING" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/search?q=$ENCODED_QUERY" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests|Complete requests|Non-2xx responses)"

echo ""
echo ""

# Test 4: Burst test - 200 requests, 100 concurrent (simulates traffic spike)
echo "Test 4: Burst Test (200 requests, 100 concurrent)"
echo "----------------------------------------"
ab -n 200 -c 100 \
  -C "$COOKIE_STRING" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  "$BASE_URL/api/search?q=$ENCODED_QUERY" 2>&1 | grep -E "(Requests per second|Time per request|Failed requests|Complete requests|Non-2xx responses)"

echo ""
echo "=========================================="
echo "Stress test completed!"
echo "=========================================="

