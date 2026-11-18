# Epic 20 Context: Share Archant read-only with the household

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

A second person of the household reads the accounts with their own sign-in, invited by a link, and the server refuses them every write. Archant adds one role, `viewer`, beside `admin`, as the user model planned from the start, and invites by a link the administrator copies, as self-hosted Sure does since it sends no email. It departs from Sure deliberately: one global role instead of per-account sharing, since one instance is one household; a viewer cannot edit categories, tags, rules or merchants, which Sure's `guest` can; the server enforces read-only in one middleware on the HTTP method rather than per route; the invitation token is stored hashed rather than encrypted; there is no email and no « join with an existing account »; and assistants stay the administrators'.

## Stories

- Story 20.1: A read-only role, enforced by the server
- Story 20.2: Invite someone with a link
- Story 20.3: Members, and what a viewer sees

## Requirements & Constraints

- A viewer reads everything an administrator reads, except bank credentials (`/api/bank-connections/setup`), the assistants list, the members list and `/api/export`, which answer `403`. A viewer writes nothing.
- Every `POST`, `PUT`, `PATCH` or `DELETE` from a viewer to an `/api` route behind `requireSession` answers `403 FORBIDDEN` before the route runs. A spec walks every mutating route of the running app's route table and fails when one answers otherwise, so a route added later is covered without thinking of it.
- A user created without a role must fail closed: the default role is `viewer`, and every creation names its role explicitly.
- A viewer still uses Better Auth's own routes to change their name, password and two-factor sign-in, as Sure's members do.
- A viewer cannot connect an assistant: the consent page refuses them, and `/api/mcp` refuses a token whose user is not an admin.
- The first signed-in request of the day starts the day's bank sync whoever sends it, viewer included, as Sure's `AutoSync` runs for every member.
- Invitations: a 32-byte random token, only its SHA-256 stored, three-day expiry, one pending invitation per email, as Sure's `invitation.rb`. The link is shown once at creation. An email that already has a user is refused. An expired, used, revoked or unknown token answers « Cette invitation n'est plus valable. »
- Accepting an invitation is a public route, rate-limited as `/api/setup`, that creates the user with the invitation's role, marks the invitation accepted in the same transaction and signs them in. Public sign-up stays off.
- Role changes and removals apply at the member's next request; removing a member deletes their sessions. The last administrator can never be demoted or removed.
- `listAssistants` and `disconnectAssistant` read and change only the signed-in user's assistants once two users exist.
- Every input crossing a boundary is parsed by Zod; every route has a body limit. Better Auth's session defaults stay intact. Errors are closed SCREAMING_SNAKE_CASE `AppError` codes with English messages.
- Every acceptance criterion has a test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- `USER_ROLES` in `@archant/data` becomes `["admin", "viewer"]`. The `role` check constraint is rebuilt by a migration that touches no data. `role` stays `input: false`, so no user can promote themselves through Better Auth's update endpoint.
- Better Auth's `admin({ defaultRole })` is `viewer`.
- `requireSession` puts the user on the Hono context. `requireRole(role)` is the only code that reads `role`; the interface never decides a permission. AD-13 named this helper but nothing built it until Story 20.1.
- One middleware placed after `requireSession` refuses mutating methods from a viewer. Admin-only reads call `requireRole("admin")`.
- `/api/auth/*`, `/api/health`, `/api/setup`, `/api/sync` and `/api/mcp` sit outside `requireSession`. `/api/mcp` is guarded by its OAuth token, so its admin check is separate: only an administrator holds an MCP consent.
- Invitations live in `invitations (id, email, role, token_hash, inviter_id, expires_at, accepted_at, created_at)`, with service code in `services/invitations.ts` and `requireRole` and `viewerReadOnly` in `routes/middleware/roles.ts`. Users are created through `auth.api.createUser` inside the accepting transaction, as `/api/setup` does.
- Reading never writes, so a viewer can open any page: a budget month, for instance, creates its rows only on the first save.
- Roles beyond `admin` and `viewer`, and per-account sharing, stay out of scope.

## UX & Interaction Patterns

- « Réglages › Membres » at `/settings/members` lists each member with their role, each pending invitation with its expiry and « Révoquer », and « Inviter ». Inviting chooses `viewer` or `admin` and shows the link once with a copy button.
- `/invitations/:token` names who invites and the role, shows the invitation's email read-only, and asks for a name and a password.
- A viewer sees no control that writes: no « Nouveau », « Importer », « Synchroniser », edit, delete, bulk bar, rule editor or budget form. Settings show « Sécurité » only. The server's refusal remains the authority for anything the interface misses.
- URLs are English. Visible strings go through i18next in French. Pages are usable with the keyboard alone and meet WCAG 2.2 AA contrast.

## Cross-Story Dependencies

- Story 20.1 comes first; 20.2 and 20.3 follow in order. The members list's admin-only guard named in 20.1 lands with 20.3's route.
- Every write route of earlier epics, including Epic 19's split and attachment routes, must be a mutating method so the viewer middleware covers it.
- `docs/security-model.md` and `docs/sure-parity.md` must say what a viewer reads and cannot do by the end of Story 20.3.
