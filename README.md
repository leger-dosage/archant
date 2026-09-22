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

## Status

Early. You can create checking, savings and credit card accounts and see them listed with their balances. Each feature is scoped first, then built along with the packages and dependencies it needs, and nothing is added ahead of that need.

## Structure

The three packages exist; each grows only with the features that need it.

```
packages/
  web/    Vite + React single-page app
  api/    Hono server, REST and scheduled sync
  data/   Drizzle schema and database client shared by both
docs/     Project documentation and decision records
```

## Prerequisites

Node.js 24+, pnpm 10+.

## Getting started

```bash
git clone git@github.com:leger-dosage/archant.git
cd archant
pnpm install
cp .env.example .env
```

Then, in separate terminals:

```bash
pnpm data migrate:local   # creates local.db at the repository root
pnpm api start:dev        # API on http://localhost:8787
pnpm web start:dev        # interface on http://localhost:5173, proxies /api to the API
```

Open http://localhost:5173.

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

`pnpm web` and `pnpm data` do the same for the two other packages.

## Deploying

The reference target is a single container serving the interface and the API against a SQLite file on a volume, with no cloud account:

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose up --build --detach --wait
```

Open http://localhost:8787 and create the administrator. Reverse proxies, variables, upgrades and other targets are described in [docs/deployment.md](docs/deployment.md).

## Contributing

Read [AGENTS.md](AGENTS.md) first: it holds the conventions and the verification gate that CI enforces.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must publish your changes.
