# ============================================================================
# DOCSEARCH WEB DOCKERFILE
# ============================================================================
# Multi-stage build with separate targets:
# - migrate: Has packages/db, Prisma schema, pnpm workspace (for migrations)
# - runtime: Standalone Next.js build (minimal, no Prisma CLI)
# ============================================================================

# ---- Base Stage (monorepo context) ----
FROM node:20-alpine AS base

WORKDIR /repo

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

# Copy workspace manifests
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./

# Copy workspace packages package.json files
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY apps/web/package.json ./apps/web/

# Install dependencies
# Needed because Prisma runs during pnpm install (postinstall)
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}
RUN corepack enable && pnpm install --frozen-lockfile

# Copy workspace package sources
COPY packages/db ./packages/db
COPY packages/core ./packages/core

# Generate Prisma client (so migrations + runtime can use it)
RUN pnpm -C packages/db generate

# ---- Migrate Image (has packages/db, Prisma schema, pnpm workspace) ----
FROM base AS migrate

WORKDIR /repo

# Copy app source (needed for some dependencies)
COPY apps/web ./apps/web

# Add node_modules/.bin to PATH for Prisma CLI
ENV PATH="/repo/node_modules/.bin:$PATH"

# Default command for migration image
# Use working_dir in compose, so we can use relative schema path
# This ensures Prisma CLI is found in the workspace node_modules
WORKDIR /repo/packages/db
CMD ["pnpm", "exec", "prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"]

# ---- Build Web App ----
FROM base AS build-web

WORKDIR /repo

# Copy app source
COPY apps/web ./apps/web

# Build web app
RUN pnpm --filter web build

# ---- Runtime Image (standalone, minimal) ----
FROM node:20-alpine AS runtime

WORKDIR /repo

ENV NODE_ENV=production
EXPOSE 3020

# Copy standalone output from Next.js
# Next.js standalone output structure: server.js is in the root of standalone/
COPY --from=build-web /repo/apps/web/.next/standalone ./
COPY --from=build-web /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build-web /repo/apps/web/public ./apps/web/public

# Copy packages/db (includes generated Prisma client)
# This is needed because @docsearch/db is imported by the app
COPY --from=build-web /repo/packages/db ./packages/db

# Copy Prisma client and engines from builder
COPY --from=build-web /repo/node_modules/@prisma ./node_modules/@prisma
RUN --mount=from=build-web,source=/repo/node_modules,target=/tmp/node_modules \
    if [ -d /tmp/node_modules/.prisma ]; then \
      mkdir -p ./node_modules/.prisma && \
      cp -r /tmp/node_modules/.prisma/* ./node_modules/.prisma/; \
    fi || true

# Copy @prisma/engines if it exists
RUN --mount=from=build-web,source=/repo/node_modules,target=/tmp/node_modules \
    if [ -d /tmp/node_modules/@prisma/engines ] && [ ! -L /tmp/node_modules/@prisma/engines ]; then \
      mkdir -p ./node_modules/@prisma && \
      cp -r /tmp/node_modules/@prisma/engines ./node_modules/@prisma/; \
    fi || true

# Copy root package.json and workspace files (needed for @docsearch/db imports)
COPY --from=build-web /repo/package.json ./package.json
COPY --from=build-web /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml

# pnpm is provided via Corepack; enable it in runtime image too
RUN corepack enable

# Run the Next.js server
# Note: If using standalone mode, server.js is in apps/web/server.js
# If not using standalone, we need to use pnpm start
CMD ["sh", "-lc", "pnpm --filter web start -p 3020"]
