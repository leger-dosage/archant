# Epic 13 Context: Ready for real bank data

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Let the owner host Archant off their laptop, connect a real bank through Enable Banking's production environment, and upgrade without risking the data. A security audit on 2026-09-26 found one high, three medium and four low findings. The high one: `/api/setup` creates the administrator for whoever calls it first, and a fresh domain's certificate appears in public certificate transparency logs that bots scan within minutes. Stories 13.1 to 13.4 fix every finding. Stories 13.5 and 13.6 make an upgrade a pull and a restart that cannot lose data. Story 13.7 writes the hosting guide. The owner chose a machine at home reachable only through Tailscale; nothing listens on the internet, but a tailnet shrinks the attack surface and does not replace a sign-in that holds on its own. Where Sure settles a question, the story follows Sure: TOTP with backup codes optional per user (`MfaController`), images on GHCR for amd64 and arm64 on version tags (`publish.yml`), migrations at boot (`bin/docker-entrypoint`).

## Stories

- Story 13.1: The first administrator needs a setup token
- Story 13.2: A request cannot exhaust the server
- Story 13.3: The container exposes nothing it does not need
- Story 13.4: Two-factor sign-in
- Story 13.5: Versioned images
- Story 13.6: A copy before every migration
- Story 13.7: Hosting at home behind Tailscale

## Requirements & Constraints

- Creating the first administrator requires a setup token only someone with server access can read. It lives in memory, is logged once at `info` only when the database has no user, is compared in constant time, and a wrong or missing token answers `403` with a closed error code and creates nothing. Wrong tokens are rate-limited per address like sign-in.
- Every `/api` route has a body limit: 64 KB, refused with `413` before reading, signed in or not; the file upload keeps its 5 MB. No parser runs in exponential time: a 40-character OFX tag name answers within a second, parsed or refused. Sign-in is limited per address and overall across addresses on `/sign-in/email`, with counts stored in the database so they survive a restart.
- The default deployment exposes nothing it does not need: port published on `127.0.0.1` only, read-only root filesystem with `tmpfs` on `/tmp`, every Linux capability dropped, `no-new-privileges`, only `/data` writable, and a Content-Security-Policy on every page (`script-src 'self'` plus the theme script's hash, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`). A plain `http://` `BETTER_AUTH_URL` on a non-loopback, non-private address logs a warning.
- Two-factor sign-in is optional per user: TOTP plus ten single-use backup codes shown once. Turning it on, off, or regenerating codes asks for the password. Server-side `reset-password` also turns it off and says so; the server shell is the recovery path.
- Every `vX.Y.Z` tag publishes a pinnable image for amd64 and arm64; the interface shows the running version; `GET /api/health` never exposes it.
- Before applying a pending migration, the server copies the database so a failed upgrade can go back. It refuses to migrate if the copy fails. No other backup is automated: scheduled and off-site backups are deferred by the owner, the manual `VACUUM INTO` recipe stays the answer.
- Provider tokens and keys stay encrypted at rest, never logged, never returned. Logs never carry an amount tied to an identity, an IBAN or a token; the setup token is the one secret deliberately logged, once.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest, the CI `image` job for container behaviour. No test reaches the network. A new dependency is justified in the pull request.

## Technical Decisions

- Better Auth owns sessions; do not hand-roll or weaken its defaults. It runs with the Drizzle adapter (`usePlural: true`), email and password, public sign-up disabled, the `admin` plugin, and credentials in `auth_accounts`. Two-factor uses its `twoFactor` plugin; its tables join `packages/data/schema/auth.ts`, which is maintained by hand. Its sign-in rate-limit counts move to the database.
- `/api/setup` claims the `setup_completed_at` settings row atomically, then calls `auth.api.createUser`; once setup is done it refuses before reading the body, and `GET /api/setup` reveals only whether setup is open. One middleware guards `/api` except `/api/health`, `/api/auth/*`, `/api/setup` and `/api/sync`. `/api/auth/*` is Better Auth's handler, outside the envelope and outside `AppType`. Mutating routes use Hono's `csrf()`.
- The API answers `{ data }` or `{ error: { code, message, fields?, params? } }`. New codes join the closed `AppError` union in `packages/api/src/lib/errors.ts`; the interface translates `errors.<CODE>`. `app.onError` maps anything else to `INTERNAL_ERROR` 500 without stack or payload.
- Logs go through one pino instance and carry only ids, counts, durations and error codes; `redact` covers `req.headers.authorization` and `req.headers.cookie`. A test fails on an amount or IBAN pattern in serialised logs and errors.
- Environment goes through `validateEnv(runtimeEnv)` in `packages/api/src/env.ts`; every new variable is listed in `.env.example` with what degrades without it. `ARCHANT_URL` is the container's public address, passed as `BETTER_AUTH_URL`; `TRUSTED_PROXIES` decides whose `X-Forwarded-For` is believed, which the per-address limits depend on.
- `ofx-js`'s `sgml2Xml` regular expression is exponential on long tag names; patch it or check input before it reaches it.
- The container is the reference target: one image serving the built interface and the API on one port, a SQLite file on a volume, migrations applied before listening through `drizzle-orm/libsql/migrator`. `index.ts` is the only entrypoint; no code branches on the platform. Other targets are documentation only.
- Releases: the version comes from the tag, never a bump commit; images go to `ghcr.io/leger-dosage/archant` as `X.Y.Z`, `X.Y` and `latest`, after the verification gate, with a GitHub Release of generated notes. `docker-compose.yml` runs `${ARCHANT_VERSION:-latest}` and still builds from source for contributors; the CI `image` job keeps testing the pull request's build. `actionlint` checks the workflow.
- The pre-migration copy uses `VACUUM INTO` into `backups/` beside the database, named after version and time, keeping the five most recent. No pending migration or a `libsql://` database copies nothing and logs it.
- `ENCRYPTION_KEY` loss means reconnecting every bank; `BETTER_AUTH_SECRET` loss signs out every session.

## UX & Interaction Patterns

- French, vouvoiement, infinitive-verb buttons, no exclamation marks. An error says what happened and what to do.
- `/setup` stays a single card, « Créer le compte administrateur », now with a « Jeton de configuration » field beside email and password; no other route is reachable before setup.
- Two-factor lives in « Réglages › Sécurité »: password confirmation, QR code plus the secret, activation only after a valid code, then the backup codes shown once. Sign-in gains a second step accepting a code or a backup code.
- « Réglages » shows the running version, linked to its GitHub Release. URLs stay English.

## Cross-Story Dependencies

- Stories 13.1 to 13.4 ship in any order. Story 13.6 needs 13.5's version number. Story 13.7 comes last and documents all of them.
- Story 13.1 changes the e2e `setup` Playwright project, which must read the token the test server prints. Story 13.2's database-backed rate limit must keep the e2e `clientAddress` per-test buckets working, and API specs still sign in once per file.
- Story 13.3's CSP must let the interface work in the e2e run; its loopback-only port replaces the loopback override in `docs/deployment.md`, and reaching the machine from the home network becomes a documented `compose.override.yml`.
- Story 13.4's `reset-password` change extends Epic 3's server-side reset.
- Story 13.7 writes `docs/hosting.md` and updates `docs/deployment.md`: production registration in « Connecting a bank » (restricted mode, « Activate by linking accounts », `ts.net` redirect, which the owner verifies against a sandbox application before the guide states it), the reason Cloudflare Workers with D1 does not fit, and the `#connecting-a-bank` anchor, which must survive.
