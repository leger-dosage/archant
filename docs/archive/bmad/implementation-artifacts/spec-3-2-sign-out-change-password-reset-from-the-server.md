---
title: 'Story 3.2: Sign out, change password, reset from the server'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '2d89a2e037ec05c51434cb29c7f35c0c6813f133'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-1-first-launch-setup-and-sign-in.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.1 created the administrator and the session guard, but the only way out of a session is to wait seven days, the password can never be changed, and a forgotten one locks the household out of its own bank data for good (FR43, FR45).

**Approach:** Better Auth's own endpoints do the work: `signOut` from a user menu in the sidebar footer, `changePassword` with `revokeOtherSessions` from a new Sécurité page under `/reglages`, and a `pnpm api reset-password <email>` script that resets from a shell through `auth.$context`, with no email service anywhere (AD-13).

## Boundaries & Constraints

**Always:**
- Sign-out and password change go through `authClient.signOut()` and `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`. No new `/api` route, no new `AppError` code, no session or password code of our own (AD-13, NFR6).
- `/reglages/securite` holds the password form: « Mot de passe actuel », « Nouveau mot de passe », « Confirmer le nouveau mot de passe », button « Modifier le mot de passe ». `/reglages` is a layout listing its sections; only Sécurité exists until Epic 4.
- The sidebar footer gains a user menu showing the administrator's email, with « Réglages » and « Se déconnecter ». The theme menu stays where it is.
- `g s` goes to `/reglages`, declared in `lib/shortcuts.ts` like every other shortcut. The palette gains « Réglages » under « Aller à » and « Se déconnecter » under « Actions ».
- Password rules come from `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_LENGTH` in `schemas/setup.ts`, reused field by field as `/connexion` reuses `setupSchema.shape.email`.
- A wrong current password is a field error under that field, not a toast. `429` reuses « Trop de tentatives. Réessayez dans quelques secondes. » Anything else is the generic destructive toast.
- Success: the session query is invalidated, the form resets, and a `toast.success` says « Mot de passe modifié. »
- Signing out clears the whole query cache before navigating to `/connexion`, so no account name or amount survives on screen for the next visitor.
- `pnpm api reset-password <email>` prompts twice for the new password with the terminal echo off, checks the two match and the length rules, updates the password with Better Auth's own hasher, revokes every session of that user, and prints only a confirmation line. It never prints, logs or accepts the password as an argument.
- The reset logic lives in `services/password.ts` and is covered by Vitest; `cli/reset-password.ts` is prompt-and-call wiring only (AD-1). `index.ts` stays the only server entrypoint.
- `.env` is loaded by the script as `start:dev` loads it, since it needs `DATABASE_URL` and `BETTER_AUTH_SECRET`.

**Never:** no password reset by email, no reset token, no second user, no `viewer` role and no `requireRole` helper (still no caller); no other Settings section; no change of Better Auth's rate-limit rules; no `/api/health` or container work (Story 3.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sign out | Signed-in cookie | Session row gone; the next API call answers `401` | — |
| Change password | Current password right | Password updated, every other session revoked, this browser keeps a fresh cookie | — |
| Wrong current password | Any new password | Nothing written | `400 INVALID_PASSWORD`, shown under the current-password field |
| New password too short | 7 characters | Nothing written, no request sent | Field error `password_too_short` |
| Confirmation differs | Two different new passwords | Nothing written, no request sent | Field error `password_mismatch` |
| Repeated attempts | 4 changes within 10 s | Refused | `429`, « Trop de tentatives. » |
| Reset script | `reset-password admin@example.test`, matching prompts | Password updated, every session revoked, one confirmation line | — |
| Unknown email | An address with no user | Nothing written | Exit code 1, « Aucun utilisateur avec cette adresse. » |
| Prompts differ | Two different entries | Nothing written | Exit code 1, « Les mots de passe ne correspondent pas. » |
| Script password too short | 7 characters | Nothing written | Exit code 1, the length rule in plain words |
| No terminal | stdin is not a TTY | Nothing written | Exit code 1, naming `docker exec -it` |
| Session revoked by a reset | An old cookie after the script ran | — | `401 UNAUTHORIZED`, the interface goes to `/connexion` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/auth.ts` -- `createAuth` (L48). `auth.$context` is where the reset gets `internalAdapter` and `password.hash`; `disabledPaths` (L23) is checked in the router's `onRequest` only, so a server-side call is unaffected, as `completeSetup` already relies on.
- Better Auth 1.7.5 internals, read-only evidence: `internalAdapter.findUserByEmail`, `password.hash`, `internalAdapter.updatePassword(userId, hash)`, `internalAdapter.deleteUserSessions(userId)` (`dist/db/internal-adapter.mjs` L568, L627, L503). `auth.api.setUserPassword` is unusable from a script: it sits behind `adminMiddleware` and needs a session (`dist/plugins/admin/routes.mjs`). `changePassword` with `revokeOtherSessions` deletes every session of the user and issues a fresh cookie for the caller (`dist/api/routes/update-user.mjs`). `/change-password` shares the sign-in rate-limit rule of 3 per 10 s (`dist/api/rate-limiter/index.mjs` L305).
- New: `packages/api/src/services/password.ts` (+ `password.spec.ts`), `packages/api/src/cli/reset-password.ts`, `packages/api/src/lib/prompt.ts` (+ spec for its pure parts). `packages/api/package.json` gains the `reset-password` script, modelled on `start:dev`'s `--env-file-if-exists=../../.env`.
- `packages/api/src/testing/auth.ts` -- `setUpAndSignIn` (L113), `signIn` (L107), `cookieOf` (L98): the service spec signs in, resets, then checks the old cookie answers `401` through `buildTestApp`.
- `packages/web/src/components/AppSidebar.tsx` -- `SidebarFooter` (L155) holds `ThemeMenu`; the user menu joins it. `components/ThemeMenu.tsx` is the dropdown-in-the-footer pattern to copy.
- `packages/web/src/routes/_authed.tsx` -- `beforeLoad` returns `{ session }` (L31), so the menu reads the email from the route context. New `routes/_authed.reglages.tsx`, `_authed.reglages.index.tsx` (redirect to Sécurité), `_authed.reglages.securite.tsx`.
- `packages/web/src/routes/connexion.tsx` -- the form pattern to follow: `zodResolver`, `FieldMessage`, `describedBy`, mapping `error.status` to a message.
- `packages/web/src/lib/shortcuts.ts` -- `SHORTCUTS` (L15) gains `goSettings` with `g>s`; `components/CommandPalette.tsx` `goTo` (L92) and `actions` (L106); `routes/_authed.tsx` `GlobalShortcuts` (L41).
- `packages/web/src/lib/auth-client.ts` -- `authClient`, `sessionQuery`. `main.tsx` `signInAgain` (L22) already handles a session lost elsewhere.
- `packages/web/src/locales/fr.json` -- `nav`, `signIn.tooManyAttempts`, `errors.fields.password_too_short` / `password_too_long` / `password_mismatch` already exist; new `settings` and `security` sections.
- `packages/web/playwright.config.ts` -- `projects` (L22), `workers: 1`, `fullyParallel: false`. `e2e/settings.ts` `ADMIN`, `ADMIN_STATE`. `e2e/auth.spec.ts` runs with an empty storage state and signs in itself.
- `docs/deployment.md` -- where the reset command belongs for a self-hoster.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/password.spec.ts` -- tests first: every reset row of the matrix, on a temporary database, plus the revoked cookie answering `401`.
- [x] `packages/api/src/services/password.ts` -- `resetPassword({ db, auth }, email, newPassword)` through `auth.$context`; returns the user id, throws a named error for an unknown email.
- [x] `packages/api/src/lib/prompt.ts` (+ spec) -- a muted `readline` prompt and the pure checks (match, length), so the CLI holds no logic.
- [x] `packages/api/src/cli/reset-password.ts`, `packages/api/package.json` -- the script: env, database, prompts, call, one confirmation line, exit codes.
- [x] `packages/web/src/components/UserMenu.tsx`, `AppSidebar.tsx` -- the footer menu with the email, « Réglages » and « Se déconnecter », clearing the query cache.
- [x] `packages/web/src/routes/_authed.reglages.tsx`, `_authed.reglages.index.tsx`, `_authed.reglages.securite.tsx` -- the layout, the redirect and the password form.
- [x] `packages/web/src/lib/shortcuts.ts`, `routes/_authed.tsx`, `components/CommandPalette.tsx`, `locales/fr.json` -- `g s`, the two palette entries, the strings.
- [x] `packages/web/e2e/auth.spec.ts` -- signing out revokes the session and the next API call answers `401`.
- [x] `packages/web/playwright.config.ts`, `packages/web/e2e/password.spec.ts` -- a third project running after `chromium`, so a change that revokes every session cannot strand the suite.
- [x] `docs/deployment.md`, `AGENTS.md` -- the reset command, and the new Playwright project in the Testing section.

**Acceptance Criteria:**
- Given a signed-in browser, when I open the user menu and choose « Se déconnecter », then I land on `/connexion` and `/comptes` no longer opens without signing in again.
- Given `/reglages/securite`, when I change the password with the right current one, then « Mot de passe modifié. » shows, I stay signed in, and the old password no longer signs in.
- Given the interface, when I press `g s`, then I land on the Sécurité page.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge, verification | `e2e/auth.spec.ts` | The file now makes four form sign-ins plus the foreign-origin POST on one client address, against Better Auth's 3 per 10 s on `/sign-in` | medium | `dist/api/rate-limiter/index.mjs` L302 gives `/sign-in` a window of 10 s and a max of 3; every browser request reaches the API as `127.0.0.1` through the preview proxy. The file passes today only because the tests happen to be spaced apart. | patch |
| 2 | blind, edge | `hooks/useSignOut.ts` | A rejected `signOut()` skips both the cache clear and the navigation, leaving account names and amounts on screen | medium | The comment promises the navigation happens whatever Better Auth answers; the code awaits without a guard. | patch |
| 3 | blind, edge | `routes/_authed.reglages.securite.tsx` | A `401` reads as the generic unexpected-error toast | medium | The Better Auth client bypasses the query and mutation caches, so `signInAgain` in `main.tsx` never sees it: the matrix row « session revoked by a reset » is not honoured on this page. | patch |
| 4 | blind | `cli/reset-password.ts` | The refusal messages hard-code 8 and 128 while the constants are imported next door | low | Changing `PASSWORD_MIN_LENGTH` would leave the message lying. Direct fix. | patch |
| 5 | blind, edge | `lib/prompt.ts` | `promptSecret` never settles when the input closes (Ctrl-D, a closed pipe) | medium | `readline.question` does not call back on `close`; the recovery command would stop dead with no message. | patch |
| 6 | blind | `cli/reset-password.ts` | Both prompts run before an unknown address is found | low | Two wasted entries, no wrong outcome; the fix adds a lookup and a branch. Rejected. | |
| 7 | blind, edge | `cli/reset-password.ts` | An unexpected error prints a stack trace, and the database handle is not closed on a failure path | low | The process exits either way and the operating system closes the handle; a stack on a genuinely unexpected error helps whoever reports it. Rejected. | |
| 8 | blind | `cli/reset-password.spec.ts` | Having a test contradicts excluding `src/cli/**` from coverage | false | Coverage exclusion and test discovery are separate: the spec calls the file wiring, and the test asserts the one behaviour that lives there. | |
| 9 | blind | `services/password.spec.ts` | The rate-limit test exercises the Better Auth route, not `services/password.ts` | low | Placement only; the file's subject is passwords. Rejected. | |
| 10 | blind, edge | `playwright.config.ts` | Nothing records that the `password` project cannot be re-run | low | A later `retries` setting would make a retry sign in with a password that no longer exists. Direct fix: one comment. | patch |
| 11 | blind | `routes/_authed.reglages.securite.tsx` | Nothing refuses a new password equal to the current one | low | Better Auth allows it and Sure does not forbid it; the fix adds a rule the intent never asked for. Rejected. | |
| 12 | blind | `components/UserMenu.tsx` | The trigger's accessible name is the raw address, repeated by the label below | low | Radix announces it as a menu button; the address is the one thing that identifies the account. Rejected. | |
| 13 | blind | `docs/deployment.md` | The container command assumes an image Story 3.3 has not built, and says `docker compose exec` where the script says `docker exec` | low | Both name `-it`, which is the part that matters; the image arrives next story. Rejected. | |
| 14 | blind | `components/AppSidebar.tsx` | No « Réglages » entry in the main navigation | false | EXPERIENCE.md reaches Settings from the sidebar footer and `g s`, which is what was built. | |
| 15 | edge | `services/password.ts` | `deleteUserSessions` throwing after `updatePassword` leaves old sessions valid | low | Needs a failure between two statements on one local file; the fix adds a branch. Rejected. | |
| 16 | edge | `services/password.ts` | A user with no credential account would report success having written nothing | low | Setup always creates one and there is no other way to make a user. Rejected. | |
| 17 | edge | `vitest.config.ts` | `src/cli/**` excludes more than the one entrypoint | low | Everything under `cli/` is wiring by AD-1; logic belongs in a service. Rejected. | |
| 18 | edge | `docs/deployment.md` | The section names two variables where `validateEnv` requires three | medium | `env.ts` L36 makes `BETTER_AUTH_URL` required with no default: a minimal `.env` fails the command at the worst moment. | patch |
| 19 | edge | spec `## Tasks` | The task writes `resetPassword({ db, auth }, …)`; the code takes `{ auth }` | — | Nothing uses `db`; the fix would edit this build's spec. Rejected, noted in the report. | |
| 20 | edge | spec `## Design Notes` | The note says the password project signs in with its own context; it reuses `ADMIN_STATE` | — | The behaviour is right — `revokeOtherSessions` hands the caller a fresh cookie — and the fix would edit this build's spec. Rejected, noted in the report. | |
| 21 | verification | `e2e/auth.spec.ts` | `queryClient.clear()` is asserted by nothing | medium | Pre-verified. `page.goto` reloads the page, which empties the in-memory cache by itself, so the test passes with or without the clear. | patch |
| 22 | verification | `components/CommandPalette.tsx` | Neither new palette entry is executed by a test | medium | Pre-verified. `keyboard.spec.ts` types other entries by name and only checks that the three groups exist. | patch |
| 23 | verification | `lib/prompt.spec.ts` | Two prompts in a row on one input are never exercised, which is what the script does | medium | Pre-verified. The spec calls `promptSecret` once, on a fresh stream. | patch |
| 24 | verification | `cli/reset-password.ts` | The mapping from each refusal to its sentence, and the exit code, run in no test | medium | Pre-verified. Reaching the prompts needs a pseudo-terminal the repository does not have; every piece of logic behind them is covered elsewhere. | defer |

## Design Notes

The reset script cannot reuse an HTTP endpoint. `auth.api.setUserPassword` requires an admin session, and `setPassword` refuses an account that already has a password; a shell has neither a session nor the old password. `auth.$context` is Better Auth's own supported door to its adapter and hasher, so the script still never hashes anything itself.

Changing the password revokes every session of the single user, the end-to-end suite's saved administrator session included. With `workers: 1` and `fullyParallel: false` the files run in order, so a password test in the middle of the run would sign every later test out. A third Playwright project that depends on `chromium` runs after all of them: it signs in with its own context, changes the password, and nothing that follows needs a session. It is also why the sign-out test signs in itself rather than spending the shared one.

`/change-password` falls under Better Auth's sign-in rate-limit rule, three attempts per ten seconds: the end-to-end test changes the password once, not back and forth.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- the three projects pass, the password project last.

**Manual checks:**
- With `pnpm api start:dev` and `pnpm web start:dev`: sign out from the sidebar footer, sign back in, change the password from `/reglages/securite`, then run `pnpm api reset-password <email>` and check the terminal shows no password and the old session is refused.
