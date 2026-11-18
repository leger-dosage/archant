# Epic 3 Context: Protected access and deployment

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user runs Archant on a server of their own, behind a sign-in, from one container. A first launch creates the single administrator; every API route then requires a session; the user can sign out, change their password and recover access from a shell without any email service. One Docker image serves the built interface and the API on the same origin against a SQLite file on a volume, applies migrations at start and reports its health. This is what makes an application holding bank data safe to expose, and the container is the reference deployment target, exercised in CI.

## Stories

- Story 3.1: First-launch setup and sign-in
- Story 3.2: Sign out, change password, reset from the server
- Story 3.3: Run Archant from one container

## Requirements & Constraints

- No public sign-up. With no user, setup creates the administrator (email, password) with role `admin`. Once a user exists, the setup endpoint answers `403 FORBIDDEN` and the setup page redirects to sign-in.
- Every API route except health, `/api/auth/*`, setup and `/api/sync` answers `401 UNAUTHORIZED` without a valid session; the interface then redirects to sign-in. `/api/sync` accepts only the shared secret (implemented in Epic 10, but the guard's exception list must already include it).
- `role` is a text column checked against `USER_ROLES` in `@archant/data`, not writable through Better Auth's user update endpoint. `admin` is the only role used; adding `viewer` later needs no data migration.
- Better Auth's rate limit refuses repeated failed sign-ins for the configured window. Sessions keep Better Auth's defaults; never hand-roll or weaken session handling.
- Sign-out revokes the session. Changing the password requires the current one and revokes other sessions. `pnpm api reset-password <email>` prompts for the new password, updates it, revokes all sessions, and never prints it.
- `docker compose up` runs one container serving the interface under `/` and the API under `/api` on one port, with the database on a volume. Pending migrations are applied before the server listens, with the runtime driver; `drizzle-kit` is not in the image. `docker compose stop` exits within one second.
- `GET /api/health` answers `200 { "data": { "status": "ok" } }` after a real database query, `503` when the database does not answer. An unknown `/api/...` route answers the `NOT_FOUND` JSON, never the interface page.
- CI builds the image, runs it, and checks the health endpoint.
- Logs never carry a password, token, cookie or authorization header. Every acceptance criterion has an automated test: Playwright for the interface, Vitest for the rest.

## Technical Decisions

- Better Auth 1.7.5 with its Drizzle adapter (`usePlural: true`), email and password with `disableSignUp`, and its `admin` plugin, which supplies `role` with the right input rules. Telemetry disabled explicitly. The credentials table is renamed `auth_accounts` (`account.modelName`) so it never collides with the domain's `accounts`.
- Schema generated once with the `auth` CLI (`pnpm dlx auth@1.7.5 generate`, not the deprecated `@better-auth/cli`) into `packages/data/schema/auth.ts`, then hand-maintained: `role` declared `input: false` with a check constraint built from `USER_ROLES`, like every enumeration column. Tables `users`, `sessions`, `auth_accounts`, `verifications`.
- Setup cannot use `auth.api.signUpEmail` (it throws when sign-up is disabled, even server-side) nor a Drizzle transaction around Better Auth (it writes on its own connection; `SQLITE_BUSY`). `services/setup.ts` first claims the `setup_completed_at` row of the key-value `settings` table atomically, then calls `auth.api.createUser({ body: { email, password, name, role: "admin" } })`; a failed claim answers `403`. Release the claim if user creation fails.
- One middleware in `routes/middleware/auth.ts` guards `/api` with the exceptions above. Authorisation reads `session.user.role` through one `requireRole` helper. Mutating routes use Hono's `csrf()` middleware; Better Auth's `trustedOrigins` must accept the interface origin.
- `/api/auth/*` is Better Auth's own handler, mounted outside the `{ data }` envelope and outside `AppType`; the interface calls it through `better-auth/react`. Every other route keeps the envelope and chained mounts in `app.ts`. New codes (`UNAUTHORIZED`, `FORBIDDEN`, plus one for the `503` health answer, not named by the plans) join the closed `AppError` union.
- The reset script lives in `packages/api/src/cli/` and calls a service using Better Auth's server API or password hasher, never custom hashing. `index.ts` stays the only server entrypoint.
- Env: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` via `validateEnv`; `.env.example` says what degrades without each. Production `DATABASE_URL` is an absolute path.
- Container: Node 24, `packages/api/src/index.ts` runs env validation, migrations (`drizzle-orm/libsql/migrator`), seed, then serve. The built interface is served by the API with the SPA fallback mounted after `/api`, and `/api/*` has its own JSON 404 first (a catch-all `app.get("*")` otherwise preempts `notFound`). `init: true` in `docker-compose.yml`: Node as PID 1 drops SIGTERM and Docker kills it ten seconds later mid-write. Exactly one instance per database; SQLite in WAL.
- The interface calls the relative base `/api`. No build-time API URL: Vite inlines `VITE_*`, and a bundle built with a dev `.env` would call `localhost:8787`. In development Vite proxies `/api` to 8787.
- pino `redact` must use full paths (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`); wildcards match one level only.
- The container is the only deployment target with files in the repository; other targets are documentation in `docs/deployment.md`, never a branch in code.

## UX & Interaction Patterns

- `/setup`: a single card « Créer le compte administrateur », email, password twice. No other route reachable while no user exists.
- `/connexion`: sign-in page, reached from any page without a session. Session expired anywhere: redirect to `/connexion`, then back to the same URL after sign-in.
- Password change sits under Settings (`/reglages/...`) in a Sécurité section, reached from the sidebar footer and `g s`. Navigation entries appear only when their epic ships; Settings may show Sécurité alone for now.
- French, vouvoiement, infinitive buttons, no exclamation marks; every string in `locales/fr.json`; API error codes translated from `errors.<CODE>`. Errors show as a destructive Sonner toast; field errors come from `VALIDATION_ERROR` `fields`. Keyboard reachable, visible focus, WCAG 2.2 AA.

## Cross-Story Dependencies

- Story 3.1 adds the auth schema, the `settings` table, the session guard, `/connexion`, `/setup`, and the redirect on `401`. Existing Vitest route tests and Playwright tests (which create data through the API) must now run with a session, so 3.1 needs a test helper that sets up and signs in.
- Story 3.2 builds on 3.1's Better Auth instance and sessions, and adds the first `cli/` script.
- Story 3.3 needs the `/api` namespace and JSON 404 settled before serving the interface, and a health route exempt from 3.1's guard; its CI job complements the existing verification gate.
- Epic 4 reuses `settings` for `defaults_seeded_at` seeding. Epic 10 implements `/api/sync` behind `SYNC_SECRET` (constant-time comparison) and a session-guarded `POST /api/bank-connections/:id/sync`, both calling `services/sync.ts`.
