#!/bin/bash

# Helper script to extract session token from browser
# Usage: ./scripts/get-session-token.sh

echo "=========================================="
echo "How to Get Session Token"
echo "=========================================="
echo ""
echo "1. Open your browser and login to the app"
echo "2. Open DevTools (F12 or Cmd+Option+I)"
echo "3. Go to: Application tab > Cookies"
echo "4. Select your domain (localhost:3000 or docsearch.petesampler.com)"
echo "5. Find the cookie named: 'next-auth.session-token'"
echo "6. Copy the VALUE (not the name)"
echo ""
echo "Then update scripts/.stress-test.env with:"
echo "  SESSION_TOKEN=\"your-token-value-here\""
echo ""
echo "=========================================="
echo "IMPORTANT: Token Environment Matching"
echo "=========================================="
echo ""
echo "Session tokens are encrypted with AUTH_SECRET:"
echo "  - Token from PRODUCTION → Use with production URL"
echo "  - Token from LOCALHOST → Use with localhost URL"
echo ""
echo "You CANNOT use a production token with localhost or vice versa!"
echo ""

