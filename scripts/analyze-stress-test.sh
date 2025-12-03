#!/bin/bash

# Helper script to analyze stress test results
# Usage: Run your stress test and pipe output to this script, or run this after

echo "=========================================="
echo "Stress Test Results Analysis"
echo "=========================================="
echo ""

# Explanation of ab output
cat << 'EOF'
KEY METRICS:
-----------
• Complete requests: Total requests sent
• Failed requests: Requests with errors (connection, receive, length mismatch, exceptions)
  - Length failures: Different response body lengths (expected when rate limiting)
• Non-2xx responses: HTTP error codes (429 = rate limit, 500 = server error, etc.)

INTERPRETATION:
--------------
✅ GOOD SIGNS:
  - All requests completed (no connection errors)
  - High requests per second
  - Low time per request
  - Some 429 errors = rate limiting is working!

⚠️  WARNING SIGNS:
  - Connection errors (Connect > 0) = server overloaded or down
  - Receive errors (Receive > 0) = network issues
  - Exceptions > 0 = ab crashed or server crashed
  - 500 errors = server errors (check logs)

RATE LIMITING:
-------------
The API has a rate limit of 100 requests per 60 seconds.
- First ~100 requests: Should succeed (200 OK)
- Requests 101+: Should get 429 (Rate Limit Exceeded)
- "Length" failures are normal when you get mixed 200/429 responses

To test without rate limiting, temporarily increase the limit in:
  apps/web/src/app/api/search/route.ts (line 89)
EOF

echo ""
echo "=========================================="

