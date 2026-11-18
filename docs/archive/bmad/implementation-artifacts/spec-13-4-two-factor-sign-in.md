---
title: 'Story 13.4: Two-factor sign-in'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: '8cd4ba2813aa7eecb71c623162c6b104f024229a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A leaked password alone opens the household's bank history: sign-in has one factor.

**Approach:** Add Better Auth's `twoFactor` plugin (TOTP plus backup codes), optional per user, turned on and managed in « Réglages › Sécurité »; sign-in gains a second step when it is on; `reset-password` turns it off as the recovery path.

## Boundaries & Constraints

**Always:**
- Server: `twoFactor({ issuer: "Archant" })` in `createAuth`, every other option at its 1.7.6 default: 6-digit, 30-second TOTP; ten backup codes `xxxxx-xxxxx`, stored encrypted; 5 attempts per challenge; account lockout after 10 failures for 15 minutes; its own rate limit of 3 requests per 10 seconds per address on `/two-factor/*`, stored in `rate_limits` like sign-in's. The issuer is explicit because Better Auth otherwise names the app « Better Auth » in the authenticator.
- Schema: `packages/data/schema/auth.ts` gains `users.two_factor_enabled` (boolean, default false) and a `two_factors` table (`id`, `secret`, `backup_codes`, `user_id` FK cascade and indexed, `verified` default true, `failed_verification_count` default 0, `locked_until` `timestamp_ms`), passed to the adapter as `twoFactors`. One migration, `0034_add_two_factor`, generated with `pnpm data generate`.
- Turning on: password → `twoFactor.enable` → QR code of `totpURI` plus the base32 secret read from it, for manual entry → a code → `twoFactor.verifyTotp` → only then `twoFactorEnabled` is true and the ten codes from `enable` are shown, once. Abandoning before the code leaves it off. The QR code is an inline SVG from `qrcode.react` (`QRCodeSVG`): the CSP of Story 13.3 sets no `img-src`, and an SVG needs none.
- Turning off and regenerating codes each ask for the password (`twoFactor.disable`, `twoFactor.generateBackupCodes`). Regenerating invalidates the old codes and shows the new ten once.
- Sign-in: `signIn.email` answering `twoFactorRedirect: true` shows a second step on the same `/sign-in` page, one field « Code de vérification » accepting either a TOTP code or a backup code: six digits go to `verifyTotp`, anything else to `verifyBackupCode`. Success navigates as today. Wrong code → field error. Expired or exhausted challenge (`INVALID_TWO_FACTOR_COOKIE`, `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`) → back to the password step with a message. `429` → the existing « trop de tentatives » message. No « trust this device ».
- The security page reads `twoFactorEnabled` from the session and shows it as on or off; after any change it invalidates `queryKeys.session`.
- `reset-password <email>` also deletes the user's `two_factors` row and sets `two_factor_enabled` false. When it was on, it prints a second line: « La double authentification a été désactivée. ».
- French copy: vouvoiement, infinitive buttons, no exclamation mark. Section « Double authentification »; backup codes are « codes de secours ».
- Nothing new in logs: no code, secret, URI or backup code.

**Never:** no trust-device cookie, no email or SMS code, no passkey, no admin endpoint to reset someone else's second factor, no change to Story 13.2's global sign-in ceiling, no new environment variable, no hand-rolled TOTP in application code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start enabling | right password | QR code and secret, still off | wrong password → field error, nothing written |
| Confirm enabling | valid TOTP | on, ten codes shown once | wrong code → field error, still off |
| Sign in, 2FA on | right password | second step, no session yet | — |
| Second step, TOTP | valid code | signed in | wrong → field error, no session |
| Second step, backup code | unused code | signed in; that code refused next time | used code → field error |
| Challenge exhausted | 6th attempt, or after 10 min | back to password step | message asks to sign in again |
| Turn off | password | off; next sign-in has one step | wrong password → field error, stays on |
| Regenerate codes | password | ten new codes shown once, old ones refused | wrong password → field error |
| `reset-password` | 2FA on | password changed, 2FA off, second line printed | — |
| `reset-password` | 2FA off | as today, one line | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/auth.ts:59-118` -- `createAuth`; add the plugin to `plugins` (`:74`) and `twoFactors` to the adapter `schema` (`:63-70`, mind the `auth_accountss` quirk comment). Rate-limit and session config unchanged.
- `packages/data/schema/auth.ts` -- hand-maintained Better Auth tables; the drizzle adapter's `findDrizzleSchemaProblems` fails at start on a missing column, which is the check the schema is right.
- `packages/data/drizzle/` -- migrations; last is `0033_add_sign_in_limits`.
- `packages/api/src/services/password.ts:30-55` -- `resetPassword` through `auth.$context.internalAdapter`; return `{ userId, twoFactorDisabled }`. `services/password.spec.ts:46-97` -- its tests.
- `packages/api/src/cli/reset-password.ts:20-80` -- `MESSAGES`, success line on stdout.
- `packages/api/src/testing/auth.ts:141-155` -- `setUpAndSignIn` expects a one-step sign-in; unchanged, specs that turn 2FA on use their own app. TOTP in specs: `auth.api.generateTOTP({ body: { secret } })` with the secret from `totpURI`; `@better-auth/utils` is not a direct dependency, do not import it.
- `packages/api/src/services/auth.spec.ts` -- existing sign-in rate-limit specs; the new two-factor specs sit in `services/two-factor.spec.ts`.
- `packages/app/src/lib/auth-client.ts:10-13` -- add `twoFactorClient()` without `onTwoFactorRedirect`; the page handles the answer.
- `packages/app/src/routes/sign-in.tsx:83-99` -- `error === null` currently means signed in; branch on `data.twoFactorRedirect` first.
- `packages/app/src/routes/_authed.settings.security.tsx:131-144` -- page body; add a `TwoFactorSection` beside `ProfileSection` and `PasswordSection`, reusing `PasswordSection`'s error handling (`INVALID_PASSWORD` field error, 401 to sign-in, 429 toast).
- `packages/app/src/locales/fr.json` -- `security.*` (`:1117`), `signIn.*` (`:1139`); new `twoFactor.*`.
- `packages/app/playwright.config.ts:23-47`, `e2e/password.spec.ts` -- projects run `setup` → `chromium` → `password`; enabling 2FA rotates the session and would strand the saved `ADMIN_STATE`.
- `packages/app/e2e/settings.ts` -- `ADMIN`; move `NEW_PASSWORD` here from `password.spec.ts`.
- `docs/deployment.md:207-216` -- « Passwords »; `.env.example` -- `BETTER_AUTH_SECRET` comment.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/auth.ts`, `packages/data/drizzle/0034_add_two_factor.sql` -- columns and table, then `pnpm data generate --name add_two_factor`.
- [x] `packages/api/src/services/two-factor.spec.ts` -- failing specs first for the API rows of the matrix: enable leaves it off, verify turns it on, sign-in returns `twoFactorRedirect` without a session cookie, TOTP and backup code sign in, a used backup code is refused, disable and regenerate refuse a wrong password, regenerated codes replace the old ones, no code or secret in captured logs.
- [x] `packages/api/src/services/auth.ts` -- the plugin and adapter key.
- [x] `packages/api/src/services/password.spec.ts`, `password.ts`, `cli/reset-password.ts` -- reset turns 2FA off and reports it; the CLI prints the second line.
- [x] `packages/app/e2e/two-factor.spec.ts`, `playwright.config.ts`, `settings.ts`, `password.spec.ts` -- a `two-factor` project after `password`, no retries, signing in with `NEW_PASSWORD`: turn on with a wrong then right code, codes shown once, sign out, sign in with TOTP, then with a backup code, the same backup code refused, regenerate, turn off, one-step sign-in. TOTP from `totpURI` through a 15-line RFC 6238 helper on `node:crypto` in `e2e/totp.ts`, test-only.
- [x] `packages/app/src/lib/auth-client.ts`, `routes/sign-in.tsx` -- the second step.
- [x] `packages/app/package.json` -- `qrcode.react` 4.2.0.
- [x] `packages/app/src/routes/_authed.settings.security.tsx`, `locales/fr.json` -- `TwoFactorSection` and its strings.
- [x] `docs/deployment.md`, `.env.example` -- `reset-password` also turns 2FA off; losing `BETTER_AUTH_SECRET` makes the stored secrets unreadable, recovered by `reset-password`.
- [x] `AGENTS.md` « Testing » -- the fourth Playwright project and why it runs last.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for what the interface shows, Vitest for the rest.
- Given a fresh database, when the server starts on the new migration, then the adapter reports no schema problem.

## Implementation Notes

- `services/auth.spec.ts` « accepts a sign-in once the 10-minute window is over » failed on the baseline once the wall clock passed 09:50 UTC: the template's sign-in opens a ceiling window on the real clock, which the fake clock at 10:00 UTC then found still open. Its `beforeEach` now empties `sign_in_failures`. Shipped as its own commit.
- API specs compute codes with `auth.api.generateTOTP` from the secret decoded out of `totpURI`; the e2e project uses `e2e/totp.ts`, checked against the RFC 6238 test vectors.
- Codes lose every inner space before the six-digit test, so a TOTP pasted as « 123 456 » reaches `verifyTotp`.
- With two-factor on, both actions of the section are plain buttons and Enter in the password field does nothing: neither replacing the codes nor turning it off may happen by accident.
- `resetPassword` turns the flag off before deleting the row, so a failure in between leaves one-step sign-in, never a second step nothing can pass.
- `docs/sure-parity.md`'s « Two-factor codes, passkeys » row now states the new parity.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `resetPassword` deletes the secret before turning the flag off, without a transaction (blind, edge) | medium | A failed second write leaves `twoFactorEnabled` true with no row: sign-in asks a code nothing can verify until the command runs again. Reordering is direct. | patch |
| A TOTP pasted with its inner space goes to `verifyBackupCode` (blind, edge) | low | Apps display « 123 456 »; only `trim()` runs, so the code is refused and spends one of the five attempts. One regular expression. | patch |
| Enter in the password field regenerates the backup codes when two-factor is on (blind) | medium | The regenerate button is the form's submit; typing the password to turn it off and pressing Enter replaces the ten codes without warning. | patch |
| The code step's handling of an exhausted challenge and of a 429 has no interface test (verification) | medium | Pre-verified gap: the e2e covers only the dropped cookie; the matrix row « 6th attempt » and the 429 rule could break silently. | patch |
| Rate-limit spec asserts only the fourth status (blind) | low | A limit of one or two requests would still pass. Direct assertion change. | patch |
| `Jar` constructor splits on every `=` (blind) | low | Test helper only; `store()` already uses `indexOf`. Direct correction. | patch |
| `reset-password`'s second line has no test (verification) | low | The script needs a real terminal; the flag it prints is tested at `resetPassword`. | defer |
| The server accepts `trustDevice: true` although the interface never sends it (blind) | low | The cookie only spares the second factor to a device that already passed both; the password is still asked. Blocking it adds a guard on Better Auth's routes. | rejected |
| `resetPassword` keeps trust-device rows (blind) | low | None exist: the interface never sends `trustDevice`, and a device holding one still needs the new password. | rejected |
| No way back from the code step but a reload (blind) | low | A reload returns to the password step; Sure's verify page has no back link either. | rejected |
| Lockout and `BETTER_AUTH_SECRET` rotation are untested (blind) | low | Both are the plugin's behaviour, unchanged by this story; the interface handles the lockout's 429 with the tested branch. | rejected |
| Turning two-factor on keeps the other sessions (blind) | low | Same as Sure; the password change already revokes other sessions for a suspected intrusion. | rejected |
| `two_factor_enabled` is nullable (blind) | false | Matches `banned` and every other Better Auth boolean in `auth.ts`; `=== true` is the file's pattern, not a defect. | rejected |
| The `auth.spec.ts` clock fix is unrelated (blind) | low | True, and the test fails on the baseline at this time of day; it ships as its own commit. | rejected |
| `TOTP_NOT_ENABLED` after a reset during a pending challenge (edge) | low | Needs `reset-password` run within the ten minutes of an open challenge; the next reload recovers. Adds a branch. | rejected |
| `twoFactorRedirect` with no method (edge) | false | Only a user with the flag on and no verified row, which neither the plugin nor `resetPassword` (now reordered) leaves. | rejected |
| Stale `enabled` gives `TOTP_ALREADY_ENABLED` or `TWO_FACTOR_NOT_ENABLED` (edge) | low | Two tabs changing it at once; a reload fixes the section. Adds branches. | rejected |
| `enable` answering a method other than `totp` (edge) | false | No `sendOTP` is configured; the plugin cannot answer `otp`. | rejected |
| 409 on concurrent backup-code use (edge) | low | One user typing one code; the generic toast then a retry works. | rejected |
| Standards review: `two-factor.spec.ts` has no `two-factor.ts` beside it | low | It tests the plugin `auth.ts` configures and `resetPassword` together; appended to `auth.spec.ts` it would double that file for one feature. | rejected |
| Standards review: `two-factor.spec.ts` signs in per test | false | Signing in is what these tests exercise; each request carries its own address, so no rate-limit bucket is shared, which is the rule's reason. | rejected |
| Standards review: `handleFailure` repeats `PasswordSection`'s failure cascade | low | Sharing it means editing `PasswordSection`, outside the story, for four branches. | rejected |
| Standards review: base32 decoding and `wrong()` repeated between the API spec and the e2e helper | low | Two packages with no shared test module; ten lines each. | rejected |
| Standards review: `twoFactorDisabled` local means « was on »; `signedIn` names an action | low | Direct renames: `wasEnabled`, `completeSignIn`. | patch |
| Spec review: regenerating codes does not invalidate the session | false | The flag does not change on regeneration; nothing the session carries is stale. | rejected |
| Spec review: the `auth.spec.ts` fix sits in the same diff | low | Committed on its own before the story. | patch |

## Design Notes

Sure asks for no password to turn two-factor off and cannot regenerate backup codes; the epic asks for both, and Better Auth's endpoints already require the password, so Archant follows the epic. Sure shows eight codes; Better Auth's default and the epic say ten.

The e2e project goes last and signs in with the password the `password` project sets, rather than re-saving `ADMIN_STATE`: enabling 2FA deletes the session the page used, and both projects already accept that nothing may follow them.

The second step's brute force is bounded by the plugin: 5 attempts per password-verified challenge, 3 requests per 10 seconds per address, and a 15-minute lockout after 10 failures. Story 13.2's global ceiling guards the password, which an attacker must already hold to reach this step. The lockout lets someone who knows the password lock the owner out for 15 minutes; accepted, since it ends on its own.

`qrcode.react` (ISC, React 19 in its peer range, widely used) is the one new runtime dependency: no QR encoder exists in the tree, and writing one is not this story.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- expected: green, no tracked file changed.
- `pnpm test:e2e` -- expected: green, no CSP violation.

**Manual checks (if no CLI):**
- Turn it on with a real authenticator app: the entry reads « Archant », the code signs in. Run `pnpm api reset-password <email>`: two lines printed, next sign-in has one step.
