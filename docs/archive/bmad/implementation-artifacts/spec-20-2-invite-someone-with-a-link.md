---
title: 'Story 20.2: Invite someone with a link'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
baseline_commit: 'e9c3da79e94c89c0dfa26873ed5cab37785b504e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 20.1 gave Archant a `viewer` role, but nobody can create a second user: public sign-up is off and the admin plugin's HTTP endpoints are disabled, so the household's second person cannot get an account without someone editing the database.

**Approach:** As self-hosted Sure does, the administrator invites an email as `viewer` or `admin` and copies a link shown once; the invited person opens it, sets a name and a password, and is signed in. AD-21 governs. Story 20.2 of `epics.md` is the acceptance contract; the owner delegated every decision, the ones taken alone are marked « Decided ».

## Boundaries & Constraints

**Always:**
- `invitations (id, email, role, token_hash, inviter_id, expires_at, accepted_at, created_at)` in `packages/data/schema/invitations.ts`, epoch-millisecond integers, `role` checked against `USER_ROLES`, `token_hash` unique, `inviter_id` cascading from `users` (Decided: a removed inviter's invitations go with them), and a partial unique index on `email` where `accepted_at is null`; migration `pnpm data generate --name add_invitations` (`0045`). Creation deletes the email's expired, unaccepted rows first, as Sure's `remove_expired_duplicates_in_family`.
- Token: `randomBytes(32)` in base64url; only its SHA-256 hex is stored; expiry `created_at + 3 days`. Emails are trimmed and lowercased, as Better Auth stores them. The token, the link and the email are never logged; ids are.
- Admin routes in `routes/invitations.ts`, mounted at `/invitations`: `POST /` `{ email, role }` → `201 { id, email, role, expiresAt, url }`, `url` being `${trustedOrigin}/invitations/<token>` (Decided: `BETTER_AUTH_URL` is the address members reach); `GET /` → pending ones only (not accepted, not expired), soonest expiry first; `DELETE /:id` → deletes a pending one, else `404 NOT_FOUND`. Each carries `requireRole("admin")` (Decided: the public paths below share the prefix, so no anonymous request reaches these). An email with a user answers `VALIDATION_ERROR` field `email` code `user_exists`; one with a pending invitation, `invitation_pending`.
- Public routes, added to `PUBLIC_PATHS`: `POST /api/invitations/preview` `{ token }` → `{ email, role, inviterName }`, the inviter's name, else email; `POST /api/invitations/accept` `{ token, name?, password }` → `201`. The token travels in the body (Decided: `app.onError` logs a failing request's path, which must never hold a usable token). An unknown, expired, used or revoked token answers the new `INVITATION_INVALID` (404), translated « Cette invitation n'est plus valable. ». Name and password follow `setupSchema`'s rules (Decided: as setup, the name is optional).
- Acceptance is rate-limited as `/api/setup`: `createRateLimiter({ max: 3, windowMs: 10_000 })` per `clientKey`, before the body is read. It claims the invitation with one `update … set accepted_at where token_hash = ? and accepted_at is null and expires_at > now returning`, then calls `auth.api.createUser` with the invitation's email and its role through `body.data`; a failure clears `accepted_at` again and rethrows (Decided: Better Auth writes on its own connection, so, as `completeSetup`, an atomic claim undone on failure stands for the transaction, and two concurrent acceptances cannot both create a user). It then signs in through `auth.api.signInEmail` with `returnHeaders` and forwards its `set-cookie`; a failed sign-in still answers `201`, and the page sends the person to sign in.
- `invitations` joins `LEFT_OUT` in `services/ledger/export.ts` as `SECRETS`; `GET /api/invitations` joins `ADMIN_READS` in `roles.spec.ts`.
- Interface: « Réglages › Membres » at `/settings/members`, new in `SettingsNav` before « Sécurité », lists pending invitations (email, role, « Expire le … », « Révoquer » with a confirmation) and offers « Inviter »: a dialog with the email and the role, « Lecteur » by default or « Administrateur », which on success shows the link once with `CopyableAddress` and says it will not be shown again (Decided: Story 20.3 adds the members to this page). `/invitations/$token`, outside `_authed`, previews the invitation, then shows « {{inviter}} vous invite à rejoindre Archant en tant que {{role}}. », the email read-only, first name, password and confirmation, and « Créer mon compte »; success lands on `/`. An invalid token shows the message and a link to sign in.

**Never:** no email sending; no « join with an existing account »; no member list, role change or removal (Story 20.3); no new dependency; Better Auth's sign-up and admin endpoints stay disabled.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Invite | admin, new email, `viewer` | `201`, link once; stored hash is SHA-256 of the link's token |
| Existing user | email of a user, any case | `400` field `user_exists`, nothing stored |
| Pending twice | second invite of a pending email | `400` field `invitation_pending` |
| Expired re-invite | expired invitation for the email | old row deleted, new one `201` |
| Accept | valid token, password | user with the invitation's role, `accepted_at` set, session cookie answers `/api/accounts` |
| Replay | same token again | `404 INVITATION_INVALID` |
| Expired, revoked, unknown | token | preview and accept `404 INVITATION_INVALID` |
| Creation fails | Better Auth throws | `accepted_at` back to `null`, link usable |
| Rate limit | 4th accept in 10 s from one address | `429 TOO_MANY_REQUESTS` before the body is read |
| Viewer | create, list, revoke | `403 FORBIDDEN` |
| Sign-up | `POST /api/auth/sign-up/email` | still refused |

</frozen-after-approval>

## Code Map

- `packages/data/schema/auth.ts` `USER_ROLES`, `users`; `schema/check.ts` `inList`; `schema/assistant-calls.ts` integer timestamps; `package.json` `exports`; `types.ts` add `Invitation`. `migrate.spec.ts` style for a constraint test.
- `packages/api/src/services/setup.ts` `completeSetup`: claim-then-create-with-undo model; `routes/setup.ts` `limited` middleware and `SETUP_ATTEMPTS`, to reuse as a shared limiter; `lib/client-address.ts` `forwardedFor`, `clientKey`, `withForwardedFor`.
- `schemas/setup.ts` `firstNameSchema`, `PASSWORD_*`, `setupSchema`; new `schemas/invitations.ts`.
- New `services/invitations.ts` (`createInvitation`, `listInvitations`, `revokeInvitation`, `previewInvitation`, `acceptInvitation`) and `routes/invitations.ts`; `app.ts` `createApi` chain; `routes/middleware/auth.ts` `PUBLIC_PATHS` and its comment.
- `lib/errors.ts` add `INVITATION_INVALID: 404`; app `locales/fr.json` `errors`, `errors.fields`, `settings.sections`.
- Tests: `testing/app.ts` `useSignedInApp`, `temp`, `template`; `testing/auth.ts` `addViewer`, `withSession`, `buildTestApp`, `createTestAuth`; `routes/middleware/roles.spec.ts` `ADMIN_READS`; `services/ledger/export.ts` `LEFT_OUT`.
- App: `routes/setup.tsx` form pattern (`zodResolver`, `applyFieldErrors`, `FieldMessage`, `OutsideShell`); `routes/_authed.settings.assistants.tsx` list page pattern (`Page`, `ListCard`, `InsetGroup`, `EmptyState`, `ConfirmDialog`); `components/CopyableAddress.tsx`; `components/SettingsNav.tsx`; `hooks/useAssistants.ts`; `lib/query-keys.ts`; `lib/auth-client.ts` `sessionQuery`, removed after acceptance as setup does.
- E2E: `e2e/fixtures.ts` `test`, `uniqueName`, `clientAddress`; `e2e/assistants-viewer.spec.ts` writes its viewer in SQL because nothing could invite before this story; `e2e/settings.ts`.
- Docs: `docs/architecture.md` AD-13 public paths; `docs/security-model.md`; `docs/sure-parity.md:48`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data` -- schema, export entry, types, `pnpm data generate --name add_invitations`; a `migrate.spec.ts` case for the role check and the pending-email index.
- [x] `services/invitations.spec.ts` or `routes/invitations.spec.ts` -- first: every matrix row, the token hash, list contents and order, revoke then preview. Then schemas, service, routes, `PUBLIC_PATHS`, `INVITATION_INVALID`, `app.ts`.
- [x] `roles.spec.ts` `ADMIN_READS`, `export.ts` `LEFT_OUT`; the write walk covers the admin routes on its own.
- [x] App -- `hooks/useInvitations.ts`, `routes/_authed.settings.members.tsx`, `components/InviteDialog.tsx`, `routes/invitations.$token.tsx`, `SettingsNav`, `fr.json`.
- [x] `e2e/invitations.spec.ts` -- admin invites as viewer, copies nothing but reads the link; a signed-out browser opens it, sees inviter, role and fixed email, sets a password and lands signed in; the link then shows the invalid message; a revoked link and an unknown token show it too. `e2e/assistants-viewer.spec.ts` -- create its viewer through an invitation.
- [x] Docs listed above.

**Acceptance Criteria:**
- Given Story 20.2 of `epics.md`, when it ships, then each criterion holds with this spec's decisions, the interface ones with a Playwright test and the rest with Vitest.

## Implementation Notes

- `USER_ROLES` moved to `packages/data/user-roles.ts` (exported as `@archant/data/user-roles`), so the invitation dialog reads the roles without bundling Drizzle; `schema/auth.ts` and `schema/invitations.ts` import it, as `transaction-attachments.ts` imports `attachments.ts`.
- The setup limiter became `limitAttempts` in `routes/middleware/attempts.ts`; setup and acceptance each build their own, so one never spends the other's allowance.
- `forwardedHeaders` was split out of `withForwardedFor`: the acceptance route has read its body by the time it signs in, and a used `Request` cannot be copied.
- `POST /api/invitations/accept` answers `201 { signedIn }`, which tells the page whether to go to `/` or to `/sign-in`.
- The setup page's description no longer says the administrator is the only account.
- The token schema has no length of its own: the 64 KB body limit bounds it, so any string, however long, answers `INVITATION_INVALID`.
- A signed-in browser opening a link sees « Vous êtes connecté en tant que … » and « Se déconnecter » instead of the form, so accepting never replaces a session silently; signing out keeps the person on the page.
- The link step of « Inviter » closes only through « Terminé »: Escape and a click outside would lose a link shown once.
- Creating an invitation deletes every expired, unaccepted one, so an email that never joined does not stay in the database.
- Accepting releases its claim in its own `try`, logging the invitation id if that fails, and rethrows the original error.


## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, verification-gap, standards | `ATTEMPTS`'s comment says guessing an invitation is no faster than a password, while preview is unlimited | low | `routes/invitations.ts` limits `/accept` only | patch: the comment says what is limited and why |
| blind | Preview answers the inviter's email when they have no first name | false | The spec decides « the inviter's name, else email »; only the person holding the link reads it | rejected |
| blind | A token over 200 characters answers `VALIDATION_ERROR`, and the page shows a field error | low | `previewInvitationSchema` had `.max(200)`; the page knows only `INVITATION_INVALID` | patch: no length on the token, body limit bounds it |
| blind, edge, thermo | A signed-in browser accepting a link has its session replaced silently, with the previous user's cache kept | medium | The page never read the session; `signInEmail` sets the new user's cookie | patch: signed-in notice and « Se déconnecter » instead of the form |
| blind, spec | A viewer sees « Membres » and « Inviter », and the list answers `FORBIDDEN` | medium | `SettingsNav` lists the page for every role; Story 20.3's criteria hide it | defer |
| blind, thermo | Escape or a click outside closes the link step, losing a link shown once | medium | `showCloseButton={false}` only removes the cross; Radix still closes | patch |
| blind | No warning when inviting an administrator | low | The role's label says it; a hint adds copy for no named harm | rejected |
| blind, verification-gap, spec, thermo | `sure-parity.md`'s Roles row still says `viewer` is planned | low | Contradicts the Invitations row this diff rewrote | patch |
| blind | No operator doc says the link names `ARCHANT_URL` | low | `docs/deployment.md` was silent | patch: one sentence |
| blind | Expired, never-accepted invitations stay with their email forever | low | Only a new invitation of the same email deleted them | patch: creation deletes every expired, unaccepted one |
| blind | A demoted inviter's invitations stay valid | low | No demotion exists before Story 20.3 | defer |
| blind, edge, thermo | A failing release hides the original error and leaves no trace; the success log sits inside the `try` | low | `acceptInvitation`'s catch ran an unguarded update | patch |
| blind, verification-gap, spec | No Playwright test for a link spent while its page is open, an expired link, or `user_exists` in the dialog | medium | The epic asks Playwright for what the interface shows | patch: three tests |
| blind | The `signedIn: false` branch has no interface test | low | Only reachable when Better Auth fails after creating the user; Vitest covers the answer | rejected |
| blind | Concurrent invitations of one email are untested | low | An immediate transaction and the unique index stand behind it | rejected |
| blind | The empty state repeats the page description | low | Two near-identical sentences one under the other | patch |
| edge | `createUser` failing after inserting the user leaves an orphan the link cannot replace | low | Needs a database failure between Better Auth's two inserts; `reset-password` recovers | rejected |
| edge, spec, thermo | Re-inviting an email while its acceptance is in flight can break the release or leave a pending invitation for an existing user | low | A sub-second window needing an administrator to re-invite that email then; guarding it adds branches | rejected |
| edge | The preview stays cached forever, so returning to a used link shows the form | low | `staleTime: Infinity`; submitting then shows the invalid page | patch: preview removed after acceptance |
| edge | The rate-limit test's second address uses a new app, so per-address keying is untested | low | `visitor()` builds a new limiter | patch: one app, two forwarded addresses |
| verification-gap | Setup and acceptance having separate limiters is untested | false | Setup answers `403` before its limiter once a user exists, and no invitation can exist before one does | rejected |
| verification-gap, thermo | Acceptance sets no device cookie | low | Matters only while the global sign-in ceiling is full, after the session's seven days | rejected |
| standards | Password fields and confirmation repeated from the setup page; catch blocks repeated across dialogs | low | Both read the same API schemas; the catch shape has ten precedents | rejected |
| standards | `clientAddress` and `trustedProxies` travel together; `withForwardedFor` delegates | low | `app.ts` already passes them so; no named harm | rejected |
| standards | The e2e `invite` restates `UserRole` | low | Direct correction | patch |
| standards | `open` names the revoke confirmation | low | Same name in the assistants page | rejected |
| spec | `setup.description` changed | false | It said the administrator is the only account, false once invitations exist | rejected |
| spec | Acceptance signs in without NFR15's global, persistent count | low | The epic asks a limit « as `/api/setup` »; a 32-byte token is out of reach | rejected |
| thermo | The route comment and AD-13 say the session guard lets anonymous requests reach the prefix | low | Only other methods on the two public paths do; the viewer's `GET` is the other reason | patch |
| thermo | `listAssistants` assumes one user, wrong with two administrators | low | Story 20.3's criteria scope it to the signed-in user | defer |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green
