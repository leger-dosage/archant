# Deployment

One codebase, several targets. `@archant/api` has a single entrypoint, `packages/api/src/index.ts`. A target is a matter of configuration and of the process that starts that file; application code never branches on the platform. The reasoning is in [adr/0002-container-reference-target.md](adr/0002-container-reference-target.md).

This page is the reference for each recipe. [hosting.md](hosting.md) walks one path end to end with them: a machine at home, reachable only through Tailscale, connected to a real bank.

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
git clone https://github.com/leger-dosage/archant.git
cd archant
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
docker compose up --build --detach --wait
```

Open http://localhost:8787. The first visit leads to `/setup`, which creates the administrator. It asks for a setup token, which only someone with access to the server can read: while the database has no user, the server prints a new one at every start, in the `msg` of a JSON `warn` line. `up --detach --wait` prints no log, so read it from the container's:

```bash
docker compose logs archant | grep 'Setup is open'
```

```text
Setup is open. Open /setup and enter the setup token <token>. A new one is printed at every start.
```

Take the token from the last line: each start replaces the previous token.

Open Archant at the address `ARCHANT_URL` names, `http://localhost:8787` when it is empty. From any other address, setup and sign-in are refused, and the page says to set `ARCHANT_URL` to the address in the browser's address bar, then restart. An invitation link from « Réglages » › « Membres » names that address too, so it must be the one the household's members reach, such as a Tailscale name, rather than `localhost`.

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

| Variable                        | Required | What it does                                                                                                                                                              |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`            | yes      | Signs session cookies, at least 32 characters. Compose refuses to start without it.                                                                                       |
| `ARCHANT_URL`                   | no       | The address the browser uses, passed to the server as `BETTER_AUTH_URL`. Defaults to `http://localhost:8787`. Setup, sign-in and every change from any other are refused. |
| `TRUSTED_PROXIES`               | no       | The reverse proxies whose `X-Forwarded-For` is believed. See below.                                                                                                       |
| `APP_TIMEZONE`                  | no       | Decides which day is "today" for balances. Defaults to `Europe/Paris`.                                                                                                    |
| `LOG_LEVEL`                     | no       | pino level. Defaults to `info`. Above `warn`, the first start does not print the setup token.                                                                             |
| `ENCRYPTION_KEY`                | no       | Encrypts bank session ids and the Enable Banking key at rest, base64 of 32 bytes. See [Connecting a bank](#connecting-a-bank).                                            |
| `ENABLE_BANKING_APPLICATION_ID` | no       | Enable Banking application id, overriding the one saved in the interface. Set with the next one or not at all.                                                            |
| `ENABLE_BANKING_PRIVATE_KEY`    | no       | The application's private key, base64 of the PEM, overriding the one saved in the interface.                                                                              |
| `SYNC_SECRET`                   | no       | The bearer token of `POST /api/sync`, at least 32 characters. See [Scheduled synchronisation](#scheduled-synchronisation).                                                |
| `ARCHANT_VERSION`               | no       | The image tag to run, such as `1.2.3` or `1.2`. Defaults to `latest`. Read by Compose only, never by the server.                                                          |

Security prices need no variable. Fetching them is off until the owner turns it on from « Réglages › Placements »; it then reaches Yahoo Finance at `YAHOO_FINANCE_URL`, `https://query1.finance.yahoo.com` by default, which only tests change, on the first visit of the day and from « Mettre à jour les cours ». [What leaves the server](security-model.md#security-prices) says what Yahoo learns.

The image sets the rest: `DATABASE_URL=file:/data/archant.db` on the `archant-data` volume, `WEB_DIST=/app/packages/app/dist`, port 8787, `HOST=0.0.0.0`, and `APP_VERSION`, the exact release it was built from, which « Réglages » shows; a local build leaves it empty. Outside a container the server listens on `127.0.0.1` only; the image makes it listen on every interface of the container, because a published port reaches the container through its network interface, never its loopback. That exposes nothing more: who reaches the server is decided by the published port, `127.0.0.1` only unless you open it. The server runs as the unprivileged `node` user, on a read-only root filesystem where only the `/data` volume and an in-memory `/tmp` accept writes, with every Linux capability dropped and `no-new-privileges` set.

### Behind a reverse proxy

For HTTPS, put a reverse proxy such as Caddy or nginx in front, then set `ARCHANT_URL` to the public address, for instance `https://archant.example.org`.

Also set `TRUSTED_PROXIES`. Without it, the server sees every visitor as the proxy's address, and they all share Better Auth's sign-in limit: three failed attempts by a stranger lock you out for ten seconds. A proxy on the host reaches the container through the Docker network's gateway, which this command prints:

```bash
docker network inspect archant_default --format '{{(index .IPAM.Config 0).Gateway}}'
```

The network is named after the directory holding `docker-compose.yml`. Keep the default loopback port, without the home-network override above, so no one can reach the container around the proxy and write that header themselves.

Let the proxy pass a request body of at least 11 MB. A receipt or an invoice attached to a transaction is uploaded one file at a time, each up to 10 MB, and a statement import up to 5 MB; the server refuses anything larger itself. Caddy sets no limit by default. nginx refuses any body over 1 MB unless told otherwise, and the interface then shows a network error rather than the size message:

```nginx
client_max_body_size 11m;
```

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

Outside a container, the server now listens on `127.0.0.1` only, unless `HOST` says otherwise: a reverse proxy on another machine, or a device reaching the port directly, loses access at the upgrade. See [Other targets](#other-targets).

From a checkout, `git pull` then `docker compose up --build --detach --wait` builds and runs the new code, with the same copy, named `-dev`. Without Docker, `git pull`, `pnpm install --frozen-lockfile`, then restart `pnpm api start:dev`: the copy lands in `backups/` beside `local.db`, which git ignores. `pnpm data migrate:local` migrates without a copy.

### Versions

Archant follows [semantic versioning](https://semver.org/). While the version starts with `0.`, a minor release, `0.3.0` after `0.2.1`, may break an upgrade; a patch release, `0.2.2`, never does. From `1.0.0` on, only a major release may.

A deprecation, such as a variable renamed or a behaviour about to change, is announced in the release notes one minor release before the release that removes it, so that pinning `ARCHANT_VERSION` to a minor release, `0.2`, never brings it by surprise. Left unset, it is `latest`, and a pull may cross a breaking minor release.

Each release's notes on the [releases page](https://github.com/leger-dosage/archant/releases) list what breaks under « Before upgrading », with what to do. Read that section for every release between the one you run and the one you move to, before changing `ARCHANT_VERSION`.

### Verifying an image

Every release image from `0.2.1` on carries a build provenance attestation: a statement, signed during the release workflow, that this repository's `.github/workflows/release.yml` built this exact digest from this tag. Before running a new release, check it:

```bash
gh attestation verify oci://ghcr.io/leger-dosage/archant:1.3.0 --repo leger-dosage/archant \
  --signer-workflow leger-dosage/archant/.github/workflows/release.yml
```

The command needs the [GitHub CLI](https://cli.github.com/) signed in with `gh auth login`, any account will do, even though the image itself pulls anonymously. It fails if the image was built anywhere else, by another workflow of the repository included, or changed after it was built. Releases before `0.2.1` carry no attestation, and were published before releases became immutable.

The image also carries its software bill of materials, the list of every package inside it, and its build provenance, both readable from the registry:

```bash
docker buildx imagetools inspect ghcr.io/leger-dosage/archant:1.3.0 --format '{{json .SBOM}}'
docker buildx imagetools inspect ghcr.io/leger-dosage/archant:1.3.0 --format '{{json .Provenance}}'
```

GitHub Releases are immutable: once published, a release's tag cannot move to another commit, nor be deleted while the release exists.

## Backups

No free tier backs up your data for you, and this file holds your bank history. Schedule a copy to storage off the machine, and restore it once to check it works. The file also holds every receipt and invoice attached to a transaction, so the copy carries them too, and grows by the size of each file attached: up to 100 MB for a transaction holding ten. Each of the five copies the server keeps in `backups/` before a migration holds every attachment as well.

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

## Exporting your data

« Réglages » › « Données » downloads every figure Archant holds as one ZIP, `archant_export_YYYYMMDD_HHMMSS.zip`, the time in `APP_TIMEZONE`. It is built while it downloads, from one consistent read of the database, and nothing is stored on the server; ledger writes go on meanwhile. `GET /api/export` serves it to a signed-in session.

The archive follows the format of Sure's own export: `version.txt`, `accounts.csv`, `transactions.csv`, `trades.csv`, `categories.csv`, `merchants.csv`, `rules.csv`, `attachments.json` and `all.ndjson`, under Sure's names and columns, then `goals.ndjson` and `prices.ndjson`, which Sure's export has no file for. `attachments.json` lists each file attached to a transaction, its name, type and size, without its content, as Sure's manifest does: the files themselves stay in the database and its backups. In it, transaction, trade and recurring amounts follow Sure's sign, a purchase positive and an income negative, the reverse of Archant's; balances, snapshots and budget amounts keep theirs. What Sure has no field for, such as locked fields, transfer kinds, dismissed recurring payments, a loan's end date or a rule that replaces text in the label, goes in `all.ndjson` under an `archant` key that Sure's importer ignores. A rule whose only action replaces text in the label is left out of Sure's files, which have no way to hold it. `goals.ndjson` holds one `Goal` line per savings goal and one `GoalAccount` line per account it links, in Sure's column names, amounts as decimals in the goal's currency, a goal's `completed_amount` and `completed_at` `null` unless it was completed, its `target_months` `null` unless its `target_mode` is `months_of_expenses`, its `target_amount` then the target last computed when it was saved, and a link's `allocated_amount` `null` when it takes the whole balance; they stay out of `all.ndjson`, whose importer refuses a type it does not know. `prices.ndjson` holds one `SecurityPrice` line per price typed with « Saisir un cours », naming its security as a trade does; the prices Yahoo Finance gave stay out, fetched again by the next update. A cost basis locked by hand leaves on the `Holding` lines of its position's days, as Sure's manual one. Each trade names its security by ticker, name and venue, a security typed by hand by its ISIN, else by its name, since Sure's import requires a ticker, interest on the account's cash by Sure's own `CASH-<account id>` ticker, with the ISIN and the fee under `archant`. A transaction converted into a trade stays in `all.ndjson` as an excluded transaction, as Sure leaves one it converts. A split transaction is its lines in `transactions.csv`, and its parent with the lines under `split_lines` in `all.ndjson`, as Sure writes them. A transfer Sure would refuse, such as two sides moved more than 30 days apart, is left out of Sure's transfers, and its two transactions keep the link as `archant.transfer`. One valuation per account and day reaches Sure's files: the opening balance first, then the bank's figure, then a snapshot. Sure refuses any entry 30 years old or more, so Sure's lines start 29 years before the export day: an older opening balance moves to that day at the balance of that day, its own date kept as `archant.opening_date`, and older transactions and snapshots stay in `transactions.csv` only, older trades in `trades.csv`.

The archive is portable, not a backup. Archant never reads it back, and it leaves out what a restore needs: passwords, sessions, two-factor secrets, bank connections, deduplication keys, imported files and the content of attachments. A restore is the `VACUUM INTO` copy of [Backups](#backups). It also holds every amount, label and note in clear, unlike the bank sessions the database encrypts: keep it as you would a bank statement.

To move to Sure, unzip the archive and, in Sure, choose « Import from Sure » and upload `all.ndjson`. Sure creates the accounts, their history, categories, tags, merchants, recurring payments, transfers, budgets and rules from it, and computes its own balances again. Its importer reads no goal: create them again in Sure from `goals.ndjson`, where a link's `account_id` is the `id` of an `Account` line of `all.ndjson`, which names the account. Import it once, into a family with no accounts yet: Sure's importer creates every account again on a second run. Sure refuses a file over 10 MB or 100,000 lines by default, and `all.ndjson` holds one line per transaction and one per account and day: for a long history, raise `SURE_IMPORT_MAX_NDJSON_SIZE_MB` and `SURE_IMPORT_MAX_ROWS` on the Sure server first. Sure's importer reads each budget category's amount but not its rollover switch, so turn rollover on again in Sure for each category that had « Report » on. It also ignores a loan's original amount and rate, which the archive carries, and a rule naming an account keeps Archant's account id, as Sure's own export does, so set that account again in the rule once imported. A rule naming a category, merchant or tag deleted since keeps its id too, and Sure creates one under that id: delete such a rule in Archant before exporting, or fix it in Sure.

## Connecting a bank

Archant reads bank data through [Enable Banking](https://enablebanking.com), a licensed PSD2 aggregator. Connection is optional, and set up from the interface: the server needs one variable, `ENCRYPTION_KEY`, and « Réglages » › « Banques » takes the Enable Banking application ID and its private key. Without `ENCRYPTION_KEY`, the bank routes answer `503`, the page names it under « La connexion bancaire n'est pas configurée », and everything else, file import included, works. A variable that is set but unreadable stops the server at startup, so a typo never passes for a feature left off.

### Sandbox or production

An Enable Banking application belongs to one environment, sandbox or production, for good. Both use the same API, `https://api.enablebanking.com`, so Archant needs no setting to tell them apart: the application id decides.

- **Sandbox** needs only an account on the control panel. Its banks serve simulated data, including Enable Banking's Mock ASPSP, offered for every country and needing no credentials. Start here to try the flow.
- **Production** reads your real accounts. Without a contract with Enable Banking, the panel activates the application in restricted mode through "Activate by linking accounts": only the accounts you link there are readable, which Enable Banking allows for personal use.

For production, register a second application in [step 1](#1-register-the-application) with the environment set to Production. Once it is registered, choose "Activate by linking accounts" in the panel and link, through your bank, the accounts Archant may read; the application then works in restricted mode, on those accounts only. Continue with steps 2 to 4 as for the sandbox. The credentials can only be changed while no bank is connected, so moving from a sandbox application to a production one means disconnecting the sandbox banks first.

### 1. Register the application

In the [control panel](https://enablebanking.com/cp/applications), register a new application:

- Environment: Sandbox to try, Production for your own accounts. Production also asks for a description, a GDPR contact email, and privacy policy and terms URLs.
- Name: shown to you on the consent screen, `Archant` will do.
- Redirect URLs: Archant's address followed by `/settings/banks/callback`. « Réglages » › « Banques » shows it with a copy button. That address is `BETTER_AUTH_URL` from a checkout, `ARCHANT_URL` for the container:

  | Where Archant runs             | Redirect URL to register                                     |
  | ------------------------------ | ------------------------------------------------------------ |
  | `pnpm app start:dev`           | `http://localhost:5173/settings/banks/callback`              |
  | The container, default         | `http://localhost:8787/settings/banks/callback`              |
  | The container behind a proxy   | `https://archant.example.org/settings/banks/callback`        |
  | The container behind Tailscale | `https://<machine>.<tailnet>.ts.net/settings/banks/callback` |

  Register every one you use. The bank sends the browser back there; any other URL makes Enable Banking refuse the connection. Archant checks the list when the credentials are saved, and names the exact URL to register when it is missing.

  Behind Tailscale, the bank sends your browser back to the `ts.net` address, which resolves only on the tailnet, while every call to Enable Banking leaves the server outbound, so Archant needs no port open on the internet. Enable Banking accepts a `ts.net` redirect URL for a production application, checked on 2026-09-29.

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
2. Pick the « Pays », press « Choisir une banque », then choose the bank in the dialog, where « Rechercher une banque » filters by name or BIC.
3. Give your consent on the bank's site, or on the sandbox bank's page. The browser comes back to « Connexion à votre banque », then to the connection's page.
4. For each account under « Comptes de la banque », choose « Nouveau : … » to create an Archant account, an existing account under « Associer à » to let the bank take over its balance, or « Ignorer ». Press « Valider »: the linked accounts sync at once.

The connection's page, reached from « Banques connectées », shows the last sync and its error, and holds « Synchroniser », « Renouveler le consentement » and « Déconnecter ». Disconnecting turns the linked accounts into manual ones and keeps their transactions.

Archant asks each bank for 90 days of consent, or less when the bank allows less. Before it ends, a warning offers « Renouveler ». Once it has ended, syncing stops and the warning offers « Reconnecter »; nothing is deleted, and the next sync picks up where the last one stopped.

## Connecting an assistant

An AI assistant on your own machine can read Archant through MCP, the Model Context Protocol, at `/api/mcp`. It signs in as you, with your password and your second factor, and acts only with what you allow on the consent page. There is no API key to create or paste.

Assistants need `ARCHANT_URL` on HTTPS, or on `localhost` for development. On plain HTTP elsewhere the server starts without them: `/api/mcp` answers `404`, and « Réglages » › « Assistants IA » says HTTPS is required. [hosting.md](hosting.md#4-serve-archant-over-https) gets a certificate with Tailscale.

« Réglages » › « Assistants IA », at `/settings/assistants`, shows the address to give, `https://archant.example.org/api/mcp`, with a button that copies it. Add it to the assistant:

```bash
# Claude Code
claude mcp add --transport http archant https://archant.example.org/api/mcp
```

```jsonc
// VS Code: .vscode/mcp.json in a workspace, or the user's mcp.json
{ "servers": { "archant": { "type": "http", "url": "https://archant.example.org/api/mcp" } } }
```

```jsonc
// Cursor: ~/.cursor/mcp.json
{ "mcpServers": { "archant": { "url": "https://archant.example.org/api/mcp" } } }
```

The first call opens the browser on Archant's sign-in page, then the code step when two-factor is on, then the consent page. It names the assistant and the address it returns to, and asks for two scopes:

- `archant:read`, « Lire vos comptes, vos opérations, vos règles, vos budgets et vos factures », always granted when the assistant asks;
- `archant:write`, « Créer et modifier vos règles, classer vos opérations, définir vos budgets, gérer vos factures », which you can untick to grant read only.

The assistant then holds an access token valid ten minutes, bound to `/api/mcp`, and a refresh token valid 30 days, replaced at each use. It identifies itself either with a Client ID Metadata Document, which Archant fetches from the assistant's publisher, or by registering itself; Archant accepts both and nothing else.

With `archant:read`, the assistant can call `get_accounts`, `get_categories`, `get_merchants`, `get_tags`, `get_transactions`, `get_transaction`, `group_transactions_by_label`, `get_balance_sheet`, `get_income_statement`, `get_budget`, `get_recurring_transactions`, `get_bills`, `get_bill_details`, `get_bill_audit`, `get_holdings`, `get_rules`, `get_rule_runs` and `preview_rule`, which read only. `get_balance_sheet` and `get_income_statement` give the dashboard's net worth and month, and `get_accounts` each account's history as its page charts it, from the same code, so the assistant and the interface never disagree, as `get_holdings` gives an account's « Positions »; a series longer than a year is thinned to one point a week, beyond five years to one a month. Like the dashboard, they count only the accounts in the reporting currency and say how many they left out. With `archant:write` as well, it can call `create_rule`, `update_rule`, `set_rule_enabled`, `delete_rule`, `apply_rules`, `create_category`, `create_merchant`, `create_tag`, `update_transaction`, `bulk_update_transactions`, `rename_category`, `rename_merchant`, `rename_tag`, `update_budget`, `create_bill`, `update_bill` and `record_bill_payment`. No tool deletes or merges a transaction, a category, a merchant or a tag, and none creates a transaction. Amounts are decimal strings such as `"-12.50"` beside their currency. Each call is recorded with the assistant, the tool, the time, its outcome and the rows it changed, never its arguments or its answer, and kept 90 days.

The server tells the assistant how to write rules: group the labels, draft a rule, preview it and show you how many transactions it would change with a sample of them, then create it, preview it again and apply it with that count. `apply_rules` writes nothing when the count has changed since the preview, and answers the count now. A field you set by hand is never changed by a rule, as in the interface, and each application appears in « Exécutions récentes » on the rules page.

For the transactions no rule covers, `update_transaction` sets one transaction's category, merchant, tags, notes, label or exclusion, as its sheet does, and `bulk_update_transactions` sets a category or a merchant, adds tags, or sets or clears the exclusion of up to 200 transactions, or every transaction a filter matches, as the bulk bar does. Neither changes a date or an amount, nor the exclusion of a split transaction or one of its lines: `update_transaction` answers `TRANSACTION_SPLIT`, and `bulk_update_transactions` leaves it as it is. Each field they set is locked against rules, as an edit of yours is, so the server tells the assistant to prefer a rule when a label repeats. Before a bulk update by filter, the assistant reads the filter's count with `get_transactions` and shows it to you; the update writes nothing when the filter matches another count at that moment, and answers the count now. `rename_category`, `rename_merchant` and `rename_tag` rename as « Réglages » does, and refuse a name already taken.

`get_budget` gives a month's budget as the budget page shows it, from the same code, and up to eleven months before it: the planned spending and expected income, what the month spent and earned, and each expense category's amount, spending, carried amount and status, among `over_budget`, `near_limit`, `on_track`, `unbudgeted` and `no_activity`, as Sure's tool names them. « Sans catégorie » appears beside the categories, without an id. `update_budget` sets a month's planned spending, expected income and category amounts by category id, in one write that a refusal anywhere leaves undone. A month not set up needs both the spending and the income, as the form does; « Sans catégorie », which holds what the spending leaves unallocated, and an income category are refused. The server tells the assistant to show you the amounts and wait for your agreement first. No tool copies a budget, moves money between categories or switches a category's carry-over: the budget page does.

`get_bills` lists the bills as « Factures » does, by next due date, filtered by status (`active` by default, `suggested`, `paused`, `ended` or `all`), by the current occurrence's payment state, by type, by a search and by a due date within 1 to 365 days, 100 at most, each with its current occurrence and its monthly equivalent; its totals count every match, leave out the incomes, and like the dashboard name the accounts in another currency they leave out. `get_bill_details` gives one bill's configuration, its open occurrences, its twelve latest closed ones with their payments, its next three due dates and its price changes of the last 24 months. `get_bill_audit` gives Sure's review: possible duplicates, price changes over 1 to 24 months, bills a whole cycle late, paused bills still owed, suggestions and recurring charges no bill follows, twenty items a section with the count. `create_bill` declares a bill or an income by account and category id, `update_bill` edits a bill as its dialog does and pauses or resumes it in one write, and `record_bill_payment` settles an open occurrence, the current one by default, or adds a partial payment up to what remains, never linked to a transaction. Amounts are positive, the type carrying the direction. The server tells the assistant that a suggestion is not a bill yet, and to tell you what will change and wait for your agreement before each of the three. Sure's `get_paycheck_plan` has no counterpart.

An assistant granted read only that calls a write tool gets a `403` with `WWW-Authenticate: Bearer error="insufficient_scope"`, and nothing is written. A client following the MCP specification may offer to sign in again for the write scope; the consent page then asks you again, and you can untick it again.

The page lists each connected assistant with its access, the date you allowed it and its last call. « Déconnecter » takes effect at the assistant's next call: its access token is refused before its ten minutes are up, and its refresh token is deleted.

Claude Desktop, claude.ai and ChatGPT reach an MCP server from their vendor's cloud, not from your machine, so they cannot reach an instance on a private network and are not supported. Do not open Archant to the internet for them.

## Scheduled synchronisation

Banks sync on their own on the first visit of the day. The first signed-in request after midnight, in `APP_TIMEZONE`, syncs each active connection whose consent has not ended and that no sync has started since that midnight, whatever started it and however it ended. The page answers at once; the sync runs beside it in the server, and the interface shows « Synchronisation en cours » until it ends, then shows the new lines. A tab left open since the day before starts it when it comes back into view. A sync that failed this morning is not retried by the next visit, only by « Synchroniser » or the next day; a connection synced within the hour waits for a request after that hour. There is nothing to set up and nothing to turn off.

A cron is optional, for a host that stays on and should sync before anyone opens Archant. `POST /api/sync` syncs every active bank connection, with `Authorization: Bearer <SYNC_SECRET>`. How it gets called is a per-platform detail: a system cron or a timer on the host, a scheduled GitHub Action calling the route, or whatever the host provides. Without the header, with a wrong secret, or while `SYNC_SECRET` is unset, it answers `401` and reads nothing; with the right secret but no Enable Banking configuration, `503`. Each connection page also has a « Synchroniser » button, which works without the secret and obeys the same one-hour spacing: pressed within an hour of the last sync, the one that follows linking included, it answers « Cette banque a été synchronisée il y a moins d'une heure. Réessayez plus tard. »

```bash
# crontab -e on the host, every morning at 6:
0 6 * * * curl --fail --silent --show-error -X POST -H "Authorization: Bearer $SYNC_SECRET" https://archant.example.org/api/sync
```

The answer names each connection and what happened to it:

```json
{ "data": { "connections": [{ "id": "…", "result": "synced" }] } }
```

`synced` means every linked account synced. `failed` means at least one did not: the others are committed, the connection page shows the error, and the next run retries the failed account from where it last succeeded. `skipped` means a sync ran less than an hour ago or one is still running. `consent_expired` means the consent has ended and nothing was read until it is renewed.

Once a day is enough, whether from the first visit or the cron: banks post transactions in batches, and a PSD2 consent allows a limited number of calls per account per day. The first sync of an account reads three months back; each later one reads from seven days before its last success, so a line the bank books late still arrives, once.

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

None of these will have a file in this repository, by design: adding one must never fork the application code.

- **A plain Node host.** Run `pnpm install --frozen-lockfile`, build the interface with `pnpm app build`, then start `packages/api/src/index.ts` with `WEB_DIST` set to the absolute path of `packages/app/dist` and an absolute `DATABASE_URL`. Put a reverse proxy in front, on the same machine: the server listens on `127.0.0.1` unless `HOST` names another address, and `HOST=0.0.0.0` would let anyone on the network reach sign-in and `/setup` around the proxy.
- **Turso.** Point the database URL at the `libsql://` address and provide its token. The driver is the same one as for a local file. The free plan allows 5 GB and 500 million rows read a month.
- **Render, Fly and the like.** The container, deployed as is. A Render free web service spins down after 15 minutes of inactivity, which delays the first request after a quiet night.
- **Cloudflare Workers with D1.** Does not fit the free plan. A request gets 10 ms of CPU and 50 subrequests, and each D1 query counts as one. D1 has no interactive transaction, where the API opens 46. Past 100,000 rows written in a day, every query is refused for the rest of the day. [ADR 0002](adr/0002-container-reference-target.md) had already set it aside for the cost of a second entrypoint; these limits settle it.
