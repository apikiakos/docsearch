# Search API Stress Testing

Simple stress tests for the search API using Apache Bench (`ab`).

## Prerequisites

Install Apache Bench:
```bash
# macOS
brew install httpd

# Ubuntu/Debian
sudo apt-get install apache2-utils

# Or use ab directly if available
```

## Getting Session Tokens

1. Login at `http://localhost:3000/auth/signin` (or your production URL)
2. Open browser DevTools (F12)
3. Go to **Application** tab > **Cookies** > `http://localhost:3000` (or your domain)
4. Copy the **VALUES** of:
   - `authjs.session-token` (required)
   - `authjs.csrf-token` (required)
   - `authjs.callback-url` (optional, usually auto-detected)
5. Update `scripts/.stress-test.env` with these values:
   ```bash
   SESSION_TOKEN="your-session-token-here"
   CSRF_TOKEN="your-csrf-token-here"
   CALLBACK_URL="http%3A%2F%2Flocalhost%3A3000%2F"  # URL-encoded
   ```

**⚠️ IMPORTANT: Token Environment Matching**

Session tokens are encrypted with `AUTH_SECRET`. You **MUST** use:
- **Production tokens** → Only with production URL (`https://docsearch.petesampler.com`)
- **Localhost tokens** → Only with localhost URL (`http://localhost:3000`)

You **CANNOT** use production tokens with localhost or vice versa. If you get "no matching decryption secret" error, you're using tokens from the wrong environment.

## Usage

### Full Test Suite

Runs multiple test scenarios (light, medium, heavy, burst):

```bash
# Loads tokens from scripts/.stress-test.env
./scripts/stress-test-search.sh

# Or override URL and query
./scripts/stress-test-search.sh http://localhost:3000 "search query"
```

### Simple Test

Run a single custom test:

```bash
# Loads tokens from scripts/.stress-test.env
./scripts/stress-test-search-simple.sh

# Or override parameters
./scripts/stress-test-search-simple.sh \
  http://localhost:3000 \
  "search query" \
  100 \    # total requests
  10       # concurrent requests
```

### Direct ab Command

For more control, use `ab` directly:

```bash
ab -n 100 -c 10 \
  -C "authjs.session-token=YOUR_TOKEN; authjs.csrf-token=YOUR_CSRF_TOKEN" \
  -H "Accept: application/json" \
  "http://localhost:3000/api/search?q=test"
```

## Test Scenarios

- **Light Load**: 100 requests, 10 concurrent
- **Medium Load**: 500 requests, 25 concurrent
- **Heavy Load**: 1000 requests, 50 concurrent
- **Burst Test**: 200 requests, 100 concurrent (simulates traffic spike)

## Interpreting Results

Key metrics to watch:
- **Requests per second**: Higher is better
- **Time per request**: Lower is better (should be < 500ms for 95th percentile)
- **Failed requests**: Should be 0
- **Complete requests**: Should match total requests

## Production Testing

For production, update `scripts/.stress-test.env` with production values:

```bash
BASE_URL="https://docsearch.petesampler.com"
SESSION_TOKEN="your-production-session-token"
CSRF_TOKEN="your-production-csrf-token"
CALLBACK_URL="https%3A%2F%2Fdocsearch.petesampler.com%2F"
```

Then run:
```bash
./scripts/stress-test-search.sh
```

**⚠️ Warning**: Be careful with production stress tests - start with low concurrency and gradually increase.

