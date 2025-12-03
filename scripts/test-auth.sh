#!/bin/bash

# Test authentication with curl to see what cookies are needed
# Usage: ./scripts/test-auth.sh [base_url] [session_token]

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

echo "Testing authentication..."
echo "Base URL: $BASE_URL"
echo "Token: ${SESSION_TOKEN:0:30}..."
echo ""

# Try different cookie formats
echo "=== Test 1: next-auth.session-token ==="
curl -v "$BASE_URL/api/search?q=test" \
  -H "Cookie: next-auth.session-token=$SESSION_TOKEN" \
  -H "Accept: application/json" \
  2>&1 | grep -E "(< HTTP|error|Unauthorized|Forbidden)" | head -5

echo ""
echo "=== Test 2: authjs.session-token (NextAuth v5) ==="
curl -v "$BASE_URL/api/search?q=test" \
  -H "Cookie: authjs.session-token=$SESSION_TOKEN" \
  -H "Accept: application/json" \
  2>&1 | grep -E "(< HTTP|error|Unauthorized|Forbidden)" | head -5

echo ""
echo "=== Test 3: __Secure-next-auth.session-token ==="
curl -v "$BASE_URL/api/search?q=test" \
  -H "Cookie: __Secure-next-auth.session-token=$SESSION_TOKEN" \
  -H "Accept: application/json" \
  2>&1 | grep -E "(< HTTP|error|Unauthorized|Forbidden)" | head -5

echo ""
echo "=== Test 4: Check what cookies the browser uses ==="
echo "Open DevTools > Application > Cookies and check the cookie name"
echo "It might be:"
echo "  - next-auth.session-token"
echo "  - authjs.session-token"
echo "  - __Secure-next-auth.session-token"
echo "  - __Host-next-auth.session-token"

