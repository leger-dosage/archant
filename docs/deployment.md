# Deployment

One codebase, several targets. `@archant/api` has a single entrypoint, `packages/api/src/index.ts`. A target is a matter of configuration and of the process that starts that file; application code never branches on the platform. The reasoning is in [adr/0002-container-reference-target.md](adr/0002-container-reference-target.md).

None of this is built yet. The files described here arrive with the first feature that can be deployed.

## Docker — the reference target

One image serves the built interface as static files and answers the API on the same origin. The database is a plain SQLite file on a volume. No cloud account, no second service. This is the only target that will have files in the repository.

## Other targets

These stay possible and none of them will have a file in this repository, by design: adding one must never fork the application code.

- **A plain Node host.** Install, build the interface, start the entrypoint, put a reverse proxy in front.
- **Turso.** Point the database URL at the `libsql://` address and provide its token. The driver is the same one as for a local file. The free plan allows 5 GB and 500 million rows read a month.
- **Render, Fly and the like.** The container, deployed as is. A Render free web service spins down after 15 minutes of inactivity, which delays the first request after a quiet night.
- **Cloudflare Workers.** Possible in principle, since Hono only needs web standards, but it would need an entrypoint of its own and a `wrangler.toml`. The 10 ms of CPU per invocation fits a bank sync, which mostly waits on the network. D1's free plan hard-fails queries past its daily row limits since 1 September 2026, so Turso is the safer database there too.

## Scheduled synchronisation

`POST /api/sync` is protected by a shared secret and is the only entry point for synchronisation. How it gets called is a per-platform detail: a system cron or a timer in the container, a scheduled GitHub Action calling the route, or whatever the host provides.

Once a day is enough: banks post transactions in batches, and a PSD2 consent allows a limited number of calls per account per day.

## A lost password

There is no password reset by email: Archant sends no mail and holds no reset token. The way back in is a shell on the machine running the API:

```bash
pnpm api reset-password admin@example.com
# In the container: docker compose exec -it archant pnpm api reset-password admin@example.com
```

The command asks for the new password twice without echoing it, never accepts it as an argument, and closes every session of that user. It needs `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`, which it reads from the same `.env` the server does. A terminal is required, hence `-it`.

## Backups

No free tier backs up your data for you. Whatever the target, schedule a dump of the database to object storage, and verify a restore at least once. This holds bank history; losing it is the failure that actually matters.
