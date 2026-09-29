# Epic 13 Context: Ready for real bank data

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let the owner host Archant off their laptop, connect a real bank through Enable Banking's production environment, and upgrade without risking the data. A security audit on 2026-09-26 found one high, three medium and four low findings. The high one: `/api/setup` creates the administrator for whoever calls it first, and a fresh domain's certificate appears in public certificate transparency logs that bots scan within minutes. Stories 13.1 to 13.4 fix every finding. Stories 13.5 and 13.6 make an upgrade a pull and a restart that cannot lose data. Story 13.7 writes the hosting guide: a machine at home reachable only through Tailscale; a tailnet shrinks the attack surface and does not replace a sign-in that holds on its own. The owner then followed the guide on a Mac that sleeps, and Stories 13.8 to 13.10 fix what came out of it: a daily cron misses every run the machine sleeps through, the server listens on every interface outside the container, and the first run ended in a hidden setup token and a raw `INVALID_ORIGIN`. The owner confirmed that Enable Banking accepts the `ts.net` redirect URL on a production application, so the guide can state it. Choosing a bank showed one more problem: « Banques disponibles » lists every bank of the country on the page, above « Banques connectées », and Story 13.11 moves it into a dialog. Where Sure settles a question, the story follows Sure: TOTP with backup codes optional per user (`MfaController`), images on GHCR for amd64 and arm64 on version tags (`publish.yml`), migrations at boot (`bin/docker-entrypoint`), a sync on the first page of the day (`AutoSync`), a bank picker in a dialog (`enable_banking_items/select_bank`).

## Stories

- Story 13.1: The first administrator needs a setup token
- Story 13.2: A request cannot exhaust the server
- Story 13.3: The container exposes nothing it does not need
- Story 13.4: Two-factor sign-in
- Story 13.5: Versioned images
- Story 13.6: A copy before every migration
- Story 13.7: Hosting at home behind Tailscale
- Story 13.8: Sync on the first visit of the day
- Story 13.9: The server listens on loopback unless told otherwise
- Story 13.10: A first run that says what to do
- Story 13.11: Pick a bank in a dialog, as in Sure

## Requirements & Constraints

- Creating the first administrator requires a setup token only someone with server access can read. It lives in memory, is logged once at `info` only when the database has no user, is compared in constant time, and a wrong or missing token answers `403` with a closed error code and creates nothing. Wrong tokens are rate-limited per address like sign-in.
- Every `/api` route has a body limit: 64 KB, refused with `413` before reading, signed in or not; the file upload keeps its 5 MB. No parser runs in exponential time: a 40-character OFX tag name answers within a second, parsed or refused. Sign-in is limited per address and overall across addresses on `/sign-in/email`, with counts stored in the database so they survive a restart.
- The default deployment exposes nothing it does not need: port published on `127.0.0.1` only, read-only root filesystem with `tmpfs` on `/tmp`, every Linux capability dropped, `no-new-privileges`, only `/data` writable, and a Content-Security-Policy on every page. A plain `http://` `BETTER_AUTH_URL` on a non-loopback, non-private address logs a warning. Outside a container, the server listens on `127.0.0.1` unless `HOST` says otherwise.
- Two-factor sign-in is optional per user: TOTP plus ten single-use backup codes shown once. Turning it on, off, or regenerating codes asks for the password. Server-side `reset-password` also turns it off and says so.
- Every `vX.Y.Z` tag publishes a pinnable image for amd64 and arm64; the interface shows the running version; `GET /api/health` never exposes it.
- Before applying a pending migration, the server copies the database and refuses to migrate if the copy fails. No other backup is automated; the manual `VACUUM INTO` recipe stays the answer.
- A sync also runs on the first authenticated request of the day, in `APP_TIMEZONE`, for each active connection with no attempt since the start of that day, without making the request wait; a second request starts nothing more. A failed attempt, an ended consent or a running sync means no automatic sync until the next day; « Synchroniser » still works under the one-hour spacing. `POST /api/sync` keeps working and becomes optional, for a host that stays on.
- A browser on an address other than `BETTER_AUTH_URL` gets a French message telling it to set `ARCHANT_URL` to the address in the address bar, never `INVALID_ORIGIN` or a bare « Forbidden »; the server logs one `warn` naming the received and expected origins.
- The docs state that Enable Banking accepts the `ts.net` redirect URL for a production application, and that an empty `ARCHANT_URL` refuses every sign-in from the `ts.net` address.
- Choosing a bank keeps the consent flow exactly as before; only where the list lives changes.
- Provider tokens and keys stay encrypted at rest, never logged, never returned. Logs never carry an amount tied to an identity, an IBAN or a token; the setup token is the one secret deliberately logged, once.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest, the CI `image` job for container behaviour. No test reaches the network; the clock and Enable Banking are mocked. A new dependency is justified in the pull request.

## Technical Decisions

- Better Auth owns sessions; do not hand-roll or weaken its defaults. It runs with the Drizzle adapter (`usePlural: true`), email and password, public sign-up disabled, the `admin` plugin, and credentials in `auth_accounts`. Two-factor uses its `twoFactor` plugin; its tables join `packages/data/schema/auth.ts`, maintained by hand. Its sign-in rate-limit counts move to the database.
- `/api/setup` claims the `setup_completed_at` settings row atomically, then calls `auth.api.createUser`; once setup is done it refuses before reading the body. One middleware guards `/api` except `/api/health`, `/api/auth/*`, `/api/setup` and `/api/sync`. `/api/auth/*` is Better Auth's handler, outside the envelope and outside `AppType`. Mutating routes use Hono's `csrf()`.
- The API answers `{ data }` or `{ error: { code, message, fields?, params? } }`. New codes join the closed `AppError` union in `packages/api/src/lib/errors.ts`; the interface translates `errors.<CODE>`. `app.onError` maps anything else to `INTERNAL_ERROR` 500 without stack or payload.
- Logs go through one pino instance and carry only ids, counts, durations and error codes.
- Environment goes through `validateEnv(runtimeEnv)` in `packages/api/src/env.ts`; every new variable, `HOST` included, is listed in `.env.example` with its default and what degrades or is exposed. `ARCHANT_URL` is the container's public address, passed as `BETTER_AUTH_URL`; `TRUSTED_PROXIES` decides whose `X-Forwarded-For` is believed. The `Dockerfile` sets `HOST=0.0.0.0`.
- The whole application is one process with no queue. A sync runs inside its request, except the first-visit sync, which runs beside the request in the same process. It reuses `services/sync.ts` and the connection lease (`bank_connections.sync_started_at`, 10 minutes), so a concurrent start is refused rather than doubled. "Today" is computed in `APP_TIMEZONE`.
- `ofx-js`'s `sgml2Xml` regular expression is exponential on long tag names; patch it or check input before it reaches it.
- The container is the reference target: one image, one port, a SQLite file on a volume, migrations applied before listening. `index.ts` is the only entrypoint; no code branches on the platform.
- Releases: the version comes from the tag, never a bump commit; images go to `ghcr.io/leger-dosage/archant` as `X.Y.Z`, `X.Y` and `latest`. `docker-compose.yml` runs `${ARCHANT_VERSION:-latest}` and still builds from source; the CI `image` job tests the pull request's build.
- The pre-migration copy uses `VACUUM INTO` into `backups/` beside the database, keeping the five most recent. `ENCRYPTION_KEY` loss means reconnecting every bank; `BETTER_AUTH_SECRET` loss signs out every session.

## UX & Interaction Patterns

- French, vouvoiement, infinitive-verb buttons, no exclamation marks. An error says what happened and what to do.
- `/setup` stays a single card with a « Jeton de configuration » field; its hint says where to read the token: `docker compose logs archant` with the container, the terminal running the server otherwise.
- Two-factor lives in « Réglages › Sécurité »; sign-in gains a second step accepting a code or a backup code. « Réglages » shows the running version, linked to its GitHub Release. URLs stay English.
- « Réglages › Banques » shows « Banques connectées » first; a button opens the bank picker dialog. « Rechercher une banque » has the focus, the list scrolls inside the dialog at a bounded height, each bank shows its name and BIC, an empty search says no bank matches, and Escape or « Annuler » closes it with nothing started. It works with the keyboard alone.
- A first-visit sync shows as running in the interface, then accounts and transactions refetch when it ends. A page left open since the day before starts it on focus, since TanStack Query refetches on focus.

## Cross-Story Dependencies

- Stories 13.1 to 13.4 ship in any order. Story 13.6 needs 13.5's version number. Story 13.7 documents 13.1 to 13.6. Stories 13.8 to 13.11 ship in any order after 13.7.
- Story 13.1 changes the e2e `setup` Playwright project, which reads the token the test server prints. Story 13.2's database-backed rate limit must keep the e2e `clientAddress` per-test buckets working. Story 13.3's CSP must let the interface work in the e2e run.
- Story 13.4's `reset-password` change extends Epic 3's server-side reset.
- Story 13.7 writes `docs/hosting.md` and updates `docs/deployment.md`; the `#connecting-a-bank` anchor must survive.
- Story 13.8 builds on Epic 10's sync service, lease and one-hour spacing, and rewrites « Scheduled synchronisation » in `docs/deployment.md` and step 7 of `docs/hosting.md` to present `POST /api/sync` as optional.
- Story 13.9 must keep the Vite proxy, `pnpm test:e2e` and the CI `image` job reaching the server; it updates the « Variables » table and « A plain Node host » in `docs/deployment.md`.
- Story 13.10 extends Story 13.1's setup page and adds `docker compose logs archant | grep 'Setup is open'` to `docs/deployment.md` after the first `up`, since `--wait` shows no log. It also corrects the `ts.net` redirect statements in `docs/hosting.md` and « Connecting a bank » of `docs/deployment.md`, and step 5 of `docs/hosting.md`.
- Story 13.11 reworks Epic 10's bank selection on « Réglages › Banques » and leaves its consent flow untouched.
