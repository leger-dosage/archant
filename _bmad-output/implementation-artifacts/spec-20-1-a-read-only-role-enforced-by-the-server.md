---
title: 'Story 20.1: A read-only role, enforced by the server'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '620e49ea0bb45399c1b4869c73f9cb2577564759'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-20-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant knows one role, `admin`, so the owner cannot share the household's figures without handing over every write: a second person signed in could delete an account, rewrite a rule or connect an assistant.

**Approach:** As AD-21 says, `viewer` joins `USER_ROLES`; the server refuses every write of a viewer in one middleware placed after `requireSession`, so a route added later is covered without thinking of it, and the few administrator-only reads call `requireRole("admin")`. Sure's `guest` still edits categories and rules, and Sure keeps MCP settings to admins; Archant's viewer writes nothing and connects no assistant. Story 20.1 of `epics.md` is the acceptance contract; the owner delegated every decision, the ones taken alone are marked « Decided ». Nobody can create a viewer through the interface until Story 20.2.

## Boundaries & Constraints

**Always:**
- `USER_ROLES = ["admin", "viewer"]` in `@archant/data/schema/auth`; `pnpm data generate --name allow_viewer_role` rebuilds `users` (`0044`) with every row copied as it is. `admin({ defaultRole: "viewer" })`; `completeSetup` keeps naming `admin`.
- `requireSession` sets `user` on the context (`SessionEnv`); `requireRole(role)` reads it and answers `403 FORBIDDEN` unless `user.role === role`, a missing user included (Decided: equality, two roles need no ranking).
- `viewerReadOnly` after `requireSession` in `app.ts`, before `dailySync`: a request other than `GET` or `HEAD` on a non-public `/api` path goes through `requireRole("admin")` (Decided: an allow list of reading methods, so an unusual method or a missing role fails closed, and covers the four the story names).
- `requireRole("admin")` on `GET /api/bank-connections/setup`, `GET /api/assistants` and `GET /api/export`. Every other read is unchanged; no `GET` route writes (checked while planning; the session refresh and the day's sync are the only writes a read triggers).
- Consent: `POST /api/auth/oauth2/consent` goes through `requireSession(auth, { always: true })` then `requireRole("admin")` before Better Auth (Decided: in Hono beside `signInCeiling`, so `requireRole` stays the reader; a viewer's refusal answers too, since the page offers them neither button). `grantedScopes` counts a consent only while its user is an `admin`, so `/api/mcp` answers its `401` challenge to a viewer's token (Decided: an assistant has no session, so this is the one other place that reads `role`).
- Consent page: a session whose `user.role` is not `admin` sees « Seul un administrateur peut connecter un assistant. » and no « Autoriser » or « Refuser »; the server's refusal stays the authority.
- Viewers keep Better Auth's own routes, mounted before the middleware: `update-user` for the name, `change-password`, `two-factor/*`.

**Never:** no invitation, no member list, no hidden control in the interface beyond the consent page (Stories 20.2, 20.3); no Better Auth access-control roles; no new dependency; no per-route write check.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Viewer writes | each `POST`/`PUT`/`PATCH`/`DELETE` of the app's routes, empty body | `403 FORBIDDEN`, never `400` |
| Viewer reads | every other `GET` | same status as the administrator |
| Admin-only reads | viewer on setup, assistants, export | `403 FORBIDDEN`; admin `200` |
| Created without role | `auth.api.createUser` with no `role` | stored `viewer` |
| Migration | admin with session, credential, two-factor, consent before `0044` | every row kept, `viewer` accepted, `owner` refused by `users_role_check` |
| Viewer's own account | name, password, two-factor enable | `200` |
| Consent | viewer posts accept | `403`; no consent row |
| MCP | admin's token, then the user made `viewer` | `401` challenge |
| Daily sync | viewer's first `GET` of the day | connection syncs |

</frozen-after-approval>

## Code Map

- `packages/data/schema/auth.ts:14-18` -- `USER_ROLES` and its comment; `migrate.spec.ts:275` « admin role only » test, `:263` `migratedBefore`, `:770` 0018 rebuild test as the model (children kept, `pragma_foreign_key_check`). libSQL's `migrate()` turns foreign keys off outside the transaction, so `DROP TABLE users` cascades nothing.
- `packages/api/src/routes/middleware/auth.ts` -- `requireSession`, `isPublicPath`. New `routes/middleware/roles.ts` (`requireRole`, `viewerReadOnly`) and `roles.spec.ts`.
- `packages/api/src/app.ts:399-421` -- `.on("POST", …signInCeiling)` pattern for the consent guard; `.use("/api/*", requireSession)` then `dailySync`.
- `routes/bank-connections.ts:36`, `routes/assistants.ts:16`, `routes/export.ts:14` -- admin-only reads.
- `services/auth.ts:218` -- `admin({ defaultRole })`; `services/auth.spec.ts`.
- `services/assistants.ts:117` `grantedScopes`; `mcp/server.ts:204` `Refused` message; `mcp/server.spec.ts`; `testing/assistant.ts` `connect`, `registerClient`, `mcp`.
- `testing/auth.ts` -- add `VIEWER` and `addViewer(app, auth)`, which creates the viewer through `auth.api.createUser` and returns its cookie. `testing/app.ts` `syncApp`, `linkedConnection`; `routes/middleware/daily-sync.spec.ts`.
- `lib/errors.ts:15` -- `FORBIDDEN` comment.
- App: `routes/oauth.consent.tsx`, `lib/auth-client.ts` `sessionQuery`, `locales/fr.json` `consent.*`; e2e `e2e/assistants.spec.ts` style, `bank-connections.spec.ts:980` direct database write with `createDb` and `DATABASE_FILE`, `better-auth/crypto` `hashPassword` for a viewer's credential.
- Docs: `docs/architecture.md` AD-13, AD-21; `docs/security-model.md` assistants and export paragraphs; `AGENTS.md` and `CONTRIBUTING.md` route conventions.

## Tasks & Acceptance

**Execution:**
- [x] `migrate.spec.ts` -- first: both roles accepted, others refused; `0044` keeps an admin's session, credential, two-factor and consent. Then schema and `pnpm data generate --name allow_viewer_role`.
- [x] `services/auth.spec.ts` -- first: a user created without a role is a viewer. Then `defaultRole`.
- [x] `testing/auth.ts` `addViewer`; `routes/middleware/auth.spec.ts` -- the user is on the context. `roles.spec.ts` -- first: `requireRole`; the walk of every mutating route of `buildTestApp(db).routes` under `/api` but `auth`, `mcp` and public paths, asserting a count floor and Epic 17–19 routes among them; every other `GET` matches the admin's status; the three admin-only reads; name, password, two-factor. Then `roles.ts`, `auth.ts`, `app.ts`, the three routes.
- [x] Consent and MCP: `services/auth.spec.ts` or `mcp/server.spec.ts` -- first: a viewer's consent refused with no row; a demoted user's token refused. Then `app.ts`, `grantedScopes`, `mcp/server.ts`.
- [x] `daily-sync.spec.ts` -- a viewer's first read of the day syncs.
- [x] App: consent page refusal, `fr.json`; `e2e/assistants-viewer.spec.ts` -- a viewer inserted in the database signs in, opens `/oauth/consent` and sees the refusal without buttons.
- [x] Docs listed above.

**Acceptance Criteria:**
- Given Story 20.1 of `epics.md`, when it ships, then each criterion holds with this spec's decisions, each with a Vitest test, and the consent page's refusal with a Playwright test.

## Design Notes

The walk reads the running app's route table rather than a list, so a route added later is walked without editing the spec: what it proves is that nothing mutating sits before `viewerReadOnly`, and a `403` instead of `400` on an empty body shows the refusal precedes validation.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green

## Implementation Notes

- `requireSession(auth, { always: true })` reads the session with `disableRefresh`: Better Auth's consent handler answers next and extends the session itself, while a cookie set by the middleware would be lost or would replace Better Auth's when the handler returns its own `Response`.
- Better Auth types `createUser`'s `role` as `"admin" | "user"` without access-control roles, so `addViewer` passes the role through `body.data`, which the admin plugin reads the same way. Story 20.2 creates users the same way.
- A consent posted without a session now answers Archant's `401 UNAUTHORIZED` envelope instead of Better Auth's own `401`.
- `/api/mcp`'s refusal message reads « the assistant was disconnected, or its user is not an administrator ».
- `syncApp` in `testing/app.ts` also returns its Better Auth instance, so a spec can add a viewer to the same database.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, standards, spec | AD-21 prevents « a role read from the interface » while the consent page reads `user.role` | low | The page reads it to choose what to show; the server still decides, but the rule as written forbids it | patch: AD-21 names the display read |
| blind, standards, thermo | `epic-20-context.md` places the role middleware in `auth.ts` and says the spec walks `AppType` | low | Stories 20.2 and 20.3 start from this cache | patch |
| blind, spec | Spec `in-review` while sprint status says `in-progress` | false | Both move to `done` together before the pull request | rejected |
| blind | A public path added later escapes `viewerReadOnly` and the walk | low | Inherent to a public path, open to anyone, not a viewer bypass; a guard adds rules for a hypothetical route | rejected |
| blind | The walk's `/api/auth` prefix filter would drop a future `/api/authorizations` | low | Broader than `isPublicPath`, and redundant with the `*` and public filters | patch: filter removed |
| blind, spec, thermo | The read walk fills every parameter with `x`, so parameterised reads answer 404 to both roles; « no `GET` writes » is untested | medium | A refusal of `GET /api/accounts/:id` to a viewer would pass | patch: seeded ids, 200 asserted, tables compared around the viewer's walk |
| verification-gap | `disableRefresh` on the consent guard has no test | medium | Removing it left 167 tests green | patch: a day-old administrator's consent answers one session cookie |
| blind, thermo | 0044 test omits `oauth_clients.user_id`, access and refresh tokens | low | They cascade from `users` too | patch |
| blind | `security-model.md` says a demoted user « loses » their assistants; the paragraph above says « the owner » | low | Rows stay and work again after a promotion | patch: wording, and `grantedScopes` docstring |
| blind, edge | A viewer's consent page offers no answer, so the assistant waits | low | Frozen decision: the page offers a viewer neither button and the server refuses both answers | rejected |
| blind, standards | The e2e test writes the viewer in SQL although tests create accounts through the API | false | That rule is about the domain's accounts; no route creates a user before Story 20.2, as the test's comment says | rejected |
| blind | The e2e test's title is hard to read | low | Direct rename | patch |
| blind | `GET /api/bank-connections/institutions` stays open to a viewer | false | Story 20.1 lists the administrator-only reads and asks every other read to answer as for the owner | rejected |
| edge | A 403 on the consent answer shows `INTERNAL_ERROR` | low | Reached by an administrator demoted while the page is open | patch |
| edge, standards | A session refetched as `null` shows the administrator-only refusal | low | `beforeLoad` fills the query, so no flash on load; a sign-out elsewhere still misleads | patch: refusal for a signed-in non-administrator only |
| edge, verification-gap, thermo | `BankAlerts` reads `/api/bank-connections/setup` on every page, which now answers a viewer 403 | medium | `BankAlerts.tsx:113` without `meta.optional`; the frozen spec keeps interface hiding to Stories 20.2 and 20.3 | defer: Story 20.3's criteria name it; the route comment « Always answers » is patched |
| edge | The walk skips a write route registered with `.all()` | low | `viewerReadOnly` still refuses its writes by path; only the walk's listing misses it | rejected |
| standards | `always` names two behaviours | low | The docstring states both; a rename names no harm | rejected |
| standards | `viewerReadOnly` repeats `isPublicPath` | low | Needed: a public path has no user, and `requireRole` would refuse setup and the scheduled sync | patch: the reason in a comment |
| standards | Refusal body and route filters repeated in the spec; `ADMIN_READS` beside each route; `"admin"` literals | low | No named harm; the read walk fails when `ADMIN_READS` drifts | rejected |
| spec | A viewer's `accept: false` is refused but untested | low | The frozen decision covers it; one more case | patch |
| thermo | No test pins the Better Auth endpoints open to a viewer | low | `admin/*` is disabled and already tested for any session; client and consent endpoints check ownership | rejected |
| thermo | `HEAD` on the administrator-only reads is untested | low | Hono runs the `GET` route's middleware for `HEAD` | rejected |
