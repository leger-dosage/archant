---
title: 'Story 15.4: A sign-in that cannot be held hostage'
type: 'feature'
created: '2026-10-01'
status: 'done'
baseline_commit: 'aa84a8ce8325863a8a30e292e203b8140b2797e9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The global ceiling of Story 13.2 refuses every sign-in once 20 failed in 10 minutes, the right password included, so anyone who reaches the sign-in page keeps the owner out (SEC-1). The audit also found a Content-Security-Policy without `default-src`, `img-src`, `form-action` or `frame-src` (SEC-4), a database and backups readable by every local user outside the container (SEC-5), `ENABLE_BANKING_API_URL` accepting plain `http://` to any host (SEC-7), a one-line CSV previewed as millions of columns (SEC-10), and an unexamined `identification_hash` (SEC-11).

**Approach:** OWASP's device cookies: a successful sign-in sets an HMAC-signed cookie naming the user, and the ceiling lets that device through while it has not failed too often itself. Then close the five small findings, each with a test.

## Boundaries & Constraints

**Always:**
- Device cookie, `archant.device`, `HttpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Secure` when `BETTER_AUTH_URL` is https, `Max-Age` 365 days. Value `<userId>.<nonce>.<expiresAt>.<signature>`: a random 128-bit nonce, expiry in epoch ms checked by the server, signature HMAC-SHA256 keyed by `BETTER_AUTH_SECRET` over `device-cookie:<userId>.<nonce>.<expiresAt>`, compared in constant time (`lib/secret.ts`). Signed and verified by one module, `services/device-cookie.ts`, with `node:crypto`; no new dependency.
- Set, with a new nonce, whenever a sign-in creates a session: `/api/auth/sign-in/email` without two-factor, `/two-factor/verify-totp` and `/two-factor/verify-backup-code` with it. Never at the password step that answers `twoFactorRedirect`, which proves only the password.
- `signInCeiling` reserves a global slot as today. Only when `reserveAttempt` returns `null`: it reads the email from a clone of the body (Better Auth still reads the original), and lets the request through without a global slot when the cookie verifies, has not expired, names the user that email belongs to, and its nonce holds fewer than 5 failures in the current 10-minute window. A `401` from Better Auth then counts one failure on that nonce. Otherwise `429 TOO_MANY_REQUESTS`, Better Auth not called.
- Per-device failures live in `sign_in_failures`, keyed `device:<nonce>` beside the row `all`; `reserveAttempt`/`releaseAttempt` take the key and the limit as options. Rows of a window over are deleted when a new device row is written. No migration.
- The per-address limit and Better Auth's own rules apply to an exempt device unchanged.
- CSP: add `default-src 'self'`, `style-src 'self' 'unsafe-inline'` (the chart's `<style>`, sonner and radix inject styles at runtime), `img-src 'self' data: https://enablebanking.com <origin of ENABLE_BANKING_API_URL>`, `form-action 'self'`, `frame-src 'none'`. The policy becomes a function of the configured API URL, so the end-to-end fake's logos load.
- Files: `createDb` creates a missing `file:` database empty with mode `0600` before libSQL opens it, so its `-wal` and `-shm` take the same mode; `copyBeforeMigrating` creates or `chmod`s `backups/` to `0700` and `chmod`s each copy to `0600` before its rename. A file that already exists keeps its mode.
- `ENABLE_BANKING_API_URL` with `http:` is accepted only for `localhost`, `127.0.0.0/8` and `[::1]`; otherwise startup fails with `Invalid environment variables: ENABLE_BANKING_API_URL`.
- CSV: `csvLayout` throws `INVALID_IMPORT_FILE` when its widest record exceeds `MAX_CSV_COLUMNS` (100), the cap the mapping schema already applies.
- `identification_hash` is kept as Enable Banking sends it, as Sure does: its documentation says it is « based on the account number » and stable across sessions and users, and says nothing of a salt, so the audit's condition, an unsalted IBAN hash, is not established. The spec's Design Notes record the quotes; `docs/security-model.md` states it.
- Docs in the same pull request: `docs/security-model.md` (device cookie, `img-src`, file modes, `identification_hash`), `AGENTS.md` where it lists the Playwright projects and describes the Content-Security-Policy.

**Ask First:** a new environment variable; changing Better Auth's rules or response shapes; changing the global ceiling's 20 per 10 minutes.

**Never:** no HMAC rewrite of `identification_hash` and no migration; no exemption from the per-address limit; no `trustDevice` from Better Auth's two-factor plugin (it skips the second factor, a different feature); no cookie cleared on sign-out or password change; no `'unsafe-inline'` for scripts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Known device, ceiling full | valid cookie for the email's user, right password | Better Auth answers, session created, new cookie | — |
| Known device, wrong password | same, wrong password | `401`, one failure on its nonce | — |
| Device failed 5 times | 6th attempt in the window, right password | `429 TOO_MANY_REQUESTS` | — |
| No, forged, expired or other user's cookie | ceiling full | `429`, Better Auth not called | — |
| Ceiling not full | any cookie | as today, cookie not read | — |
| Body not JSON, ceiling full | valid cookie | `429` | — |
| Password step of two-factor | right password, two-factor on | `200` `twoFactorRedirect`, no device cookie | — |
| Wide CSV | first line of 101+ fields | `400 INVALID_IMPORT_FILE` | — |
| Plain-HTTP API URL | `http://example.com` | startup refused, variable named | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/app.ts:81-117` -- `signInCeiling`; `:207-210` `secureHeaders` with `CONTENT_SECURITY_POLICY`; `:233-239` the ceiling and the Better Auth handler, which reads `c.req.raw`: clone it (`c.req.raw.clone().json()`), never `c.req.json()`.
- `packages/api/src/services/sign-in-failures.ts` -- `ROW = "all"` becomes a key option; `SIGN_IN_CEILING` stays the global default.
- `packages/api/src/services/auth.ts:82-124` -- `twoFactor` plugin, no hooks today. Setting the cookie: a Better Auth `hooks.after` reading `ctx.context.newSession`, or Hono after `next()` on the three paths; check the two-factor plugin's own after hook nulls the session of the password step before relying on `newSession` (`better-auth/dist/plugins/two-factor/index.mjs:244-326`).
- `packages/api/src/index.ts:120-122` -- the only place `BETTER_AUTH_SECRET` reaches; add it to `AppDeps` (`app.ts:41-68`) for verification. Tests use `TEST_SECRET` (`testing/auth.ts:16`).
- `packages/api/src/lib/secret.ts` -- constant-time comparison to reuse.
- `packages/api/src/services/auth.spec.ts:111-220` -- the ceiling suite (fake `Date`, 20 failures from many `x-forwarded-for`); `two-factor.spec.ts:56-90` `passwordStep` and its cookie jar.
- `packages/api/src/lib/content-security-policy.ts` -- the policy and its comment; `app.spec.ts:2112-2120` and `packages/app/e2e/serving.spec.ts:40-42` assert the exact header; `e2e/fixtures.ts:518-545` fails a test on any `securitypolicyviolation`.
- Logos: production `https://enablebanking.com/brands/...` (fixtures in `client.spec.ts:151`); end-to-end `${origin}/logo.svg` from `e2e/fake-enable-banking.ts:285-287`, origin set by `e2e/start-api.ts:85`.
- `packages/app/src/routes/_authed.settings.security.tsx:448-449` -- comment saying the QR code is inline SVG because there is no `img-src`; reword, keep the SVG.
- `packages/data/client.ts:19-45` `createDb`; `packages/data/backup.ts:165-174` `mkdir`, `VACUUM INTO`, `rename`; specs `client.spec.ts`, `backup.spec.ts`.
- `packages/api/src/env.ts:140-143` -- `ENABLE_BANKING_API_URL`; `onValidationError` names the issue's path; `env.spec.ts:115-120` accepts `http://localhost:9999`.
- `packages/api/src/connectors/csv/csv.ts:32` `MAX_CSV_COLUMNS`, `:117-131` `csvLayout`, `invalidFile()` `:33-35`.
- `packages/app/playwright.config.ts:27-61` -- projects `setup`, `chromium`, `password`, `two-factor`, `workers: 1`; `e2e/totp.ts` for codes; `clientAddress` fixture `fixtures.ts:487-495`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/device-cookie.spec.ts` -- write first, see it fail: round trip, forged signature, other user, expired, malformed.
- [x] `packages/api/src/services/device-cookie.ts` -- sign, verify, cookie options.
- [x] `packages/api/src/services/sign-in-failures.ts` + spec -- key and limit options, pruning of device rows of a window over.
- [x] `packages/api/src/services/auth.spec.ts` -- every matrix row on the ceiling, written before the change; then `auth.ts`, `app.ts`, `index.ts`.
- [x] `packages/api/src/lib/content-security-policy.ts` + spec, `app.spec.ts`, `e2e/serving.spec.ts` -- new directives; then `app.ts` builds the policy from `ENABLE_BANKING_API_URL`.
- [x] `packages/data/client.spec.ts`, `backup.spec.ts` -- `stat` modes `0600` and `0700` (skipped on Windows); then `client.ts`, `backup.ts`.
- [x] `packages/api/src/env.spec.ts`, `env.ts` -- loopback rule.
- [x] `packages/api/src/connectors/csv/csv.spec.ts`, `csv.ts` -- column cap.
- [x] `packages/app/e2e/sign-in-ceiling.spec.ts` + `playwright.config.ts` -- a fifth project `ceiling` depending on `two-factor`, so a full ceiling blocks nothing after it.
- [x] `docs/security-model.md`, `AGENTS.md`, `_authed.settings.security.tsx` comment -- as in Boundaries.

**Acceptance Criteria:**
- Given the `ceiling` project, when a browser signs in (password and TOTP, the administrator has two-factor on by then), 20 wrong passwords then come from 20 addresses through the API, and the same browser signs out and in again, then it reaches the dashboard; a fresh context with the right password sees « Trop de tentatives ».
- Given any page, when the interface, the bank picker's logos and the dashboard's charts render under `pnpm test:e2e`, then no `securitypolicyviolation` fires.
- Given the pull request, when CI runs, then the seven required checks pass.

## Design Notes

Enable Banking, https://enablebanking.com/docs/api/reference/, `identification_hash`: « Primary account identification hash. It can be used for matching accounts between multiple sessions (even in case the sessions are authorized by different PSUs). » `identification_hashes`: « Identification hash is based on the account number. » The FAQ: « a stable identifier for an account across different sessions and even different users. » Archant only compares it in `completeConnection` (`services/bank-connections.ts:320-460`) to find an account again on renewal; it is never shown, logged or returned. The database already holds names, amounts and labels in clear, so a keyed hash would protect little, and a later change of `ENCRYPTION_KEY` would stop renewals from finding their accounts.

Why the cookie names the user and carries a nonce: the user id keeps a cookie earned by one account from unlocking another's sign-in; the nonce gives each device its own failure count, so someone replaying a stolen cookie spends only that device's exemption, never the owner's other devices'.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked change.

## Implementation Notes

- The device cookie is set by a Hono middleware after Better Auth answers, not by a Better Auth `hooks.after`: Better Auth runs the user's after hook before the plugins' (`api/dispatch.mjs` `getHooks`), so at the password step `newSession` is still set when a user hook reads it. The middleware sets the cookie when the answer is `200` with a `token` and a `user.id`, which the password step of a two-factor sign-in never carries.
- `copyBeforeMigrating` takes the group and other bits off an existing `backups/` (`mode & 0o700`) rather than forcing `0700`: forcing it would also restore owner bits, and `backup.spec.ts` makes `backups/` read-only on purpose to test a failed copy.
- `csvLayout` checks the widest record of the whole file, skipped rows included, since the sample shows them.
- The user lookup by email lives in `services/device-cookie.ts` (`knownDeviceNonce`), so `app.ts` reaches no table.
- Review: patches 1, 2, 3, 4, 5, 7, 8, 12 and 14 of the triage log applied; 13 deferred to `deferred-work.md`. The full gate then passed on the final tree (unit 147, 2,032 and 311 tests; end-to-end 313 in 4.2 min, the `ceiling` project last) with no tracked change.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind | `docs/security-model.md` says `.env.example` warns that rotating `BETTER_AUTH_SECRET` forgets devices; it does not | low | `.env.example:46-47` names sessions and two-factor only | patch |
| 2 | blind | `.env.example` omits the loopback rule of `ENABLE_BANKING_API_URL` | low | `.env.example:89` « Only tests point it elsewhere » | patch |
| 3 | blind | No troubleshooting section for « Trop de tentatives » | low | `docs/troubleshooting.md` has one section per symptom; this one is met under attack | patch |
| 4 | blind | CSP comment says the API origin is added « when it points elsewhere »; it is always added | low | `contentSecurityPolicy` pushes `new URL(bankApiUrl).origin` unconditionally | patch: comment |
| 5 | blind, edge | `chmod` of an existing `backups/` owned by another uid throws `EPERM`, the copy fails and the migration is refused | medium | `chmod` needs ownership, not write access; the error falls into the `BackupError` catch | patch: best effort on the directory |
| 6 | blind | No log line when the ceiling fills or a device passes | low | not in the intent; adds surface | reject |
| 7 | blind | `SignInCeilingOptions.max` comment still says « all addresses together » | low | a `device:` key counts one device | patch |
| 8 | blind, verification | No test with an email typed in another case on a known device | medium | every ceiling test sends `ADMIN.email` in lower case; removing `.toLowerCase()` would pass | patch: test |
| 9 | blind | Revoking a stolen device cookie costs rotating `BETTER_AUTH_SECRET` | low | true, already stated in `docs/security-model.md`; a separate key adds surface | reject |
| 10 | blind, edge | `file:x.db?mode=memory` or `mode=ro` creates an empty file | low | nobody configures those URLs; fix adds a guard | reject |
| 11 | blind | Wide CSV gets the generic `INVALID_IMPORT_FILE` without `params` | low | the intent names that code; a dedicated message adds surface | reject |
| 12 | edge | An unparseable `ENABLE_BANKING_API_URL` throws a bare `TypeError` instead of naming the variable | medium | Zod runs the refine after the failed `url` check; reproduced by the reviewer | patch |
| 13 | edge | A browser that never signs in again, its session kept alive, gets no device cookie, or loses it after a year | medium | the cookie is set on sign-in only, as the intent says; renewing it from a session needs a new path | defer |
| 14 | edge | `VACUUM INTO` writes the `.partial` copy under the umask before the `chmod` | low | the copy is world-readable while written; pre-creating it empty at `0600` is a direct fix | patch |
| 15 | edge | One wide line anywhere, not only the first, refuses the file | low | such a file is no statement either; Implementation Notes record the choice | reject |
| 16 | verification | `knownDeviceNonce` does not trim the email | false | Better Auth's sign-in lowercases without trimming (`sign-in.mjs:317`), so both sides agree | reject |
