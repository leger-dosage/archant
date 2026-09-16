# Deployment

One codebase, several targets. A target is an entrypoint under `packages/api/src/entrypoints/` plus one configuration file at the root of the package. Application code never branches on the platform.

## Cloudflare Workers — the primary target

A single Worker serves the built interface as static assets and handles the API on the same origin. The database is Turso over HTTP, or D1 through its binding.

Free-tier limits worth knowing:

- 100,000 requests a day, which includes scheduled invocations.
- 10 ms of CPU per invocation. Waiting on the network does not count, so a bank sync fits comfortably; a heavy computation over years of data would not.
- D1 blocks queries past 5 million rows read or 100,000 rows written a day, enforced since 1 September 2026. Turso's free plan allows 5 GB and 500 million rows read a month, and is the safer default.

## Self-hosting with Docker

A plain SQLite file on a volume, the Node entrypoint, no other service. This is the reference deployment for anyone who does not want a cloud account.

## Other platforms

Render, Vercel and Fly all work through the matching Hono adapter. Two traps on free tiers: a Render free PostgreSQL expires 30 days after creation, which is irrelevant here since we use SQLite, and a Render free web service spins down after 15 minutes of inactivity.

## Scheduled synchronisation

`POST /api/sync` is protected by a shared secret and is the only entry point for synchronisation. How it gets called is a per-platform detail:

| Platform   | Trigger                                          |
| ---------- | ------------------------------------------------ |
| Cloudflare | A cron trigger on the Worker                     |
| Vercel     | A cron job, once a day maximum on the Hobby plan |
| Docker     | A system cron or a timer in the container        |
| Anywhere   | A scheduled GitHub Action calling the route      |

Once a day is enough: banks post transactions in batches, and a PSD2 consent allows a limited number of calls per account per day.

## Backups

No free tier backs up your data for you. Whatever the target, schedule a dump of the database to object storage, and verify a restore at least once. This holds bank history; losing it is the failure that actually matters.
