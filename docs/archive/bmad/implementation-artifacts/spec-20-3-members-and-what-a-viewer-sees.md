---
title: 'Story 20.3: Members, and what a viewer sees'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
baseline_commit: '02929647f1971a474b3913bfa84b564aa19b97dc'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After Stories 20.1 and 20.2 a viewer can be invited, but the administrator cannot see who has access, change a role or remove anyone; a viewer's interface still offers every write and greets each page with a `FORBIDDEN` toast, because `BankAlerts` reads the bank setup; and with two administrators each sees and disconnects the other's assistants.

**Approach:** « Réglages › Membres » lists members beside the pending invitations, and an administrator changes another member's role or removes them through new `/api/members` routes; the interface hides every write from a viewer, the server's refusal staying the authority; the assistants routes read the signed-in user's only. AD-21 governs. Story 20.3 of `epics.md` is the acceptance contract; the owner delegated every decision, the ones taken alone are marked « Decided ».

## Boundaries & Constraints

**Always:**
- `routes/members.ts` mounted at `/members`, each route `requireRole("admin")`: `GET /` → `{ id, name, email, role, createdAt }[]` oldest first; `PATCH /:id` `{ role }` → the member; `DELETE /:id` → `{ data: null }`. Unknown id `404 NOT_FOUND`; the caller's own id `409 CANNOT_CHANGE_SELF`, as Sure's `cannot_remove_self`; a change leaving no administrator `409 LAST_ADMIN`. `GET /api/members` joins `ADMIN_READS`.
- `services/members.ts` writes with Drizzle in one transaction, and the last-administrator guard sits inside the `update` or `delete` statement itself (`… where id = ? and (role <> 'admin' or (select count(*) from users where role = 'admin') > 1)`), so two administrators demoting each other at once leave one (Decided: Better Auth's `setRole` and `removeUser` need the request's headers and write separately, so they cannot hold the guard and the cleanup together). Removal deletes the `users` row; its cascades delete sessions, credentials, two-factor, invitations sent, consents and tokens. It also deletes invitations addressed to the member's email, as Sure's `profiles_controller#destroy`.
- Demotion to `viewer` deletes, in the same transaction, the member's pending invitations and their OAuth consents, access and refresh tokens (Decided: a later promotion must not revive an assistant or a link granted under the lost role; Sure revokes tokens on deactivation). `grantedScopes` keeps its role check. Sessions stay: `requireSession` reads the role on each request, so the change applies at the next one. Same role → `200`, nothing deleted. Logs carry ids only.
- `listAssistants(deps, userId)` and `disconnectAssistant(deps, userId, clientId)` filter consents and tokens on the user; `routes/assistants.ts` reads `c.get("user")`. Another user's client → `404 ASSISTANT_NOT_FOUND`.
- New `hooks/useIsAdmin.ts`: `useQuery(sessionQuery)` and `role === "admin"`, the interface's one reader of `role` besides the consent page; a mutation answered `FORBIDDEN` refetches the session, so a member demoted while their page is open sees the viewer's interface (Decided).
- A viewer sees: no `BankAlerts` (not mounted, so no setup read); no « Ajouter un compte » in the shell, dashboard and accounts pages; on an account, no « Importer », « Ajouter une opération », account menu, « Ajouter un solde » or « Annuler l'import », and snapshot rows that open nothing; no selection checkboxes or bulk bar; category chips as plain pills; a transaction sheet titled « Opération » with every field in a disabled `fieldset`, no « Enregistrer » or « Supprimer », and split, transfer, duplicate, recurring and attachment blocks showing their state without their buttons, attachments still opening (Decided: the sheet is the only place notes, tags and receipts show); on budgets, no « Définir le budget », « Copier », « Partir de zéro », « Modifier » or « Corriger les catégories », and `/budgets/$month/edit` and `/budgets/$month/categories` redirect to `/budgets/$month`; on recurring, no « Détecter » or row menu; on rules, no « Appliquer toutes les règles », « Ajouter une règle », switch or row menu, a disabled rule labelled « Désactivée ». Empty states keep their text without their button; the empty dashboard tells a viewer the administrator adds the accounts.
- Settings: `SettingsNav` lists « Sécurité » only for a viewer; `_authed.settings.tsx` `beforeLoad` redirects a viewer from any other section, the bank pages included, to `/settings/security`, and `/settings` sends them there.
- « Réglages › Membres »: « Membres » lists each member, name else email, the email and the role; the signed-in one shows « Vous » and no action; the others a menu with « Passer administrateur » or « Passer lecteur » and « Retirer », each through `ConfirmDialog`, the demotion saying their assistants and pending invitations go, the removal that they are signed out everywhere. « Invitations en attente » below, as Story 20.2 built it; « Inviter » always in the page's actions.

**Never:** no new role or per-account sharing; no Better Auth admin endpoint reopened; no change to the email or name of another member; no read-only variant of a dialog the viewer cannot open; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| List | admin, two members | both, oldest first, no secret column |
| Promote | viewer → `admin` | `200`; viewer's next `POST /api/accounts` is not `403` |
| Demote | admin B → `viewer`, B has a consent, tokens, a pending invitation | `200`; those rows gone; B's next write `403` |
| Self | own id, `PATCH` or `DELETE` | `409 CANNOT_CHANGE_SELF` |
| Last admin | service call on the only administrator | `409 LAST_ADMIN`, unchanged |
| Remove | viewer with a session | `200`; their cookie answers `401`; sessions, credential and invitations to their email gone |
| Unknown | random id | `404 NOT_FOUND` |
| Viewer | list, change, remove | `403 FORBIDDEN` |
| Assistants | admins A and B each connect | each lists their own; A disconnecting B's `404`, B's kept |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/invitations.ts`, `routes/invitations.ts` -- service-plus-route model: `InvitationDeps`, `new Hono<SessionEnv>()`, `requireRole("admin")`, `validated("json", …)`, `{ data }` envelope; `schemas/invitations.ts` `z.enum(USER_ROLES)`.
- `app.ts:245` `createApi` single chain, mount `/members` beside `/invitations` (l.259). `routes/middleware/auth.ts:36` `SessionEnv`, `roles.ts` `requireRole`.
- `packages/data/schema/auth.ts` `users`, `sessions`, `authAccounts`, `twoFactors`; `schema/invitations.ts` (`inviterId` cascade, `acceptedAt`); `schema/oauth.ts` consents, access and refresh tokens (`userId`, `clientId`). Every FK to `users.id` cascades; no household table names a user.
- `services/assistants.ts:56` `listAssistants`, `:97` `disconnectAssistant`, `:121` `grantedScopes`; `routes/assistants.ts:19` plain `Hono`; specs `services/assistants.spec.ts`, `routes/assistants.spec.ts`; `testing/assistant.ts` `registerClient`, `connect`.
- `lib/errors.ts` `ERROR_STATUSES`; app `locales/fr.json` `errors` (`ErrorCode` is `keyof fr.errors`).
- Tests: `testing/auth.ts` `addViewer`, `withSession`, `createTestAuth`, `buildTestApp`; create extra users through `auth.api.createUser` with `body.data.role` (three sign-ins per ten seconds); `testing/app.ts` `useSignedInApp`; `roles.spec.ts:51` `ADMIN_READS`.
- App: `lib/auth-client.ts` `sessionQuery`; `app.tsx:78` `MutationCache`; `routes/_authed.tsx` context `session`; `routes/oauth.consent.tsx:71` role read; `components/Page.tsx:181` `BankAlerts`; `SettingsNav.tsx` `SETTINGS_SECTIONS` (also breadcrumbs); `_authed.settings.tsx`, `_authed.settings.index.tsx`.
- Write controls: `AppShell.tsx:215`; `_authed.index.tsx:84,122`, `DashboardEmpty.tsx`; `_authed.accounts.index.tsx:46,87`; `_authed.accounts.$accountId.tsx:147,203,355-370,448-466` (`writable`); `SnapshotList.tsx:54`; `ImportHistory.tsx:159`; `TransactionList.tsx:89,157,271` (`CategoryChip`, `RowCheckbox`; `CategoryPill` for a plain pill); `_authed.transactions.tsx:313-345`; `TransactionSheet.tsx`, `TransactionForm.tsx:228-423`; `TransactionSplit.tsx:81-168`, `TransactionLinks.tsx:98-297`, `TransactionAttachments.tsx:71-227`; `_authed.budgets.$month.tsx:52-106`, `BudgetCategories.tsx:273`, `_authed.budgets.$month_.edit.tsx`, `_authed.budgets.$month_.categories.tsx`; `_authed.recurring.tsx:53-169`; `_authed.rules.tsx:95-160,366-415`.
- Members page: `routes/_authed.settings.members.tsx`, `hooks/useInvitations.ts` (model for `hooks/useMembers.ts`), `components/InviteDialog.tsx`, `ConfirmDialog`, `InsetGroup`, `ListCard`; categories row `DropdownMenu` for the row menu; `lib/query-keys.ts`.
- E2E: `fixtures.ts` `invite` (l.341), `apiHelpers`; `assistants-viewer.spec.ts:33-48` signs a page in as a viewer through `page.request.post("/api/invitations/accept")`; `invitations.spec.ts` reads the members page.
- Docs: `docs/security-model.md` l.56-78; `docs/sure-parity.md` l.47-48; `docs/architecture.md` AD-21 (l.209), l.359; `CONTRIBUTING.md` l.25; `AGENTS.md` l.83.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/routes/members.spec.ts` -- first: every matrix row but the assistants one, the last administrator through `setMemberRole` and `removeMember` after the actor's row is made `viewer`. Then `lib/errors.ts`, `schemas/members.ts`, `services/members.ts`, `routes/members.ts`, `app.ts`, `ADMIN_READS`.
- [x] `services/assistants.spec.ts`, `routes/assistants.spec.ts` -- first: two administrators; then the user filter and `routes/assistants.ts`.
- [x] App -- `hooks/useIsAdmin.ts`, `app.tsx`, `hooks/useMembers.ts`, `query-keys.ts`, the members page, settings guard and nav, `Page.tsx`, every write control in the Code Map, `fr.json`.
- [x] `e2e/members.spec.ts` -- admin sees self as « Vous » without actions, a member's role changed both ways and removed after confirmation; `e2e/viewer.spec.ts` -- after the admin creates an account, transactions, a budget, a rule and a recurring series, a viewer walks the dashboard, accounts, an account, operations with a sheet, budgets, recurring, rules and settings, sees none of the write controls, no « Cette action n'est pas autorisée. », only « Sécurité », is redirected from `/settings/categories` and a budget's edit page, and `POST /api/accounts` from their page answers `403`; `invitations.spec.ts` adjusted.
- [x] Docs listed above; `deferred-work.md` loses the four Epic 20 entries this story settles.

**Acceptance Criteria:**
- Given Story 20.3 of `epics.md`, when it ships, then each criterion holds with this spec's decisions, the interface ones with a Playwright test and the rest with Vitest.

## Implementation Notes

- `isAdmin(session)` in `lib/auth-client.ts` is the one reader of `role` in the interface besides the consent page: `useIsAdmin` calls it, and so do the `beforeLoad` guards of the settings and of a budget's two forms, which cannot call a hook.
- `signedInUser(c)` in `routes/middleware/roles.ts` replaces the user check the invitations, members and assistants routes each wrote.
- A request answered `FORBIDDEN`, read or write, reads the session again and is not retried; `sessionQuery` is also read again when the window comes back (`refetchOnWindowFocus: "always"`), and `_authed`'s layout runs the route guards again when the role it reads differs from the one its guards saw, so a demoted member leaves a page kept to administrators and a promoted one sees the controls without a reload.
- The members page renders the members and the pending invitations each on its own, so one failing leaves the other readable; the invitations' empty state has no button, since « Inviter » is always in the page's actions.
- A viewer's sheet: the footer's « Annuler » reads « Fermer »; the recurring block says the transaction belongs to no series instead of offering one; attachments say « Aucune pièce jointe. » without the instruction to attach one; a disabled rule shows a « Désactivée » badge in place of its switch.
- `PATCH` and `DELETE /api/members/:id` and `DELETE /api/assistants/:clientId` carry no `requireRole`: `viewerReadOnly` refuses a viewer's write, as `AGENTS.md` asks.
- « Réglages › Sécurité » said « Le mot de passe du compte administrateur. » to every member; it now says « Le mot de passe de votre compte. ».
- `@archant/api/schemas/members` is exported, so `useSetMemberRole` takes `MemberRoleInput`.
- Member specs sign each test's members in on their own database, clearing its `rate_limits` first: a test demotes or removes the member it signs in, so no session survives to share.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge, verification-gap, thermo | An administrator demoted with a page open gets « Cette action n'est pas autorisée. » on every page, since only a refused write read the session again | medium | `QueryCache.onError` toasted `FORBIDDEN` without reading the session; `BankAlerts` stayed mounted | patch: a refused read or write reads the session again, `FORBIDDEN` is not retried |
| blind, edge | The route guards do not run again when the session changes under an open page | medium | `beforeLoad` reads `context.session` on navigation only | patch: `_authed` invalidates the router when the role differs |
| blind, edge, thermo | A promoted viewer keeps the viewer's interface until a reload, while the dialog says the change applies at their next action | low | `sessionQuery` has an infinite `staleTime` and a viewer sends no refused request | patch: `refetchOnWindowFocus: "always"` on the session |
| blind, standards | `PATCH`/`DELETE /api/members/:id` and `DELETE /api/assistants/:clientId` check the role, against « A route never checks a role to refuse a write » | low | `AGENTS.md` l.83; `viewerReadOnly` already refuses them | patch: removed |
| blind, edge, thermo | An invitation claimed while its inviter is demoted survives, or returns pending if creation fails | low | Needs an acceptance within the 100 ms of password hashing during the demotion, or a creation failure then; the outcome equals an acceptance just before | rejected |
| edge, thermo | The actor's role is read before the transaction, so an actor demoted mid-request still acts | low | A window of milliseconds between `requireSession` and the immediate transaction; the last-administrator guard still holds | rejected |
| edge, verification-gap, thermo | Two administrators of one shared client see each other's last call date | low | `assistant_calls` has no user column, from Story 16.1; fixing it is a migration | defer |
| blind, edge, thermo | An invitations error hides the members list, and the reverse | low | The card needed both queries | patch |
| edge | `LAST_ADMIN` or `CANNOT_CHANGE_SELF` leaves the list stale or the dialog open | low | `LAST_ADMIN` needs the actor demoted mid-request; self has no menu; a `FORBIDDEN` now reloads the role | rejected |
| edge | Skeleton and error card show together while one list is pending and the other failed | low | Each list now renders its own state | patch (same fix) |
| blind | AD-21 still says `requireRole` and `grantedScopes` are the only readers of `role`, and repeats the last-administrator rule | low | The members guard counts administrators in SQL | patch |
| blind | The demotion test never checks what must stay | low | Another administrator's consent and invitation were not asserted | patch |
| blind | Removal is tested on a viewer only; its log line is unchecked | low | No admin removal with consents and invitations | patch |
| verification-gap, spec | The session read again after a refusal has no test | medium | `viewer.spec` starts as a viewer; `members.spec` drives the member through the API | patch: a second administrator's browser demoted on `/settings/tags` is sent to « Sécurité » at its refused write |
| verification-gap, spec | The viewer test never opens a transfer, a split or an over-allocated budget, nor presses ⌘Enter | medium | One plain transaction; the budget was not over-allocated | patch: a transfer, a split, an over-allocated month and ⌘Enter |
| verification-gap | Invitations are not read again after a demotion in the interface | low | The demoted member had sent none | patch |
| spec | No Playwright test for the empty dashboard's viewer text | low | The shared database always holds accounts; an empty one needs its own server | rejected |
| blind | Empty states other than the dashboard tell a viewer to add or import | low | The spec decides empty states keep their text; cosmetic | rejected |
| blind | `viewer.spec` leaves its viewer and data in the suite's database | false | Every e2e test leaves its data; the suite starts on a fresh file | rejected |
| blind | A comment of `disconnectAssistant` runs past the line width | low | Direct correction | patch |
| standards | Member specs sign in once per test, clearing `rate_limits` | low | Each test demotes or removes the member it signs in; the rule's reason is the limit, cleared on the test's own database | rejected |
| standards | The budget guards repeat each other; `/settings/security` appears twice | low | Two three-line guards; no named divergence | rejected |
| standards | Some components read `useIsAdmin`, others take a `null` callback | low | A `null` callback is the existing way to drop a button a parent owns | rejected |
| standards | `changed.changed`, `existing` and the hand-written role input type | low | Direct corrections | patch: `outcome`, `memberOrNotFound`, `MemberRoleInput` |
| spec | `isAdmin` is read by the guards besides `useIsAdmin` | low | `beforeLoad` cannot call a hook | patch: implementation note |
| spec | `signedInUser` and the invitations route's rewrite are outside the spec | low | Removes a check written three times | rejected |
| spec | On mobile, a viewer reads « Disponible sur ordinateur » on the rules page | low | True for any reader; no write implied | rejected |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green
