# Deployment

One codebase, several targets. `@archant/api` has a single entrypoint, `packages/api/src/index.ts`. A target is a matter of configuration and of the process that starts that file; application code never branches on the platform. The reasoning is in [adr/0002-container-reference-target.md](adr/0002-container-reference-target.md).

## Docker — the reference target

One image serves the built interface as static files and answers the API on the same origin. The database is a plain SQLite file on a volume. No cloud account, no second service. This is the only target with files in the repository: `Dockerfile`, `docker-compose.yml` and `.dockerignore`.

```bash
git clone git@github.com:leger-dosage/archant.git
cd archant
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"   # keep it: rotating it signs everyone out
docker compose up --build --detach --wait
```

Open http://localhost:8787. The first visit leads to `/setup`, which creates the administrator.

At start the server applies pending migrations, then listens. An upgrade is `git pull` followed by the same `docker compose up --build --detach --wait`, with no separate migration command. `GET /api/health` answers `200 {"data":{"status":"ok"}}` once it can query the database and `503` when it cannot; the image's `HEALTHCHECK` calls it, which is what `--wait` waits for.

Run exactly one container per database file. SQLite takes one writer, and two servers on one volume would each believe they own it.

### Variables

Compose reads them from the shell, or from a `.env` file next to `docker-compose.yml`, for interpolation only. It never passes that file to the container: the development `DATABASE_URL` and `BETTER_AUTH_URL` it holds would break it.

| Variable             | Required | What it does                                                                                                                                       |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | yes      | Signs session cookies, at least 32 characters. Compose refuses to start without it.                                                                |
| `ARCHANT_URL`        | no       | The address the browser uses, passed to the server as `BETTER_AUTH_URL`. Defaults to `http://localhost:8787`. A sign-in from any other is refused. |
| `TRUSTED_PROXIES`    | no       | The reverse proxies whose `X-Forwarded-For` is believed. See below.                                                                                |
| `APP_TIMEZONE`       | no       | Decides which day is "today" for balances. Defaults to `Europe/Paris`.                                                                             |
| `LOG_LEVEL`          | no       | pino level. Defaults to `info`.                                                                                                                    |

The image sets the rest: `DATABASE_URL=file:/data/archant.db` on the `archant-data` volume, `WEB_DIST=/app/packages/web/dist`, and port 8787. The server runs as the unprivileged `node` user.

### Behind a reverse proxy

For HTTPS, put a reverse proxy such as Caddy or nginx in front, then set `ARCHANT_URL` to the public address, for instance `https://archant.example.org`.

Also set `TRUSTED_PROXIES`. Without it, the server sees every visitor as the proxy's address, and they all share Better Auth's sign-in limit: three failed attempts by a stranger lock you out for ten seconds. A proxy on the host reaches the container through the Docker network's gateway, which this command prints:

```bash
docker network inspect archant_default --format '{{(index .IPAM.Config 0).Gateway}}'
```

The network is named after the directory holding `docker-compose.yml`. Then publish the port on loopback only, so no one can reach the container around the proxy and write that header themselves. Do it in a `compose.override.yml` next to `docker-compose.yml`, which Compose merges on its own and `git pull` never touches:

```yaml
services:
  archant:
    ports: !override
      - "127.0.0.1:8787:8787"
```

Without `!override`, Compose appends this entry to the port list instead of replacing it, and the port stays published on every interface.

### Stopping

`docker compose stop` ends the server at once. `init: true` gives the container a PID 1 that forwards SIGTERM to Node; SQLite in WAL mode keeps every committed transaction, so nothing waits for open connections. CI checks that the container exits with code 143, killed by SIGTERM, within a one-second timeout.

## Other targets

These stay possible and none of them will have a file in this repository, by design: adding one must never fork the application code.

- **A plain Node host.** Install, build the interface with `pnpm web build`, then start `packages/api/src/index.ts` with `WEB_DIST` set to the absolute path of `packages/web/dist` and an absolute `DATABASE_URL`. Put a reverse proxy in front.
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
# In the container, which carries no pnpm:
docker compose exec -it archant node packages/api/src/cli/reset-password.ts admin@example.com
```

The command asks for the new password twice without echoing it, never accepts it as an argument, and closes every session of that user. It needs `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`: from a checkout it reads them from the same `.env` the server does, and in the container they are already set. A terminal is required, hence `-it`.

## Backups

No free tier backs up your data for you. Whatever the target, schedule a dump of the database to object storage, and verify a restore at least once. This holds bank history; losing it is the failure that actually matters.
