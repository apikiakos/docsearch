# Distributed Document Search Service

A prototype distributed document search service with multi-tenancy support, built for enterprise technical assessment.

## ⚡ Quick Start for Interview/Demo

**IMPORTANT**: You need **3 separate terminal windows** open to run the complete system:

1. **Terminal 1**: Web Server (`pnpm --filter web dev`)
2. **Terminal 2**: FastAPI Service (`cd workers/python && source venv/bin/activate && python fastapi_service.py`)
3. **Terminal 3**: Consumer (`cd workers/python && source venv/bin/activate && python consumer.py`)

See the [Quick Start](#quick-start) section below for detailed instructions.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Production Deployment](#production-deployment)
- [Default Users & Passwords](#default-users--passwords)
- [Architecture Overview](#architecture-overview)
- [Document Ingestion Pipeline](#document-ingestion-pipeline)
- [API Documentation](#api-documentation)
- [Infrastructure](#infrastructure)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- **Node.js v20.19.6** (required - see installation below)
- **pnpm >= 9.7.0** - Package manager
- **Docker & Docker Compose** - For running PostgreSQL, Elasticsearch, Redis, and RabbitMQ
- **Python 3.11+** - For document ingestion workers
- **Git** - To clone the repository

### Installing Node.js v20.19.6

The project requires **Node.js v20.19.6** exactly. The project includes `.nvmrc` and `.node-version` files for automatic version switching.

#### Option A: Using NVM (Node Version Manager) - Recommended

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

#### Option B: Using Native Node.js Installation

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

## Installation

### Step 1: Clone and Setup Project

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd distributed-docsearch-prototype
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

### Step 2: Configure Environment Variables

1. **Create `.env` file** in the project root (not in `apps/web/`):
   ```bash
   cp .env.example .env  # If .env.example exists
   ```

2. **Edit `.env`** with your configuration. The minimum required variables are:

   ```env
   # Database
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch?schema=public"

   # NextAuth
   NEXTAUTH_URL="http://localhost:3000"
   NEXTAUTH_URL_INTERNAL="http://localhost:3000"
   # For production, use: NEXTAUTH_URL="https://your-production-domain.com"

   # Elasticsearch
   ELASTICSEARCH_URL="http://localhost:9200"

   # Redis
   REDIS_URL="redis://localhost:6379"

   # RabbitMQ (for Python workers)
   RABBITMQ_URL="amqp://guest:guest@localhost:5672/%2F"
   RABBITMQ_QUEUE_NAME="doc_ingest"

   # Admin Interface Configuration (optional)
   # Comma-separated list of tenant slugs to display in admin interface
   ADMIN_TENANTS_LIST="s3-tenant-1,s3-tenant-2,gutenberg"
   ```

   For AWS S3 features (required for S3 producers):
   ```env
   AWS_ACCESS_KEY_ID="your-access-key-id"
   AWS_SECRET_ACCESS_KEY="your-secret-access-key"
   AWS_DEFAULT_REGION="eu-west-1"
   AWS_S3_BUCKET="document-search-tenants"
   ```

   **Note**: 
   - Next.js automatically loads `.env` from the project root (configured in `next.config.ts`)
   - Prisma config files are updated to load from the root `.env` as well
   - Python scripts load from the root `.env` file

### Step 3: Start Docker Services

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

### Step 4: Initialize Database

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

### Step 5: Setup Python Workers (Optional)

The system uses Python workers to ingest documents from various sources. If you plan to use document ingestion:

1. **Navigate to Python workers directory**:
   ```bash
   cd workers/python
   ```

2. **Create virtual environment**:
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

## Quick Start

After completing the installation steps above, you need to start multiple services in **separate terminal windows/tabs**. Here's the complete setup:

### Required Terminal Windows

You need **3 terminal windows** open to run the complete system:

#### Terminal 1: Web Server (Required)

**Purpose**: Runs the Next.js web application

```bash
# From project root
pnpm --filter web dev
```

**What you'll see**:
```
▲ Next.js 16.0.5
- Local:        http://localhost:3000
```

**Keep this terminal open** - The web application will be available at **http://localhost:3000**

---

#### Terminal 2: FastAPI Service (Required for Document Indexing)

**Purpose**: Provides HTTP endpoints for triggering document producers from the web UI. **This is required if you want to use the "Run Indexing" buttons in the admin interface.**

```bash
# Navigate to Python workers directory
cd workers/python

# Activate virtual environment
source venv/bin/activate  # On macOS/Linux
# OR on Windows: venv\Scripts\activate

# Start FastAPI service
python fastapi_service.py
```

**What you'll see**:
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

**Keep this terminal open** - The FastAPI service will be available at **http://localhost:8000**

**Important**: Without this service running, the "Run Indexing" buttons in the web UI will not work.

---

#### Terminal 3: Consumer (Required for Document Processing)

**Purpose**: Processes documents from the RabbitMQ queue, extracts text, chunks content, and indexes to Elasticsearch.

```bash
# Navigate to Python workers directory
cd workers/python

# Activate virtual environment (if not already activated)
source venv/bin/activate  # On macOS/Linux
# OR on Windows: venv\Scripts\activate

# Start consumer
python consumer.py
```

**What you'll see**:
```
[consumer] Waiting for messages. Press Ctrl+C to exit.
```

**Keep this terminal open** - The consumer will process documents as they're enqueued by producers.

**Important**: Without this service running, documents will be queued but never indexed into Elasticsearch.

---

### Complete Terminal Setup Summary

For a **fully functional system**, you need these **3 terminals** running simultaneously:

| Terminal | Service | Command | Required? |
|----------|---------|---------|-----------|
| **Terminal 1** | Web Server | `pnpm --filter web dev` | ✅ **Yes** |
| **Terminal 2** | FastAPI Service | `cd workers/python && source venv/bin/activate && python fastapi_service.py` | ✅ **Yes** (for UI indexing) |
| **Terminal 3** | Consumer | `cd workers/python && source venv/bin/activate && python consumer.py` | ✅ **Yes** (for document processing) |

### Quick Start Commands (Copy & Paste)

**Terminal 1 - Web Server**:
```bash
pnpm --filter web dev
```

**Terminal 2 - FastAPI Service**:
```bash
cd workers/python
source venv/bin/activate
python fastapi_service.py
```

**Terminal 3 - Consumer**:
```bash
cd workers/python
source venv/bin/activate
python consumer.py
```

### What Each Service Does

1. **Web Server** (Terminal 1): 
   - Serves the Next.js application
   - Handles user authentication
   - Provides search interface
   - Displays documents and tenant management

2. **FastAPI Service** (Terminal 2):
   - Receives requests from web UI to trigger document producers
   - Runs producers in the background (Gutenberg, S3, Uploads)
   - Enqueues documents to RabbitMQ for processing

3. **Consumer** (Terminal 3):
   - Listens to RabbitMQ queue
   - Processes queued documents
   - Extracts text from files (PDF, DOCX, HTML, etc.)
   - Chunks content and indexes to Elasticsearch
   - Updates manifest with indexing status

### Testing the Setup

1. **Open 3 separate terminal windows** (not tabs - separate windows are easier to monitor)
2. **Start Terminal 1** (Web Server):
   ```bash
   pnpm --filter web dev
   ```
   Wait until you see: `▲ Next.js 16.0.5 - Local: http://localhost:3000`

3. **Start Terminal 2** (FastAPI Service):
   ```bash
   cd workers/python
   source venv/bin/activate
   python fastapi_service.py
   ```
   Wait until you see: `INFO: Uvicorn running on http://0.0.0.0:8000`

4. **Start Terminal 3** (Consumer):
   ```bash
   cd workers/python
   source venv/bin/activate
   python consumer.py
   ```
   Wait until you see: `[consumer] Waiting for messages. Press Ctrl+C to exit.`

5. **Visit** http://localhost:3000 in your browser
6. **Login** with `admin@example.com` / `admin123`
7. **Navigate** to a tenant page (e.g., `/tenants/gutenberg`)
8. **Click "Run Indexing"** - This should trigger the producer via FastAPI
9. **Check Terminal 2** - You should see FastAPI processing the request
10. **Check Terminal 3** - You should see the consumer processing messages
11. **Check the web UI** - Documents should appear after processing

### Troubleshooting Terminal Setup

**If "Run Indexing" button doesn't work:**
- Make sure Terminal 2 (FastAPI) is running
- Check Terminal 2 for error messages
- Verify FastAPI is accessible: `curl http://localhost:8000/health`

**If documents don't appear after indexing:**
- Make sure Terminal 3 (Consumer) is running
- Check Terminal 3 for error messages
- Verify RabbitMQ is running: `docker compose ps rabbitmq`

### Optional: Manual Producers

You can also run producers manually (instead of using the UI) in additional terminals:

**Gutenberg Producer** (Terminal 4 - Optional):
```bash
cd workers/python
source venv/bin/activate
python gutenberg_producer.py --fetch-new 50  # Fetch 50 new books
```

**S3 Producer** (Terminal 5 - Optional):
```bash
cd workers/python
source venv/bin/activate
python s3_producer.py s3-tenant-1 --fetch-new 100
```

**Note**: Manual producers are optional if you use the "Run Indexing" buttons in the web UI (which requires FastAPI service running).

## Environment Variables

### Root `.env` (Single File for All Services)

Create a `.env` file in the **project root** (not in `apps/web/`):

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch?schema=public"

# NextAuth
# For production (public URL)
NEXTAUTH_URL="https://your-production-domain.com"
# For development (internal URL - used for callbacks in dev)
NEXTAUTH_URL_INTERNAL="http://localhost:3000"
# Alternative: Use AUTH_URL (NextAuth v5 preferred)
# AUTH_URL="http://localhost:3000"  # for dev
# AUTH_URL="https://your-production-domain.com"  # for prod

# Elasticsearch
ELASTICSEARCH_URL="http://localhost:9200"

# Redis
REDIS_URL="redis://localhost:6379"

# RabbitMQ
RABBITMQ_URL="amqp://guest:guest@localhost:5672/%2F"
RABBITMQ_QUEUE_NAME="doc_ingest"

# AWS S3 Configuration (for S3 producers and document uploads)
AWS_ACCESS_KEY_ID="your-access-key-id"
AWS_SECRET_ACCESS_KEY="your-secret-access-key"
AWS_DEFAULT_REGION="eu-west-1"
AWS_S3_BUCKET="document-search-tenants"

# Admin Interface Configuration (optional)
# Comma-separated list of tenant slugs to display in admin interface
# If not set, all tenants are shown
ADMIN_TENANTS_LIST="s3-tenant-1,s3-tenant-2,gutenberg"
```

**Note**: 
- Next.js automatically loads `.env` from the project root (configured in `next.config.ts`)
- Prisma config files are updated to load from the root `.env` as well
- Python scripts load from the root `.env` file
- Use CloudFormation to create the S3 bucket: `./infrastructure/deploy-s3.sh`
- Make sure your AWS credentials have S3 and CloudFormation permissions

## Production Deployment

### Building for Production

1. **Set production environment variables**:
   ```env
   NEXTAUTH_URL="https://your-production-domain.com"
   DATABASE_URL="postgresql://user:password@production-db:5432/docsearch"
   ELASTICSEARCH_URL="https://your-elasticsearch-cluster:9200"
   REDIS_URL="redis://your-redis-instance:6379"
   ```

2. **Build the application**:
   ```bash
   cd apps/web
   pnpm build
   ```

   The build script automatically captures git commit hash and date:
   ```bash
   GIT_COMMIT_SHA=$(git rev-parse --short HEAD)
   GIT_COMMIT_DATE=$(git log -1 --format=%ci)
   ```

3. **Start the production server**:
   ```bash
   pnpm start
   ```

### Production Considerations

- **Database**: Use proper PostgreSQL instance (not Docker for production)
- **Elasticsearch**: Use managed Elasticsearch service or cluster
- **Redis**: Use managed Redis service
- **RabbitMQ**: Use managed RabbitMQ service or cluster
- **Environment Variables**: Store securely (use secrets management)
- **HTTPS**: Ensure SSL/TLS is configured
- **CORS**: Configure CORS for your production domain (see `infrastructure/S3_CORS_SETUP.md`)
- **Monitoring**: Set up logging and monitoring
- **Backups**: Configure database and Elasticsearch backups

### Git Version Display

The application displays the deployed git version and commit date in the admin sidebar. This is automatically captured during build and displayed at `/api/version`.

## Default Users & Passwords

After seeding the database, the following users are available:

### Platform Admin
- **Email**: `admin@example.com`
- **Password**: `admin123`
- **Role**: `platform_admin`
- **Access**: Can access **all tenants** and see all documents

### Tenant Users

Each tenant has a dedicated user:

1. **S3 Tenant 1**
   - **Email**: `s3-tenant-1@example.com`
   - **Password**: `user123`
   - **Role**: `tenant_user`
   - **Access**: Only documents in the `s3-tenant-1` tenant

2. **S3 Tenant 2**
   - **Email**: `s3-tenant-2@example.com`
   - **Password**: `user123`
   - **Role**: `tenant_user`
   - **Access**: Only documents in the `s3-tenant-2` tenant

3. **Gutenberg Tenant**
   - **Email**: `gutenberg@example.com`
   - **Password**: `user123`
   - **Role**: `tenant_user`
   - **Access**: Only documents in the `gutenberg` tenant

## Architecture Overview

- **Frontend**: Next.js 16 with App Router, shadcn/ui components
- **Backend**: Next.js API routes
- **Database**: PostgreSQL (users, tenants, memberships, file_manifest)
- **Search**: Elasticsearch (index-per-tenant pattern)
- **Cache**: Redis (search results, rate limiting)
- **Message Queue**: RabbitMQ (document ingestion pipeline)
- **Auth**: NextAuth.js v5 (email/password with JWT)
- **Storage**: AWS S3 (document storage)

## Document Ingestion Pipeline

The system uses Python workers to ingest documents from various sources. The ingestion pipeline works as follows:

```
[Sources] → [Producers] → [RabbitMQ Queue] → [Consumer] → [Elasticsearch]
```

### Architecture Overview

- **Producers**: Discover documents and enqueue them to RabbitMQ
  - **Gutenberg Producer** (`gutenberg_producer.py`): Fetches books from Project Gutenberg
  - **S3 Producer** (`s3_producer.py`): Discovers documents from S3 buckets
  - **Uploads Producer** (`uploads_producer.py`): Processes documents uploaded via UI

- **Consumer** (`consumer.py`): Processes queued documents, extracts text, chunks content, and indexes to Elasticsearch

- **Manifest System**: Tracks document state in PostgreSQL to avoid re-indexing unchanged files

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

## Project Structure

```
├── apps/
│   └── web/              # Next.js application
│       ├── src/
│       │   ├── app/      # App router pages
│       │   ├── components/ # React components
│       │   ├── lib/      # Utilities (Prisma, ES, Redis, Auth)
│       │   └── auth.ts   # NextAuth configuration
│       └── prisma/       # Database schema and migrations
├── workers/
│   └── python/           # Python document ingestion workers
│       ├── consumer.py   # Document processing consumer
│       ├── gutenberg_producer.py
│       ├── s3_producer.py
│       └── fastapi_service.py
├── infrastructure/       # CloudFormation templates
├── packages/
│   └── core/             # Shared types
└── docker-compose.yml    # Local development services
```

## API Documentation

See [apps/web/README.md](./apps/web/README.md) for detailed API documentation.

### Using the API

All API endpoints require authentication. Include your session cookie or use the NextAuth session.

#### Index a Document

```bash
curl -X POST http://localhost:3000/api/documents \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN" \
  -d '{
    "title": "My Document",
    "content": "This is the document content...",
    "tenant": "gutenberg",
    "metadata": {
      "filename": "document.pdf"
    }
  }'
```

#### Search Documents

```bash
curl "http://localhost:3000/api/search?q=search+query&tenant=gutenberg" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

#### Get Document

```bash
curl "http://localhost:3000/api/documents/DOCUMENT_ID" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

#### Delete Document

```bash
curl -X DELETE "http://localhost:3000/api/documents/DOCUMENT_ID" \
  -H "Cookie: next-auth.session-token=YOUR_SESSION_TOKEN"
```

## Infrastructure

### S3 Bucket Setup

Deploy S3 bucket and folder structure using CloudFormation:

```bash
# Deploy S3 bucket (reads credentials from root .env)
./infrastructure/deploy-s3.sh

# Destroy S3 bucket (⚠️ deletes all data)
./infrastructure/destroy-s3.sh
```

See [infrastructure/README.md](./infrastructure/README.md) for detailed documentation.

### CORS Configuration

For S3 direct uploads from the web interface, CORS must be configured. See [infrastructure/S3_CORS_SETUP.md](./infrastructure/S3_CORS_SETUP.md) for details.

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

### Can't Login?

- Verify database is seeded: `pnpm --filter web db:seed`
- Check `.env` file has correct `DATABASE_URL`
- Ensure Docker services are running

### Search Not Working?

- Check Elasticsearch is running: `curl http://localhost:9200`
- Verify index exists for your tenant
- Check browser console for errors

### API Returns 403?

- Verify you're logged in
- Check user has access to the requested tenant
- Platform admin can access all tenants, tenant users only their own

### Build Errors

- Ensure Node.js v20.19.6 is active
- Run `pnpm install` to ensure all dependencies are installed
- Check TypeScript strict mode is enabled (for production builds)

For more troubleshooting, see [apps/web/README.md](./apps/web/README.md#troubleshooting).

## Verification Checklist

After setup, verify everything is working:

- [ ] Node.js v20.19.6 is active (`node --version`)
- [ ] Docker services are running (`docker compose ps`)
- [ ] Database is seeded (can login with `admin@example.com`)
- [ ] Web app is accessible at http://localhost:3000
- [ ] Consumer is running and waiting for messages (if using ingestion)
- [ ] RabbitMQ UI is accessible at http://localhost:15672
- [ ] Elasticsearch is responding (`curl http://localhost:9200`)

## Development Commands

From project root:

```bash
# Start all services
docker compose up -d

# Generate Prisma client
pnpm --filter web db:generate

# Sync database schema
pnpm --filter web db:push

# Seed database
pnpm --filter web db:seed

# Start dev server
pnpm --filter web dev

# Build for production
cd apps/web
pnpm build

# Start production server
pnpm start
```

## Additional Documentation

- [apps/web/README.md](./apps/web/README.md) - Web application API documentation
- [workers/python/README.md](./workers/python/README.md) - Python workers documentation
- [infrastructure/README.md](./infrastructure/README.md) - Infrastructure setup
- [infrastructure/S3_CORS_SETUP.md](./infrastructure/S3_CORS_SETUP.md) - S3 CORS configuration
