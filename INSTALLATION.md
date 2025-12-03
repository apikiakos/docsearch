# Installation and Launch Guide

This guide walks you through setting up and running the distributed document search service from scratch.

## Prerequisites

Before you begin, ensure you have:

- **Node.js v20.19.6** (required - see installation below)
- **pnpm >= 9.7.0** - Package manager
- **Docker & Docker Compose** - For running PostgreSQL, Elasticsearch, Redis, and RabbitMQ
- **Python 3.11+** - For document ingestion workers
- **Git** - To clone the repository

## Step 1: Install Node.js v20.19.6

The project requires **Node.js v20.19.6** exactly. The project includes `.nvmrc` and `.node-version` files for automatic version switching.

### Option A: Using NVM (Node Version Manager) - Recommended

1. **Install NVM** (if not already installed):
   ```bash
   # macOS/Linux
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
   
   # Or on macOS with Homebrew
   brew install nvm
   ```

2. **Install and use Node.js v20.19.6**:
   ```bash
   nvm install 20.19.6
   nvm use 20.19.6
   ```

3. **Verify installation**:
   ```bash
   node --version  # Should output: v20.19.6
   ```

### Option B: Using Native Node.js Installation

1. **Download Node.js v20.19.6** from [nodejs.org](https://nodejs.org/)
   - Direct download: https://nodejs.org/dist/v20.19.6/

2. **Install** following the installer instructions for your OS

3. **Verify installation**:
   ```bash
   node --version  # Should output: v20.19.6
   ```

### Install pnpm

```bash
npm install -g pnpm@latest
pnpm --version  # Should be >= 9.7.0
```

## Step 2: Clone and Setup Project

1. **Clone the repository** (if not already done):
   ```bash
   git clone <repository-url>
   cd distributed-docsearch-prototype
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

## Step 3: Configure Environment Variables

1. **Create `.env` file** in the project root (not in `apps/web/`):
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env`** with your configuration. The minimum required variables are:

   ```env
   # Database
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch?schema=public"

   # NextAuth
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_URL_INTERNAL="http://localhost:3000"

   # Elasticsearch
   ELASTICSEARCH_URL="http://localhost:9200"

   # Redis
   REDIS_URL="redis://localhost:6379"

   # Admin Interface Configuration
   # Comma-separated list of tenant slugs to display in admin interface
   ADMIN_TENANTS_LIST="s3-tenant-1,s3-tenant-2,gutenberg"
   ```

   **Note**: The `ADMIN_TENANTS_LIST` should contain the three core tenants: `s3-tenant-1`, `s3-tenant-2`, and `gutenberg`.

   For production, also set:
   ```env
   NEXTAUTH_URL="https://your-production-domain.com"
   ```

   For AWS S3 features (required for S3 producers):
   ```env
   AWS_ACCESS_KEY_ID=""
   AWS_SECRET_ACCESS_KEY="your-secret-access-key"
   AWS_DEFAULT_REGION="eu-west-1"
   AWS_S3_BUCKET="document-search-tenants"
   ```

## Step 4: Start Docker Services

Start all required services (PostgreSQL, Elasticsearch, Redis, RabbitMQ):

```bash
docker compose up -d
```

This starts:
- **PostgreSQL** on port `5432`
- **Elasticsearch** on port `9200`
- **Redis** on port `6379`
- **RabbitMQ** on ports `5672` (AMQP) and `15672` (Management UI)

**Verify services are running**:
```bash
docker compose ps
```

You should see all services with status "Up".

**Optional**: Access RabbitMQ Management UI at http://localhost:15672 (username: `guest`, password: `guest`)

## Step 5: Initialize Database

1. **Generate Prisma client**:
   ```bash
   pnpm --filter web db:generate
   ```

2. **Push database schema** (creates tables):
   ```bash
   pnpm --filter web db:push
   ```

   This creates all necessary tables including:
   - `users` - User accounts
   - `tenants` - Tenant organizations
   - `memberships` - User-tenant relationships
   - `file_manifest` - Document change tracking

3. **Seed the database** (creates initial users and tenants):
   ```bash
   pnpm --filter web db:seed
   ```

   This creates:
   - **3 Tenants**: `s3-tenant-1`, `s3-tenant-2`, `gutenberg`
   - **1 Admin User**: `admin@example.com` (password: `admin123`) with access to all tenants
   - **3 Tenant Users**:
     - `s3-tenant-1@example.com` (password: `user123`) → `s3-tenant-1` tenant
     - `s3-tenant-2@example.com` (password: `user123`) → `s3-tenant-2` tenant
     - `gutenberg@example.com` (password: `user123`) → `gutenberg` tenant

## Step 6: Start the Web Application

Start the Next.js development server:

```bash
pnpm --filter web dev
```

The application will be available at **http://localhost:3000**

You can now:
- Login with `admin@example.com` / `admin123` to access all tenants
- Login with tenant user credentials to access specific tenant data
- Navigate to the dashboard, search documents, and manage tenants

## Step 7: Document Ingestion (Python Workers)

The system uses Python workers to ingest documents from various sources. The ingestion pipeline works as follows:

```
[Sources] → [Producers] → [RabbitMQ Queue] → [Consumer] → [Elasticsearch]
```

### Architecture Overview

- **Producers**: Discover documents and enqueue them to RabbitMQ
  - **Gutenberg Producer** (`gutenberg_producer.py`): Fetches books from Project Gutenberg
  - **S3 Producer** (`s3_producer.py`): Discovers documents from S3 buckets (for `s3-tenant-1` and `s3-tenant-2`)

- **Consumer** (`consumer.py`): Processes queued documents, extracts text, chunks content, and indexes to Elasticsearch

- **Manifest System**: Tracks document state in PostgreSQL to avoid re-indexing unchanged files

### Setup Python Environment

1. **Navigate to Python workers directory**:
   ```bash
   cd workers/python
   ```

2. **Create virtual environment** (if not already created):
   ```bash
   python3 -m venv venv
   ```

3. **Activate virtual environment**:
   ```bash
   # macOS/Linux
   source venv/bin/activate
   
   # Windows
   venv\Scripts\activate
   ```

4. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

5. **Verify setup**:
   ```bash
   python test_setup.py
   ```

   This should verify:
   - All packages installed correctly
   - RabbitMQ connection works
   - Elasticsearch connection works
   - PostgreSQL connection works

### Running the Ingestion Pipeline

You'll need **multiple terminal tabs/windows** to run the complete ingestion pipeline:

#### Terminal Tab 1: FastAPI Service (Required for UI Producer Triggers)

The FastAPI service provides HTTP endpoints for triggering producers from the web UI. **Keep this running** if you want to use the "Run Producer" buttons in the admin interface.

```bash
cd workers/python
source venv/bin/activate  # If not already activated
python fastapi_service.py
```

You should see:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

The service will be available at **http://localhost:8000**

**Optional**: Test the health endpoint:
```bash
curl http://localhost:8000/health
```

**Keep this terminal open** - the FastAPI service handles producer triggers from the web UI.

#### Terminal Tab 2: Consumer (Required)

The consumer processes documents from the RabbitMQ queue. **Keep this running** while ingesting documents.

```bash
cd workers/python
source venv/bin/activate  # If not already activated
python consumer.py
```

You should see:
```
[consumer] Waiting for messages. Press Ctrl+C to exit.
```

**Keep this terminal open** - the consumer will process documents as they're enqueued.

#### Terminal Tab 3: Gutenberg Producer (Optional - Manual Run)

To manually index books from Project Gutenberg (you can also use the UI "Run Producer" button):

```bash
cd workers/python
source venv/bin/activate  # If not already activated
python gutenberg_producer.py --check-existing  # Check existing documents
python gutenberg_producer.py --fetch-new 50     # Fetch 50 new books
```

This fetches books from the Gutendex API and enqueues them for the `gutenberg` tenant.

**Note**: You can also trigger producers from the web UI (requires FastAPI service running).

#### Terminal Tab 4: S3 Producer (Optional - Manual Run)

If you have S3 buckets configured:

```bash
cd workers/python
source venv/bin/activate  # If not already activated
python s3_producer.py s3-tenant-1  # or s3-tenant-2
```

### Summary: Terminal Setup

**Minimum setup** (just to test the system):
- **Tab 1**: Web server (`pnpm --filter web dev`) - **Required**
- **Tab 2**: Consumer (`python consumer.py`) - **Required**

**Full setup with UI producer triggers**:
- **Tab 1**: Web server (`pnpm --filter web dev`) - **Required**
- **Tab 2**: FastAPI service (`python fastapi_service.py`) - **Required for UI producer buttons**
- **Tab 3**: Consumer (`python consumer.py`) - **Required**

**Optional manual producers** (can also be triggered from UI):
- **Tab 4**: Gutenberg producer (`python gutenberg_producer.py --fetch-new 50`) - Optional
- **Tab 5**: S3 producer (`python s3_producer.py s3-tenant-1 --fetch-new 100`) - Optional

### How It Works

1. **Producers** scan for documents (HTTP sources, S3)
2. **Change Detection**: Producers compare current state with PostgreSQL `file_manifest` table
3. **Enqueue**: Only new or changed documents are sent to RabbitMQ `doc_ingest` queue
4. **Consumer** picks up messages from the queue
5. **Processing**: Consumer extracts text, chunks content (with overlap), and indexes to Elasticsearch
6. **Manifest Update**: Consumer updates the manifest with indexing status

### Monitoring

- **RabbitMQ UI**: http://localhost:15672 (guest/guest) - See queue status and messages
- **Elasticsearch**: `curl http://localhost:9200/_cat/indices` - List all indices
- **Check document count**: `curl http://localhost:9200/docs_<tenant>/_count`

## Verification Checklist

After setup, verify everything is working:

- [ ] Node.js v20.19.6 is active (`node --version`)
- [ ] Docker services are running (`docker compose ps`)
- [ ] Database is seeded (can login with `admin@example.com`)
- [ ] Web app is accessible at http://localhost:3000
- [ ] Consumer is running and waiting for messages
- [ ] RabbitMQ UI is accessible at http://localhost:15672
- [ ] Elasticsearch is responding (`curl http://localhost:9200`)

## Troubleshooting

### Node.js Version Issues

If you see Prisma errors or build failures:
```bash
# Verify Node version
node --version  # Must be v20.19.6

# If using nvm, ensure correct version is active
nvm use 20.19.6
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker compose ps postgres

# Test connection
psql postgresql://postgres:postgres@localhost:5432/docsearch
```

### Elasticsearch Not Responding

```bash
# Check Elasticsearch is running
docker compose ps elasticsearch

# Test connection
curl http://localhost:9200
```

### Consumer Not Processing Messages

1. **Check RabbitMQ queue**:
   - Visit http://localhost:15672
   - Go to "Queues" tab
   - Check `doc_ingest` queue has messages

2. **Check consumer logs** for errors

3. **Verify Python dependencies**:
   ```bash
   cd workers/python
   python test_setup.py
   ```

### Can't Login

- Verify database is seeded: `pnpm --filter web db:seed`
- Check `.env` file has correct `DATABASE_URL`
- Ensure Docker services are running

## Next Steps

- **Search Documents**: Use the web interface at http://localhost:3000/dashboard/documents
- **Index Documents**: Run producers to ingest documents
- **Monitor**: Check RabbitMQ UI and Elasticsearch indices
- **API Testing**: Use the API endpoints (see main README.md)

For more details, see:
- [Main README.md](./README.md) - Project overview and API documentation

