# Distributed Document Search Service - Web App

This is the Next.js web application for the distributed document search service prototype.

## Quick Reference: Default Users

**Platform Admin** (access to all tenants):
- Email: `admin@example.com`
- Password: `admin123`

**Tenant Users** (access to their tenant only):
- `gutenberg@example.com` / `user123` → `gutenberg` tenant
- `govdocs@example.com` / `user123` → `govdocs` tenant
- `alex@example.com` / `user123` → `alex-local` tenant

See [root README.md](../../README.md) for complete usage guide.

## Setup

### Prerequisites

- Node.js 20.19.6+ (use `nvm use 20.19.6` - required for Prisma 7)
- pnpm 9.7.0+
- Docker and Docker Compose

### Environment Variables

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

**Note**: Next.js automatically loads `.env` files from the project root. Prisma config files are updated to load from the root `.env` as well.

### Start Services

From the project root:

```bash
docker compose up -d
```

This starts:
- PostgreSQL on port 5432
- Elasticsearch on port 9200
- Redis on port 6379
- RabbitMQ on ports 5672 (AMQP) and 15672 (Management UI)

### Database Setup

1. Generate Prisma client:
```bash
cd apps/web
pnpm db:generate
```

2. Sync database schema (using `db push` for prototype - use migrations in production):
```bash
pnpm db:push
```

   **Note**: This project uses Prisma 7 which requires a PostgreSQL adapter. The adapter is already configured in the code. If you encounter issues, ensure `@prisma/adapter-pg` and `pg` are installed.

3. Seed the database:
```bash
pnpm db:seed
```

This creates:
- 3 tenants: `gutenberg`, `govdocs`, `alex-local`
- 1 admin user: `admin@example.com` (password: `admin123`) with `platform_admin` role
- 3 tenant users:
  - `gutenberg@example.com` (password: `user123`) - `tenant_user` for gutenberg
  - `govdocs@example.com` (password: `user123`) - `tenant_user` for govdocs
  - `alex@example.com` (password: `user123`) - `tenant_user` for alex-local

### Run Development Server

```bash
pnpm dev
```

The app will be available at `http://localhost:3000`.

## API Endpoints

All endpoints require authentication (except `/api/auth/*`).

### Authentication

- `POST /api/auth/signin` - Sign in with email/password
- `GET /api/auth/signout` - Sign out
- `GET /api/auth/session` - Get current session

### Documents

- `POST /api/documents` - Index a new document
  ```json
  {
    "title": "Document Title",
    "content": "Document content...",
    "tenant": "gutenberg",
    "metadata": { "filename": "doc.pdf" }
  }
  ```

- `GET /api/documents/{id}` - Get document by ID
- `DELETE /api/documents/{id}` - Delete document

### Search

- `GET /api/search?q={query}&tenant={tenantSlug}` - Search documents
  - Returns results with snippets and relevance scores
  - Cached for 5 minutes
  - Rate limited: 100 requests per minute per tenant

### Health

- `GET /api/healthz` - Health check with dependency status

## Architecture

- **PostgreSQL**: User, tenant, and membership data (via Prisma 7 with PostgreSQL adapter)
- **Elasticsearch**: Full-text search with index-per-tenant pattern (`docs_{tenantSlug}`)
- **Redis**: Search result caching and rate limiting
- **NextAuth**: Email-based authentication with JWT sessions
- **Multi-tenancy**: Tenant isolation enforced at API layer

## Prisma 7 Notes

This project uses Prisma 7, which requires:
- PostgreSQL adapter (`@prisma/adapter-pg`) for database connections
- Connection string configured in `prisma.config.ts` (not in `schema.prisma`)
- `prisma db push` for schema synchronization (prototype) - use migrations for production

The PrismaClient is configured with the adapter in:
- `src/lib/prisma.ts` (for the application)
- `prisma/seed.ts` (for seeding)

## User Roles

- `platform_admin`: Can access all tenants
- `tenant_admin`: Admin for a specific tenant (not yet implemented)
- `tenant_user`: Regular user for a specific tenant

## Troubleshooting

### Prisma Migration Issues

If `prisma migrate dev` times out with advisory lock errors:
- Use `pnpm db:push` instead for prototype development
- For production, ensure no other Prisma processes are running
- Clear advisory locks: `docker exec docsearch-postgres psql -U postgres -d docsearch -c "SELECT pg_advisory_unlock_all();"`

### Prisma 7 Adapter Errors

If you see errors about missing adapter:
- Ensure `@prisma/adapter-pg` and `pg` are installed: `pnpm add @prisma/adapter-pg pg`
- Verify `DATABASE_URL` is set in `.env`
- Regenerate Prisma client: `pnpm db:generate`

### Database Connection Issues

- Verify Docker services are running: `docker compose ps`
- Check PostgreSQL logs: `docker compose logs postgres`
- Test connection: `docker exec docsearch-postgres psql -U postgres -d docsearch -c "SELECT 1;"`
