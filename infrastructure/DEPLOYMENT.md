# Production Deployment Guide

This guide covers deploying the distributed document search service to a production server.

## Prerequisites

- SSH access to production server
- Git repository access
- Node.js v20.19.6 installed on server
- pnpm >= 9.7.0 installed on server
- Python 3.11+ installed on server
- PM2 installed globally (`npm install -g pm2`)
- Docker and Docker Compose (for services)
- Environment variables configured on server

## Deployment Steps

### 1. Connect to Production Server

```bash
ssh user@your-production-server.com
```

### 2. Navigate to Application Directory

```bash
cd /path/to/distributed-docsearch-prototype
```

### 3. Pull Latest Changes

```bash
git pull origin main
# or
git pull origin master
```

### 4. Update Dependencies

```bash
# Update Node.js dependencies
pnpm install

# Update Python dependencies (if changed)
cd workers/python
source venv/bin/activate
pip install -r requirements.txt
cd ../..
```

### 5. Update Database Schema (if needed)

If there are new migrations or schema changes:

```bash
cd apps/web
pnpm db:generate
pnpm db:push
# OR for production, use migrations:
# pnpm db:migrate deploy
```

**Note**: Always backup the database before running migrations in production!

### 6. Build Next.js Application

```bash
cd apps/web
pnpm build
```

This will:
- Generate Prisma client
- Capture git commit hash and date
- Build the Next.js application with strict TypeScript checks

### 7. Restart Next.js Application (PM2)

```bash
# Stop the current application
pm2 stop distributed-docsearch-web

# Or if using a different name, list processes first:
pm2 list

# Start/restart the application
pm2 restart distributed-docsearch-web

# If the app doesn't exist yet, start it:
cd apps/web
pm2 start npm --name "distributed-docsearch-web" -- start

# Or if you have an ecosystem file:
pm2 restart ecosystem.config.js
```

**PM2 Ecosystem File Example** (`ecosystem.config.js` in project root):

```javascript
module.exports = {
  apps: [
    {
      name: 'docsearch-web',
      script: 'npm',
      args: 'start',
      cwd: '/path/to/distributed-docsearch-prototype/apps/web',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G'
    }
  ]
};
```

### 8. Restart FastAPI Service (PM2)

The FastAPI service handles producer triggers from the web UI:

```bash
# Stop FastAPI service
pm2 stop docsearch-fastapi

# Restart FastAPI service
cd workers/python
source venv/bin/activate
pm2 restart docsearch-fastapi

# If it doesn't exist, start it:
pm2 start fastapi_service.py --name "docsearch-fastapi" --interpreter python3
```

**PM2 Ecosystem Entry for FastAPI**:

```javascript
{
  name: 'docsearch-fastapi',
  script: 'fastapi_service.py',
  cwd: '/path/to/distributed-docsearch-prototype/workers/python',
  interpreter: 'python3',
  instances: 1,
  exec_mode: 'fork',
  env: {
    FASTAPI_PORT: 8000
  },
  error_file: './logs/fastapi-error.log',
  out_file: './logs/fastapi-out.log',
  autorestart: true,
  watch: false
}
```

### 9. Restart Consumer (PM2)

The consumer processes documents from RabbitMQ:

```bash
# Stop consumer
pm2 stop docsearch-consumer

# Restart consumer
cd workers/python
source venv/bin/activate
pm2 restart docsearch-consumer

# If it doesn't exist, start it:
pm2 start consumer.py --name "docsearch-consumer" --interpreter python3
```

**PM2 Ecosystem Entry for Consumer**:

```javascript
{
  name: 'docsearch-consumer',
  script: 'consumer.py',
  cwd: '/path/to/distributed-docsearch-prototype/workers/python',
  interpreter: 'python3',
  instances: 1,
  exec_mode: 'fork',
  error_file: './logs/consumer-error.log',
  out_file: './logs/consumer-out.log',
  autorestart: true,
  watch: false,
  max_memory_restart: '500M'
}
```

### 10. Verify Services are Running

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs docsearch-web --lines 50
pm2 logs docsearch-fastapi --lines 50
pm2 logs docsearch-consumer --lines 50

# Check if services are responding
curl http://localhost:3000/api/healthz
curl http://localhost:8000/health
```

### 11. Restart Docker Services (if needed)

If Docker services need to be restarted:

```bash
cd /path/to/distributed-docsearch-prototype
docker compose restart

# Or restart specific services:
docker compose restart postgres
docker compose restart elasticsearch
docker compose restart redis
docker compose restart rabbitmq
```

### 12. Verify Application

1. **Check web application**: Visit `https://your-production-domain.com`
2. **Check API health**: `curl https://your-production-domain.com/api/healthz`
3. **Check FastAPI**: `curl http://localhost:8000/health` (internal)
4. **Test search functionality**
5. **Check consumer is processing**: Monitor PM2 logs

## Complete Deployment Script

Here's a complete deployment script you can save as `deploy.sh`:

```bash
#!/bin/bash
set -e  # Exit on error

echo "🚀 Starting deployment..."

# Navigate to project directory
cd /path/to/distributed-docsearch-prototype

# Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin main

# Update dependencies
echo "📦 Updating dependencies..."
pnpm install

# Update Python dependencies
echo "🐍 Updating Python dependencies..."
cd workers/python
source venv/bin/activate
pip install -r requirements.txt
cd ../..

# Update database (if needed - uncomment if migrations exist)
# echo "🗄️  Updating database..."
# cd apps/web
# pnpm db:generate
# pnpm db:push
# cd ../..

# Build Next.js application
echo "🔨 Building Next.js application..."
cd apps/web
pnpm build
cd ../..

# Restart PM2 services
echo "🔄 Restarting PM2 services..."
pm2 restart docsearch-web
pm2 restart docsearch-fastapi
pm2 restart docsearch-consumer

# Show status
echo "✅ Deployment complete!"
pm2 status
```

Make it executable:
```bash
chmod +x deploy.sh
```

## PM2 Management Commands

### View Status
```bash
pm2 status
pm2 list
```

### View Logs
```bash
# All services
pm2 logs

# Specific service
pm2 logs docsearch-web
pm2 logs docsearch-fastapi
pm2 logs docsearch-consumer

# Last 100 lines
pm2 logs --lines 100

# Follow logs
pm2 logs --follow
```

### Restart Services
```bash
# Restart all
pm2 restart all

# Restart specific service
pm2 restart docsearch-web

# Reload (zero-downtime restart)
pm2 reload docsearch-web
```

### Stop Services
```bash
pm2 stop docsearch-web
pm2 stop docsearch-fastapi
pm2 stop docsearch-consumer

# Stop all
pm2 stop all
```

### Delete Services
```bash
pm2 delete docsearch-web
pm2 delete docsearch-fastapi
pm2 delete docsearch-consumer
```

### Save PM2 Configuration
After configuring all services, save the configuration:

```bash
pm2 save
pm2 startup  # Generate startup script
```

## Environment Variables

Ensure these are set in your production environment (`.env` file or system environment):

```env
# Database
DATABASE_URL="postgresql://user:password@production-db:5432/docsearch?schema=public"

# NextAuth
NEXTAUTH_URL="https://your-production-domain.com"
NEXTAUTH_URL_INTERNAL="https://your-production-domain.com"
AUTH_SECRET="your-secret-key"

# Elasticsearch
ELASTICSEARCH_URL="http://localhost:9200"

# Redis
REDIS_URL="redis://localhost:6379"

# RabbitMQ
RABBITMQ_URL="amqp://guest:guest@localhost:5672/%2F"
RABBITMQ_QUEUE_NAME="doc_ingest"

# AWS S3
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"
AWS_DEFAULT_REGION="eu-west-1"
AWS_S3_BUCKET="document-search-tenants"

# FastAPI
FASTAPI_PORT=8000
```

## Troubleshooting

### Application Not Starting

1. **Check PM2 logs**:
   ```bash
   pm2 logs docsearch-web --err
   ```

2. **Check if port is in use**:
   ```bash
   lsof -i :3000
   ```

3. **Verify environment variables**:
   ```bash
   pm2 env docsearch-web
   ```

### Consumer Not Processing

1. **Check consumer logs**:
   ```bash
   pm2 logs docsearch-consumer --err
   ```

2. **Verify RabbitMQ is running**:
   ```bash
   docker compose ps rabbitmq
   curl http://localhost:15672
   ```

3. **Check queue has messages**:
   - Visit http://localhost:15672 (guest/guest)
   - Check `doc_ingest` queue

### FastAPI Not Responding

1. **Check FastAPI logs**:
   ```bash
   pm2 logs docsearch-fastapi --err
   ```

2. **Verify port is available**:
   ```bash
   lsof -i :8000
   ```

3. **Test health endpoint**:
   ```bash
   curl http://localhost:8000/health
   ```

### Database Connection Issues

1. **Verify database is running**:
   ```bash
   docker compose ps postgres
   ```

2. **Test connection**:
   ```bash
   psql $DATABASE_URL
   ```

3. **Check Prisma client**:
   ```bash
   cd apps/web
   pnpm db:generate
   ```

## Rollback Procedure

If deployment fails:

1. **Stop new services**:
   ```bash
   pm2 stop all
   ```

2. **Revert to previous commit**:
   ```bash
   git log  # Find previous commit hash
   git checkout <previous-commit-hash>
   ```

3. **Rebuild and restart**:
   ```bash
   cd apps/web
   pnpm build
   pm2 restart all
   ```

## Monitoring

### PM2 Monitoring
```bash
pm2 monit  # Real-time monitoring dashboard
```

### Check Application Health
```bash
# Web application
curl https://your-domain.com/api/healthz

# FastAPI
curl http://localhost:8000/health

# Elasticsearch
curl http://localhost:9200/_cluster/health

# Database
psql $DATABASE_URL -c "SELECT 1"
```

## Quick Reference

```bash
# Full deployment
git pull && pnpm install && cd apps/web && pnpm build && cd ../.. && pm2 restart all

# Restart all services
pm2 restart all

# View all logs
pm2 logs

# Check status
pm2 status

# Save PM2 config
pm2 save
```

