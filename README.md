# Archant

Self-hosted personal finance for one household. Your bank data lands in your own database and stays there.

Archant re-implements the parts of [Sure](https://github.com/we-promise/sure) that a single household actually uses, on a stack light enough to run on a free tier or on a single small server.

## Tech stack

| Layer          | Choice                                  |
| -------------- | --------------------------------------- |
| Language       | TypeScript 7                            |
| Interface      | Vite + React, TanStack Router and Query |
| Server         | Hono                                    |
| Database       | SQLite through Drizzle ORM              |
| Authentication | Better Auth                             |
| Bank data      | Enable Banking (PSD2)                   |
| Tests          | Vitest, Playwright                      |
| Packaging      | pnpm workspaces                         |

Why these, and what was rejected: [docs/adr/0001-technology-stack.md](docs/adr/0001-technology-stack.md).

## Structure

```
packages/
  web/   Vite + React single-page app
  api/   Hono server, REST and scheduled sync
  db/    Drizzle schema shared by both
docs/    Project documentation and decision records
```

## Prerequisites

Node.js 24+, pnpm 10+.

## Getting started

```bash
git clone git@github.com:leger-dosage/archant.git
cd archant
pnpm install
cp .env.example .env     # then fill in your Enable Banking credentials
pnpm db migrate:local
pnpm api start:dev
pnpm web start:dev
```

## Scripts

| Command             | What it does                       |
| ------------------- | ---------------------------------- |
| `pnpm format`       | Format and sort imports with Oxfmt |
| `pnpm lint:code`    | Lint every package, warnings fail  |
| `pnpm lint:format`  | Check formatting without writing   |
| `pnpm typecheck`    | Type-check every package           |
| `pnpm test`         | Run unit and integration tests     |
| `pnpm test:e2e`     | Run the Playwright suite           |
| `pnpm api <script>` | Run a script inside `@archant/api` |

## Deploying

One Cloudflare Worker serves the interface and the API, with Turso or D1 behind it. A `Dockerfile` covers self-hosting against a plain SQLite file. See [docs/deployment.md](docs/deployment.md).

## Contributing

Read [AGENTS.md](AGENTS.md) first: it holds the conventions and the verification gate that CI enforces.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must publish your changes.
