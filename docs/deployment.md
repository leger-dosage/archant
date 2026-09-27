# Deployment

One codebase, several targets. `@archant/api` has a single entrypoint, `packages/api/src/index.ts`. A target is a matter of configuration and of the process that starts that file; application code never branches on the platform. The reasoning is in [adr/0002-container-reference-target.md](adr/0002-container-reference-target.md).

## Docker — the reference target

One image serves the built interface as static files and answers the API on the same origin. The database is a plain SQLite file on a volume. No cloud account, no second service. This is the only target with files in the repository: `Dockerfile`, `docker-compose.yml` and `.dockerignore`.

Every `vX.Y.Z` tag publishes the image to `ghcr.io/leger-dosage/archant` for `linux/amd64` and `linux/arm64`, tagged `X.Y.Z`, `X.Y` and `latest`, with a [GitHub Release](https://github.com/leger-dosage/archant/releases) listing its changes. `docker-compose.yml` runs that image, so the file alone is enough, without a checkout:

```bash
mkdir archant && cd archant
curl --fail --location --remote-name https://raw.githubusercontent.com/leger-dosage/archant/main/docker-compose.yml
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"   # keep it: rotating it signs everyone out
docker compose up --detach --wait
```

`up` pulls `latest` the first time only, when no local image has that name, and never again on its own. `docker compose pull` fetches the newest image for the tag, then `docker compose up --detach --wait` restarts on it; the pull also replaces an image a `--build` left under the same name. To stay on a release, set `ARCHANT_VERSION`, for instance to `1.2.3`, or to `1.2` so that `docker compose pull` brings that release's fixes and nothing newer. « Réglages » shows the running version, linked to its release notes.

From a checkout, `--build` builds the image from the source instead, and tags it with the same name. The interface then shows « Version de développement »:

```bash
git clone git@github.com:leger-dosage/archant.git
cd archant
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose up --build --detach --wait
```

Open http://localhost:8787. The first visit leads to `/setup`, which creates the administrator. It asks for a setup token, which only someone with access to the server can read: while the database has no user, the server prints a new one at every start, in the `msg` of a JSON `warn` line that `docker compose logs archant` shows:

```text
Setup is open. Open /setup and enter the setup token <token>. A new one is printed at every start.
```

Without it, whoever reached `/setup` first would own the instance; a new domain's certificate is public within minutes. Once the administrator exists, no token is printed and setup refuses every request.

If `--wait` reports the container as unhealthy or exited, `docker compose logs archant` says why: a missing or unreadable variable stops the server at startup and names itself there.

The port is published on `127.0.0.1` only, so nothing else on the network reaches the server around a reverse proxy or Tailscale. To reach it from another device on the home network, such as a phone, publish it on every interface in a `compose.override.yml` next to `docker-compose.yml`, which Compose merges on its own and `git pull` never touches:

```yaml
services:
  archant:
    ports: !override
      - "8787:8787"
```

Without `!override`, Compose appends this entry to the port list instead of replacing it, and the loopback entry stays. Then set `ARCHANT_URL` to the address that device uses, for instance `http://192.168.1.20:8787`, and run `docker compose up --detach --wait` again. The server refuses a sign-in from any address other than `ARCHANT_URL`, so the machine itself then has to use that address too. Anything beyond the home network belongs behind a reverse proxy with HTTPS: on a plain `http://` address that is neither loopback nor private, the server logs a `warn` line at start, because the password and session cookies would cross the internet unencrypted.

At start the server applies pending migrations, then listens; see [Upgrading](#upgrading). `GET /api/health` answers `200 {"data":{"status":"ok"}}` once it can query the database and `503` when it cannot; the image's `HEALTHCHECK` calls it, which is what `--wait` waits for.

Run exactly one container per database file. SQLite takes one writer, and two servers on one volume would each believe they own it.

### Variables

Compose reads them from the shell, or from a `.env` file next to `docker-compose.yml`, for interpolation only. It never passes that file to the container: the development `DATABASE_URL` and `BETTER_AUTH_URL` it holds would break it.

| Variable                        | Required | What it does                                                                                                                                       |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`            | yes      | Signs session cookies, at least 32 characters. Compose refuses to start without it.                                                                |
| `ARCHANT_URL`                   | no       | The address the browser uses, passed to the server as `BETTER_AUTH_URL`. Defaults to `http://localhost:8787`. A sign-in from any other is refused. |
| `TRUSTED_PROXIES`               | no       | The reverse proxies whose `X-Forwarded-For` is believed. See below.                                                                                |
| `APP_TIMEZONE`                  | no       | Decides which day is "today" for balances. Defaults to `Europe/Paris`.                                                                             |
| `LOG_LEVEL`                     | no       | pino level. Defaults to `info`. Above `warn`, the first start does not print the setup token.                                                      |
| `ENCRYPTION_KEY`                | no       | Encrypts bank session ids and the Enable Banking key at rest, base64 of 32 bytes. See [Connecting a bank](#connecting-a-bank).                     |
| `ENABLE_BANKING_APPLICATION_ID` | no       | Enable Banking application id, overriding the one saved in the interface. Set with the next one or not at all.                                     |
| `ENABLE_BANKING_PRIVATE_KEY`    | no       | The application's private key, base64 of the PEM, overriding the one saved in the interface.                                                       |
| `SYNC_SECRET`                   | no       | The bearer token of `POST /api/sync`, at least 32 characters. See [Scheduled synchronisation](#scheduled-synchronisation).                         |
| `ARCHANT_VERSION`               | no       | The image tag to run, such as `1.2.3` or `1.2`. Defaults to `latest`. Read by Compose only, never by the server.                                   |

The image sets the rest: `DATABASE_URL=file:/data/archant.db` on the `archant-data` volume, `WEB_DIST=/app/packages/app/dist`, port 8787, and `APP_VERSION`, the exact release it was built from, which « Réglages » shows; a local build leaves it empty. The server runs as the unprivileged `node` user, on a read-only root filesystem where only the `/data` volume and an in-memory `/tmp` accept writes, with every Linux capability dropped and `no-new-privileges` set.

### Behind a reverse proxy

For HTTPS, put a reverse proxy such as Caddy or nginx in front, then set `ARCHANT_URL` to the public address, for instance `https://archant.example.org`.

Also set `TRUSTED_PROXIES`. Without it, the server sees every visitor as the proxy's address, and they all share Better Auth's sign-in limit: three failed attempts by a stranger lock you out for ten seconds. A proxy on the host reaches the container through the Docker network's gateway, which this command prints:

```bash
docker network inspect archant_default --format '{{(index .IPAM.Config 0).Gateway}}'
```

The network is named after the directory holding `docker-compose.yml`. Keep the default loopback port, without the home-network override above, so no one can reach the container around the proxy and write that header themselves.

### Stopping

`docker compose stop` ends the server at once. `init: true` gives the container a PID 1 that forwards SIGTERM to Node; SQLite in WAL mode keeps every committed transaction, so nothing waits for open connections. CI checks that the container exits with code 143, killed by SIGTERM, within a one-second timeout.

`docker compose down` keeps the data; `docker compose down --volumes` deletes the volume, and with it the database.

## Upgrading

Pin the release you run with `ARCHANT_VERSION` in the `.env` next to `docker-compose.yml`, so that an upgrade is a decision rather than whatever `latest` points at. Set it there rather than with `export`: a new shell forgets an exported variable, and the next `up` from it would return to `latest`. To upgrade, change the line in `.env` to the new release:

```dotenv
ARCHANT_VERSION=1.3.0
```

Then pull and restart:

```bash
docker compose pull
docker compose up --detach --wait
```

There is no separate migration command. The server applies pending migrations before it listens, and `--wait` returns once `GET /api/health` answers, which proves they ran.

Before it migrates, the server copies the database with `VACUUM INTO` to `/data/backups`, named after the time and the release about to migrate it, such as `archant-20260927T083000Z-1.3.0.db`, and keeps the five most recent. Each copy is the size of the database, so the volume needs room for five more of it. It copies nothing when no migration is pending, and nothing from a Turso database. If the copy fails, for lack of disk space or a permission, the server logs a `fatal` line naming the error code and the directory, exits, and leaves the database as it was: free the space, then start again.

Migrations only go forward, so an older image cannot open a file a newer one migrated. To go back from `1.3.0`, set `ARCHANT_VERSION` in `.env` back to the release you came from, `ARCHANT_VERSION=1.2.0`, then restore the copy whose name ends in `-1.3.0.db`, which holds the database as it was just before `1.3.0` migrated it:

```bash
docker compose run --rm --no-deps archant ls /data/backups
docker compose stop
docker compose run --rm --no-deps archant \
  sh -c 'cp /data/backups/archant-20260927T083000Z-1.3.0.db /data/archant.db && rm -f /data/archant.db-wal /data/archant.db-shm'
docker compose up --detach --wait
```

This is the restore described in [Backups](#backups), from the volume rather than from the host. Whatever was written after the upgrade is lost.

The port is published on `127.0.0.1` only since the container was locked down: an install reached from another device loses that access at the upgrade until it adds the home-network `compose.override.yml` described [above](#docker--the-reference-target).

From a checkout, `git pull` then `docker compose up --build --detach --wait` builds and runs the new code, with the same copy, named `-dev`. Without Docker, `git pull`, `pnpm install --frozen-lockfile`, then restart `pnpm api start:dev`: the copy lands in `backups/` beside `local.db`, which git ignores. `pnpm data migrate:local` migrates without a copy.

## Backups

No free tier backs up your data for you, and this file holds your bank history. Schedule a copy to storage off the machine, and restore it once to check it works.

The copy the server takes before a migration, described in [Upgrading](#upgrading), is not a backup. It sits on the same disk as the database, only five are kept, and none is taken while no upgrade migrates anything. It protects an upgrade, not the data: a dead disk takes both.

The database runs in WAL mode: recent writes sit in `archant.db-wal` until SQLite folds them into `archant.db`. Copying `archant.db` alone, or the volume while the server writes, loses them or yields a broken file. Take the copy with `VACUUM INTO` instead, which writes a consistent, self-contained file while the server keeps running. The image carries no `sqlite3`, so Node's built-in `node:sqlite` runs it:

```bash
docker compose exec archant node -e "new (require('node:sqlite').DatabaseSync)('/data/archant.db').exec(\"VACUUM INTO '/data/backup.db'\")"
docker compose cp archant:/data/backup.db "./archant-$(date +%F).db"
docker compose exec archant rm /data/backup.db
```

`VACUUM INTO` refuses to overwrite a file, hence the `rm`. From a checkout, the same command works on `local.db`, or `sqlite3 local.db "VACUUM INTO 'backup.db'"` where `sqlite3` is installed.

The backup holds bank session ids encrypted with `ENCRYPTION_KEY`, and user sessions signed with `BETTER_AUTH_SECRET`. Keep both keys somewhere safe, apart from the backups: restored without `ENCRYPTION_KEY`, every bank has to be connected again.

To restore, stop the server, replace the file, and delete the WAL files: a WAL left over from the old database would be replayed onto the restored one.

```bash
docker compose stop
docker compose run --rm --no-deps --volume "$PWD:/restore:ro" archant \
  sh -c 'cp /restore/archant-2026-09-24.db /data/archant.db && rm -f /data/archant.db-wal /data/archant.db-shm'
docker compose up --detach --wait
```

A backup older than the code is fine: the server migrates it at start. Moving from a checkout to the container is the same restore, with a backup of `local.db` as the file.

## Connecting a bank

Archant reads bank data through [Enable Banking](https://enablebanking.com), a licensed PSD2 aggregator. Connection is optional, and set up from the interface: the server needs one variable, `ENCRYPTION_KEY`, and « Réglages » › « Banques » takes the Enable Banking application ID and its private key. Without `ENCRYPTION_KEY`, the bank routes answer `503`, the page names it under « La connexion bancaire n'est pas configurée », and everything else, file import included, works. A variable that is set but unreadable stops the server at startup, so a typo never passes for a feature left off.

### Sandbox or production

An Enable Banking application belongs to one environment, sandbox or production, for good. Both use the same API, `https://api.enablebanking.com`, so Archant needs no setting to tell them apart: the application id decides.

- **Sandbox** needs only an account on the control panel. Its banks serve simulated data, including Enable Banking's Mock ASPSP, offered for every country and needing no credentials. Start here to try the flow.
- **Production** reads your real accounts. Without a contract with Enable Banking, the panel activates the application in restricted mode through "Activate by linking accounts": only the accounts you link there are readable, which Enable Banking allows for personal use.

### 1. Register the application

In the [control panel](https://enablebanking.com/cp/applications), register a new application:

- Environment: Sandbox to try, Production for your own accounts. Production also asks for a description, a GDPR contact email, and privacy policy and terms URLs.
- Name: shown to you on the consent screen, `Archant` will do.
- Redirect URLs: Archant's address followed by `/settings/banks/callback`. « Réglages » › « Banques » shows it with a copy button. That address is `BETTER_AUTH_URL` from a checkout, `ARCHANT_URL` for the container:

  | Where Archant runs           | Redirect URL to register                              |
  | ---------------------------- | ----------------------------------------------------- |
  | `pnpm app start:dev`         | `http://localhost:5173/settings/banks/callback`       |
  | The container, default       | `http://localhost:8787/settings/banks/callback`       |
  | The container behind a proxy | `https://archant.example.org/settings/banks/callback` |

  Register every one you use. The bank sends the browser back there; any other URL makes Enable Banking refuse the connection. Archant checks the list when the credentials are saved, and names the exact URL to register when it is missing.

- Key: keep the default, which generates the key pair in the browser. Registering downloads the private key as `<application id>.pem`; keep that file. To bring your own key instead, generate it and upload the certificate:

  ```bash
  openssl req -new -newkey rsa:2048 -nodes -x509 -days 3650 -subj "/CN=archant" \
    -keyout private.pem -out public.crt
  ```

### 2. Set the encryption key

`ENCRYPTION_KEY` encrypts each bank session, and the private key saved from the interface, with AES-256-GCM before they reach the database. Back it up apart from the database, so a leaked backup alone gives nobody access to your bank data. Losing the key, or changing it, leaves what it encrypted unreadable, and every bank must be connected again. Once no bank is connected, the page asks for the Enable Banking credentials again; while one still is, the page stays locked and disconnecting cannot revoke its session, a known limitation.

```bash
export ENCRYPTION_KEY="$(openssl rand -base64 32)"
docker compose up --build --detach --wait
```

From a checkout, write the value in `.env` and restart `pnpm api start:dev`: its `--watch` reloads on code changes, not on `.env`.

### 3. Save the credentials in the interface

Open « Réglages » › « Banques », at `/settings/banks`. Under « Application Enable Banking », enter the « Identifiant de l'application » and choose the `.pem` file the panel downloaded, or `private.pem` if you brought your own key; a file holding the key after its certificate works too. Press « Enregistrer ».

Archant signs a request to Enable Banking with the pair before it keeps anything: a pair the provider refuses, or an application that does not list the redirect URL, saves nothing and says why. The application ID is stored as is, the key encrypted. They can be changed from the same page while no bank is connected; once one is, the form is locked, as in Sure, until every bank is disconnected.

#### Or pin them in the environment

A self-hoster who keeps secrets in a vault can set `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY` instead. They win over anything saved in the interface, which then shows « Enable Banking est configuré par le serveur. » and no form. Set both or neither: one alone stops the server at startup, naming the other. The private key goes in base64, because a multi-line PEM does not survive every `.env` parser or hosting control panel. PKCS#1 (`BEGIN RSA PRIVATE KEY`) and PKCS#8 (`BEGIN PRIVATE KEY`) both work. Disconnect every bank before removing the variables, for the same reason: the page stays locked while a bank is connected, and its session belongs to the pinned application.

```bash
export ENABLE_BANKING_APPLICATION_ID="<the application id from the panel>"
export ENABLE_BANKING_PRIVATE_KEY="$(base64 < "$ENABLE_BANKING_APPLICATION_ID.pem" | tr -d '\n')"
```

### 4. Connect a bank

1. Open « Réglages » › « Banques », at `/settings/banks`.
2. Pick the « Pays », then the bank under « Banques disponibles ». « Rechercher une banque » filters by name or BIC.
3. Give your consent on the bank's site, or on the sandbox bank's page. The browser comes back to « Connexion à votre banque », then to the connection's page.
4. For each account under « Comptes de la banque », choose « Nouveau : … » to create an Archant account, an existing account under « Associer à » to let the bank take over its balance, or « Ignorer ». Press « Valider »: the linked accounts sync at once.

The connection's page, reached from « Banques connectées », shows the last sync and its error, and holds « Synchroniser », « Renouveler le consentement » and « Déconnecter ». Disconnecting turns the linked accounts into manual ones and keeps their transactions.

Archant asks each bank for 90 days of consent, or less when the bank allows less. Before it ends, a warning offers « Renouveler ». Once it has ended, syncing stops and the warning offers « Reconnecter »; nothing is deleted, and the next sync picks up where the last one stopped.

## Scheduled synchronisation

`POST /api/sync` syncs every active bank connection, with `Authorization: Bearer <SYNC_SECRET>`. How it gets called is a per-platform detail: a system cron or a timer on the host, a scheduled GitHub Action calling the route, or whatever the host provides. Without the header, with a wrong secret, or while `SYNC_SECRET` is unset, it answers `401` and reads nothing; with the right secret but no Enable Banking configuration, `503`. Each connection page also has a « Synchroniser » button, which works without the secret and obeys the same one-hour spacing: pressed within an hour of the last sync, the one that follows linking included, it answers « Cette banque a été synchronisée il y a moins d'une heure. Réessayez plus tard. »

```bash
# crontab -e on the host, every morning at 6:
0 6 * * * curl --fail --silent --show-error -X POST -H "Authorization: Bearer $SYNC_SECRET" https://archant.example.org/api/sync
```

The answer names each connection and what happened to it:

```json
{ "data": { "connections": [{ "id": "…", "result": "synced" }] } }
```

`synced` means every linked account synced. `failed` means at least one did not: the others are committed, the connection page shows the error, and the next run retries the failed account from where it last succeeded. `skipped` means a sync ran less than an hour ago or one is still running. `consent_expired` means the consent has ended and nothing was read until it is renewed.

Once a day is enough: banks post transactions in batches, and a PSD2 consent allows a limited number of calls per account per day. The first sync of an account reads three months back; each later one reads from seven days before its last success, so a line the bank books late still arrives, once.

## Passwords

Signed in, change the password in « Réglages » › « Sécurité ». That closes the sessions open on other devices.

A lost password has no reset by email: Archant sends no mail and holds no reset token. The way back in is a shell on the machine running the API:

```bash
pnpm api reset-password admin@example.com
# In the container, which carries no pnpm:
docker compose exec -it archant node packages/api/src/cli/reset-password.ts admin@example.com
```

The command asks for the new password twice without echoing it, never accepts it as an argument, and closes every session of that user. It also turns two-factor sign-in off, and says so on a second line when it was on: a lost phone with no backup code left is recovered the same way. It needs `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL`: from a checkout it reads them from the same `.env` the server does, and in the container they are already set. A terminal is required, hence `-it`.

### Two-factor sign-in

Optional, turned on in « Réglages » › « Sécurité »: after the password, sign-in asks for a code from an authenticator app, or one of ten single-use backup codes shown once when it is turned on. Turning it off and regenerating the backup codes both ask for the password.

The authenticator secret and the backup codes are stored encrypted with `BETTER_AUTH_SECRET`. Losing or rotating that secret makes them unreadable, so no code is accepted any more: run `reset-password` above, which turns two-factor off, then turn it on again and scan the new QR code.

## Other targets

These stay possible and none of them will have a file in this repository, by design: adding one must never fork the application code.

- **A plain Node host.** Run `pnpm install --frozen-lockfile`, build the interface with `pnpm app build`, then start `packages/api/src/index.ts` with `WEB_DIST` set to the absolute path of `packages/app/dist` and an absolute `DATABASE_URL`. Put a reverse proxy in front.
- **Turso.** Point the database URL at the `libsql://` address and provide its token. The driver is the same one as for a local file. The free plan allows 5 GB and 500 million rows read a month.
- **Render, Fly and the like.** The container, deployed as is. A Render free web service spins down after 15 minutes of inactivity, which delays the first request after a quiet night.
- **Cloudflare Workers.** Possible in principle, since Hono only needs web standards, but it would need an entrypoint of its own and a `wrangler.toml`. The 10 ms of CPU per invocation fits a bank sync, which mostly waits on the network. D1's free plan hard-fails queries past its daily row limits since 1 September 2026, so Turso is the safer database there too.
