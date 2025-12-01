# Distributed Document Search Service

A prototype distributed document search service with multi-tenancy support, built for enterprise technical assessment.

## Prerequisites

- **Node.js**: v20.19.6 (required - use `nvm use` or `fnm use` to switch versions)
- **pnpm**: >=9.7.0
- **Docker**: For running PostgreSQL, Elasticsearch, Redis, and RabbitMQ

The project includes `.nvmrc` and `.node-version` files for automatic version switching.

## Quick Start

### 1. Start Services

```bash
docker compose up -d
```

### 2. Setup Database

```bash
# From project root
pnpm --filter web db:generate
pnpm --filter web db:push
pnpm --filter web db:seed
```

### 3. Start Web Server

```bash
pnpm --filter web dev
```

Visit `http://localhost:3000` to access the application.

## Default Users & Passwords

After seeding the database, the following users are available:

### Platform Admin
- **Email**: `admin@example.com`
- **Password**: `admin123`
- **Role**: `platform_admin`
- **Access**: Can access **all tenants** and see all documents

### Tenant Users

Each tenant has a dedicated user:

1. **Gutenberg Tenant**
   - **Email**: `gutenberg@example.com`
   - **Password**: `user123`
   - **Role**: `tenant_user`
   - **Access**: Only documents in the `gutenberg` tenant

2. **GovDocs Tenant**
   - **Email**: `govdocs@example.com`
   - **Password**: `user123`
   - **Role**: `tenant_user`
   - **Access**: Only documents in the `govdocs` tenant

3. **Alex Local Tenant**
   - **Email**: `alex@example.com`
   - **Password**: `user123`
   - **Role**: `tenant_user`
   - **Access**: Only documents in the `alex-local` tenant

## Tenants

The system comes with 3 pre-configured tenants:

1. **gutenberg** - Project Gutenberg
2. **govdocs** - Government Documents
3. **alex-local** - Alex Local

Each tenant has its own isolated Elasticsearch index (`docs_{tenant_slug}`) and access is enforced at the API layer.

## How to Use

### 1. Login

1. Navigate to `http://localhost:3000`
2. Enter your email and password
3. Click "Sign In"

### 2. Dashboard

After logging in, you'll see:
- **Left Sidebar**: Navigation menu (Dashboard, Search, Documents, Settings)
- **Top Navigation**: App title and user dropdown menu
- **Main Content**: Dashboard overview

### 3. User Roles & Access

#### Platform Admin (`admin@example.com`)
- Can search across **all tenants**
- Can index documents to any tenant
- Can view all documents regardless of tenant
- Has access to admin features

#### Tenant Users
- Can only search documents in **their assigned tenant**
- Can only index documents to **their tenant**
- Cannot access other tenants' data
- Tenant isolation is enforced at the API level

### 4. Using the API

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

### 5. Testing Tenant Isolation

1. **Login as tenant user** (e.g., `gutenberg@example.com`)
2. **Try to search another tenant** (e.g., `tenant=govdocs`)
   - You'll get a `403 Forbidden` error
3. **Login as admin** (`admin@example.com`)
4. **Search any tenant** - Works for all tenants

## Architecture Overview

- **Frontend**: Next.js 16 with App Router, shadcn/ui components
- **Backend**: Next.js API routes
- **Database**: PostgreSQL (users, tenants, memberships)
- **Search**: Elasticsearch (index-per-tenant pattern)
- **Cache**: Redis (search results, rate limiting)
- **Auth**: NextAuth.js v5 (email/password with JWT)

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
├── packages/
│   └── core/             # Shared types
└── docker-compose.yml    # Local development services
```

## Environment Variables

### Root `.env` (Single File for All Services)

Create a `.env` file in the **project root** (not in `apps/web/`):

```env
# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/docsearch?schema=public"

# NextAuth
AUTH_SECRET="your-secret-key-here-change-in-production"
NEXTAUTH_URL="http://localhost:3000"

# Elasticsearch
ELASTICSEARCH_URL="http://localhost:9200"

# Redis
REDIS_URL="redis://localhost:6379"

# AWS S3 Configuration (for seed_s3_from_gutendex.py and CloudFormation)
AWS_ACCESS_KEY_ID="your-aws-access-key"
AWS_SECRET_ACCESS_KEY="your-aws-secret-key"
AWS_DEFAULT_REGION="us-east-1"
AWS_S3_BUCKET="your-bucket-name"
```

**Note**: 
- Next.js automatically loads `.env` from the project root (configured in `next.config.ts`)
- Prisma config files are updated to load from the root `.env` as well
- Python scripts (seed_s3_from_gutendex.py, etc.) load from the root `.env` file
- Use CloudFormation to create the bucket: `./infrastructure/deploy-s3.sh`
- Make sure your AWS credentials have S3 and CloudFormation permissions

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

## API Documentation

See [apps/web/README.md](./apps/web/README.md) for detailed API documentation.

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

# Run from web directory
cd apps/web
pnpm dev
```

## Troubleshooting

### Can't login?
- Verify database is seeded: `pnpm --filter web db:seed`
- Check Docker services are running: `docker compose ps`
- Verify `.env` file exists with correct `DATABASE_URL`

### Search not working?
- Check Elasticsearch is running: `curl http://localhost:9200`
- Verify index exists for your tenant
- Check browser console for errors

### API returns 403?
- Verify you're logged in
- Check user has access to the requested tenant
- Platform admin can access all tenants, tenant users only their own

For more troubleshooting, see [apps/web/README.md](./apps/web/README.md#troubleshooting).

