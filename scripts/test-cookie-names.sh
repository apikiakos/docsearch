#!/bin/bash

# Test different cookie name formats for NextAuth v5
# Usage: ./scripts/test-cookie-names.sh [base_url] [session_token]

# Load config from .stress-test.env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.stress-test.env" ]; then
  source "$SCRIPT_DIR/.stress-test.env"
fi

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
SESSION_TOKEN="${2:-$SESSION_TOKEN}"

if [ -z "$SESSION_TOKEN" ]; then
  echo "Error: Session token required"
  exit 1
fi

echo "Testing different cookie names for NextAuth v5..."
echo "Base URL: $BASE_URL"
echo "Token: ${SESSION_TOKEN:0:30}..."
echo ""

# Test 1: next-auth.session-token (NextAuth v4 style)
echo "=== Test 1: next-auth.session-token ==="
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BASE_URL/api/search?q=test" \
  -H "Cookie: next-auth.session-token=$SESSION_TOKEN" \
  -H "Accept: application/json")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
echo ""

# Test 2: authjs.session-token (NextAuth v5 style)
echo "=== Test 2: authjs.session-token ==="
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BASE_URL/api/search?q=test" \
  -H "Cookie: authjs.session-token=$SESSION_TOKEN" \
  -H "Accept: application/json")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
echo ""

# Test 3: __Secure-authjs.session-token (HTTPS secure)
echo "=== Test 3: __Secure-authjs.session-token ==="
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$BASE_URL/api/search?q=test" \
  -H "Cookie: __Secure-authjs.session-token=$SESSION_TOKEN" \
  -H "Accept: application/json")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")
echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"
echo ""

# Test 4: Check what cookies the browser actually sends
echo "=== To find the correct cookie name ==="
echo "1. Open DevTools > Network tab"
echo "2. Make a request to the API from the browser"
echo "3. Check the Request Headers > Cookie"
echo "4. Look for the cookie name that contains your session token"
echo ""

