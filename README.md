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

## Features

The interface is in French. Everything below works without a bank connection except the last line.

- Accounts: checking, savings, credit card, loan, investment (PEA, assurance vie, compte-titres), property and vehicle, with a daily balance history and dated balance snapshots.
- Transactions entered by hand, filtered across accounts, and edited in bulk.
- Import of OFX, CSV (with a saved column mapping) and QIF files, with a preview, deduplication, an import history and revert.
- Categories, merchants and tags, and rules that categorise, tag, rename or exclude new and existing transactions.
- Transfers between accounts, marked by hand or matched automatically.
- Recurring transactions, detected from history and listed with their next date.
- A dashboard with net worth over time and monthly income and expenses by category.
- A command palette and keyboard shortcuts.
- One administrator account, created on first launch, with a password reset from the server's shell.
- Bank synchronisation through Enable Banking: connect a bank, link its accounts, sync transactions and balances on a schedule or on demand, keep pending card payments, renew or disconnect, and merge or dismiss a possible duplicate.

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
pnpm install --frozen-lockfile
cp .env.example .env
```

Set `BETTER_AUTH_SECRET` in `.env`, from `openssl rand -base64 32`: the API refuses to start without it. Then, in separate terminals:

```bash
pnpm api start:dev        # API on http://localhost:8787; migrates local.db at the repository root first
pnpm web start:dev        # interface on http://localhost:5173, proxies /api to the API
```

Open http://localhost:5173 and create the administrator. `pnpm data migrate:local` applies migrations without starting the API. To connect a bank in development, see [Connecting a bank](docs/deployment.md#connecting-a-bank).

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

`pnpm web` and `pnpm data` do the same for the two other packages. `pnpm test:e2e` needs Chromium once per machine: `pnpm --filter @archant/web exec playwright install chromium`.

## Deploying

The reference target is a single container serving the interface and the API against a SQLite file on a volume, with no cloud account:

```bash
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose up --build --detach --wait
```

Open http://localhost:8787 and create the administrator. [docs/deployment.md](docs/deployment.md) covers the variables, reverse proxies, upgrades, backups, connecting a bank in sandbox or production, the scheduled sync, password reset and other targets.

## Contributing

Read [AGENTS.md](AGENTS.md) first: it holds the conventions and the verification gate that CI enforces.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must publish your changes.
