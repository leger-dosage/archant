# Troubleshooting

One section per symptom, each with the exact line or message you see and the fix. The commands assume the container of [docs/deployment.md](deployment.md), run from the directory holding `docker-compose.yml`. If your symptom is not here, open a [bug report](https://github.com/leger-dosage/archant/issues/new/choose); a security flaw goes through [SECURITY.md](../SECURITY.md) instead.

## The image pull is refused with 401 or `denied`

`docker compose pull` or `docker compose up` stops with an error from `ghcr.io` naming `401 Unauthorized`, `unauthorized` or `denied`.

The image pulls anonymously, so no login is needed. Two causes remain:

- Docker still holds credentials for `ghcr.io` from an earlier `docker login`, and the token behind them expired or lost its access. Docker sends them anyway, and the registry refuses them instead of falling back to an anonymous pull. Remove them, then pull again:

  ```bash
  docker logout ghcr.io
  docker compose pull
  ```

- The image name or tag is mistyped. The image is `ghcr.io/leger-dosage/archant`, and `ARCHANT_VERSION` in `.env` takes a release without its `v`, such as `0.2.1` or `0.2`, never `v0.2.1`. The [releases page](https://github.com/leger-dosage/archant/releases) lists the ones that exist.

## « Archant est configuré pour une autre adresse »

Setup, sign-in or any change shows:

> Archant est configuré pour une autre adresse. Donnez à ARCHANT_URL l'adresse affichée dans la barre d'adresse, puis redémarrez Archant.

The API answered `ORIGIN_MISMATCH`, and the server logged `request from another origin refused` with the origin it received and the one it expected. The server refuses every write from an origin other than its own, to stop another site from acting through your browser.

`ARCHANT_URL`, which `docker-compose.yml` passes to the server as `BETTER_AUTH_URL`, must equal what the address bar shows, scheme and port included: `https://archant.example.org`, not `http://archant.example.org` nor `https://archant.example.org:443/`. Left empty, it means `http://localhost:8787`. Set it in `.env`, then restart:

```bash
docker compose up --detach --wait
```

From a checkout run with `pnpm`, the variable is `BETTER_AUTH_URL` in `.env`, `http://localhost:5173` for the Vite dev server; restart `pnpm api start:dev`.

## Enable Banking refuses the return address

Connecting a bank, or saving the Enable Banking credentials, shows:

> Enable Banking refuse l'adresse de retour. Enregistrez https://archant.example.org/settings/banks/callback dans les réglages de votre application Enable Banking, puis réessayez.

The API answered `BANK_REDIRECT_NOT_ALLOWED`. The bank sends the browser back to Archant's address followed by `/settings/banks/callback`, and Enable Banking only allows the redirect URLs registered on the application. Add the exact URL the message names to the application's redirect URLs in the [Enable Banking control panel](https://enablebanking.com/cp/applications), then try again. If the URL it names is not the one in your address bar, fix `ARCHANT_URL` first, as in the section above. [Register the application](deployment.md#1-register-the-application) lists the URL for each setup.

## The setup token is lost

`/setup` asks for a setup token, and the log line that printed it is gone, or the page says:

> Ce jeton de configuration est incorrect. Copiez celui affiché dans les journaux du serveur à son dernier démarrage.

While the database has no user, the server prints a new token at every start, and only the latest one works. Restart the server, then read the last matching line:

```bash
docker compose restart archant
docker compose logs archant | grep 'Setup is open'
```

The line reads `Setup is open. Open /setup and enter the setup token <token>. A new one is printed at every start.` Take the token from the last line: the earlier ones belong to earlier starts. From a checkout run with `pnpm`, restart `pnpm api start:dev` and read the same line in its terminal. Once the administrator exists, no token is printed any more.

## « Consentement expiré »

A bank connection shows « Consentement expiré », and the banner says:

> Le consentement de Ma Banque a expiré. La synchronisation est arrêtée.

A bank grants access for 90 days at most, and Archant asks for no more, so nothing syncs once it ends. A sync attempted anyway answers `CONSENT_EXPIRED`. Renew it: « Reconnecter » in the banner, or « Renouveler le consentement » on the connection's page in « Réglages » › « Banques ». The bank asks for your consent again; nothing is deleted, and the next sync picks up where the last one stopped. The banner warns 14 days before the end, so it can be renewed without a gap.

## The server restarts in a loop after an upgrade

After an upgrade, `docker compose up --wait` never reports healthy, and `docker compose logs archant` repeats a `fatal` line:

```text
The database could not be copied before migrating, so it was not migrated. Free disk space or fix the permissions of the backups directory beside the database, then start again.
```

Before it applies a migration, the server copies the database to `/data/backups` and refuses to migrate without that copy. The line carries the error `code` and the `directory`; a full disk is the usual cause. The server exits, and `restart: unless-stopped` in `docker-compose.yml` starts it again, which fails the same way, so it loops. The database itself is untouched.

Stop the loop first, then look at what the volume holds:

```bash
docker compose stop
docker compose run --rm --no-deps archant sh -c 'df -h /data && ls -l /data /data/backups'
```

Free space on the disk that holds Docker's volumes, then start again with `docker compose up --detach --wait`. The server keeps the five most recent copies, each the size of the database, so leave room for five copies of it. Deleting older copies from `/data/backups` frees space too; keep the most recent one, your way back to the previous release, as [Upgrading](deployment.md#upgrading) explains. A permission error names the same directory: the volume must be writable by the container's user, `node`.
