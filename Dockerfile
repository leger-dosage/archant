# syntax=docker/dockerfile:1

# Node runs the server straight from its TypeScript source through type
# stripping, so only the interface has a build step, and the image carries no
# compiler at run time.
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs ./
COPY packages/data/package.json packages/data/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm web build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .pnpmfile.cjs ./
COPY packages/data/package.json packages/data/package.json
COPY packages/api/package.json packages/api/package.json
# pnpm checks every workspace manifest against the lockfile, even the ones the
# filter below leaves out.
COPY packages/web/package.json packages/web/package.json
# The production dependencies of the API and of `@archant/data`, which `...`
# pulls in: no drizzle-kit, no Vite, no test runner. Migrations run through
# drizzle-orm's own migrator.
RUN pnpm install --frozen-lockfile --prod --filter @archant/api...

COPY packages/data packages/data
COPY packages/api/src packages/api/src
COPY --from=builder /app/packages/web/dist packages/web/dist

ENV PORT=8787
ENV DATABASE_URL=file:/data/archant.db
# The API serves the built interface from the same origin, so a browser needs
# no second port and no CORS exception.
ENV WEB_DIST=/app/packages/web/dist

# Created here so a new named volume inherits the unprivileged user as owner,
# rather than root.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data

EXPOSE 8787
# The server migrates before it listens, so a healthy container has a database
# it can query, not merely a process. `start-interval` lets `docker compose up
# --wait` return within seconds instead of after a full interval.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --start-interval=1s --retries=3 \
	CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
# No shell in front: the reset command and every signal reach Node directly.
# `init: true` in docker-compose.yml gives it a PID 1 that forwards SIGTERM.
CMD ["node", "packages/api/src/index.ts"]
