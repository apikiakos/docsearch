# DocSearch Deployment

## Prisma Architecture

✅ **Correct:**
- Prisma runs **inside Docker containers** (build/deploy time)
- Each app container has its own Prisma installation
- Migrations run in **one-shot Docker containers**
- Runtime containers only use `@prisma/client`

❌ **Never:**
- Install Prisma on VPS host shell
- Share Prisma across containers (impossible)
- Run migrations on VPS shell

## Deployment

### Quick Deploy

```bash
# Deploy all apps
./scripts/deploy.sh all

# Deploy specific app
./scripts/deploy.sh web
./scripts/deploy.sh api
```

### With Custom VPS Details

```bash
./scripts/deploy.sh all 46.224.45.144 alexandre
```

### What the Script Does

1. **Commits and pushes** local changes to GitHub
2. **Pulls latest code** on VPS
3. **Runs migrations** via one-shot Docker container (via vps-infra)
4. **Builds Docker images** using vps-infra compose files
5. **Deploys services** using vps-infra compose files

### Prisma Migrations

Migrations run automatically via the `docsearch-migrate` service defined in `vps-infra/compose/apps.compose.yml`:

```yaml
docsearch-migrate:
  build:
    context: /opt/apps/docsearch
    dockerfile: apps/web/Dockerfile
  command: ["pnpm", "-C", "packages/db", "migrate:deploy"]
  profiles: ["migrate"]
```

This runs `pnpm -C packages/db migrate:deploy` inside a Docker container, **never on the VPS shell**.

### Manual Migration (if needed)

```bash
# On VPS
cd /opt/platform/vps-infra
docker compose -f compose/infra.compose.yml -f compose/apps.compose.yml \
  --profile migrate run --rm docsearch-migrate
```

## Prisma Structure

```
docsearch/
├─ packages/
│  └─ db/
│     ├─ prisma/
│     │  ├─ schema.prisma
│     │  └─ migrations/
│     ├─ src/
│     │  └─ client.ts        # Exports prisma client
│     └─ package.json
├─ apps/
│  ├─ web/                   # Uses @docsearch/db
│  └─ api/                   # Uses @docsearch/db
```

Each app imports:
```typescript
import { prisma } from '@docsearch/db'
```

## Environment Variables

Apps use environment variables from `vps-infra/.env`:
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `DOCSEARCH_NEXTAUTH_SECRET` - NextAuth secret
- etc.

See `vps-infra/.env.example` for all variables.

