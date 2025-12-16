FROM node:20-alpine AS build
WORKDIR /repo

# Needed because Prisma runs during pnpm install (postinstall)
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL}

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages

RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter web build

FROM node:20-alpine
WORKDIR /repo
ENV NODE_ENV=production
EXPOSE 3000

COPY --from=build /repo /repo

# pnpm is provided via Corepack; enable it in runtime image too
RUN corepack enable

CMD ["sh", "-lc", "pnpm --filter web start -p 3000"]
