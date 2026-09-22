---
title: 'Story 3.1: First-launch setup and sign-in'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '9cdd0baaa71ac1029423e70ba20d0fec888f34d5'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every route answers anyone who reaches the server, so an Archant exposed beyond localhost hands its bank data to the first visitor (FR42–FR44).

**Approach:** Better Auth (email and password, sign-up disabled, `admin` plugin) owns users and sessions. A first-launch `/setup` page creates the single `admin`, a `/connexion` page signs in, and one middleware answers `401 UNAUTHORIZED` on every other `/api` route without a session; the interface redirects there and back (AD-13).

## Boundaries & Constraints

**Always:**
- Better Auth 1.7.5, `better-auth/adapters/drizzle` with `usePlural: true`, `account: { modelName: "auth_accounts" }`, `emailAndPassword: { enabled: true, disableSignUp: true }`, `admin({ defaultRole: "admin" })`, `telemetry: { enabled: false }`. Session length, cookie attributes and password length (8–128) stay at Better Auth's defaults (NFR6).
- Rate limit: `rateLimit: { enabled: true }` with the default rules (sign-in: 3 attempts per 10 s), memory storage. Better Auth only enables it when `NODE_ENV=production`, so it is switched on explicitly and tests see the real behaviour.
- Client address, as Express's `trust proxy`: by default it is the TCP peer, so no header can forge it and each visitor has their own rate-limit bucket. `TRUSTED_PROXIES` (optional, comma-separated IPs or CIDRs, validated by Zod) names the reverse proxies whose `x-forwarded-for` is believed. Before `auth.handler`, the app rewrites `x-forwarded-for`: the peer alone when the list is empty, otherwise the incoming header with the peer appended, as a proxy does; Better Auth's `advanced.ipAddress.trustedProxies` receives the list and walks it right to left. The peer comes from a `clientAddress(c)` dependency that `index.ts` builds with `getConnInfo` from `@hono/node-server/conninfo`, so no route or service reads a Node socket. No peer (in-process tests): the header is removed. The pure rewrite lives in `lib/client-address.ts`. (Decided by the project owner in review loop 1: an open-source self-hosted app must be safe by default.)
- `BETTER_AUTH_SECRET` (required, at least 32 characters) and `BETTER_AUTH_URL` (required URL) join `validateEnv`. `BETTER_AUTH_URL` is the origin the browser uses: `http://localhost:5173` in development, the preview origin in end-to-end tests, the public URL in production. It is Better Auth's trusted origin and the origin Hono's `csrf()` accepts on `/api/*`. No `WEB_ORIGIN`, no CORS.
- Schema: `packages/data/schema/auth.ts`, generated once with `pnpm dlx auth@1.7.5 generate` from a throwaway config, then hand-maintained: tables `users`, `sessions`, `auth_accounts`, `verifications`, snake_case columns, timestamps as epoch milliseconds. `USER_ROLES = ["admin"] as const` lives there; `users.role` is `text` not null with a check built by `inList(USER_ROLES)`. `packages/data/schema/settings.ts`: key-value `settings (key text primary key, value text not null, updated_at integer not null)`. One migration, 0010.
- `GET /api/setup` answers `{ data: { open: true } }` while no user exists, `403 FORBIDDEN` after. `POST /api/setup { email, password }`: Zod first (`schemas/setup.ts`, shared with the form), then `services/setup.ts` inserts the `setup_completed_at` row (`onConflictDoNothing`; no row inserted means `403`), then `auth.api.createUser({ body: { email, password, name: <email local part>, role: "admin" } })` without headers. If `createUser` throws, the row is deleted before rethrowing, so a failed setup can be retried.
- Guard in `routes/middleware/auth.ts`, registered in `createApp` before the `/api` mount: `auth.api.getSession({ headers })`, or `AppError("UNAUTHORIZED")`. Exempt: `/api/auth/*`, `/api/setup`, `/api/health`, `/api/sync` (the last two arrive in Stories 3.3 and 10.3). Unknown `/api` routes answer `401` without a session.
- `/api/auth/*` is `auth.handler(c.req.raw)`, outside the envelope and outside `AppType`. `/api/setup` is chained in `createApi`.
- `UNAUTHORIZED` (401) and `FORBIDDEN` (403) join the `AppError` union; `onError` maps the `403` `HTTPException` of `csrf()` to `FORBIDDEN`.
- Interface: a pathless `_authed` layout route holds today's sidebar layout and a `beforeLoad` that reads the session (TanStack Query, key `queryKeys.session`); without one it asks `GET /api/setup` and redirects to `/setup` or to `/connexion?redirect=<current href>`. Existing routes move under it, URLs unchanged. `/setup` and `/connexion` render without the sidebar and redirect to `/` when a session exists.
- `redirect` is followed only when it starts with `/` and not `//`; anything else goes to `/`.
- `/setup`: one card « Créer le compte administrateur », fields « Adresse e-mail », « Mot de passe », « Confirmer le mot de passe », button « Créer le compte ». On success it signs in with the same credentials and lands on `/`. On `403` it goes to `/connexion`.
- `/connexion`: card « Connexion », « Adresse e-mail », « Mot de passe », button « Se connecter », through `authClient.signIn.email`. Wrong credentials: « Adresse e-mail ou mot de passe invalide. » under the form. `429`: « Trop de tentatives. Réessayez dans quelques secondes. »
- A query or mutation failing with `UNAUTHORIZED` clears the session query and navigates to `/connexion?redirect=<current href>`, without a toast.
- Logs: user id and error code only; never an email, a password, a cookie or a token.

**Never:** no sign-out, password change or reset script (Story 3.2); no `/api/health` route or container work (Story 3.3); no `requireRole` helper, no admin-only route and no `viewer` (no caller yet); no custom session or password code; no rate-limit rule change beyond enabling it; no exemption for `/get-session`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First launch | No user, `POST /api/setup` valid | One user, role `admin`, `setup_completed_at` row | — |
| Setup twice | A user exists | Nothing written | `403 FORBIDDEN` |
| Concurrent setup | Two `POST /api/setup` at once | One user | The other `403 FORBIDDEN` |
| Short password | 7 characters | Nothing written, row absent | `400 VALIDATION_ERROR` with `fields` |
| Creation fails | `createUser` throws | Row deleted, setup open again | `500 INTERNAL_ERROR` |
| No session | `GET /api/accounts`, unknown `/api/nope` | — | `401 UNAUTHORIZED` |
| Session | Signed-in cookie | Route answers as before | — |
| Role escalation | `POST /api/auth/update-user { role }` | Role unchanged | `400` from Better Auth |
| Bad role in database | Insert role `viewer` | — | Check constraint fails |
| Brute force | 4th sign-in within 10 s | Refused | `429` |
| Forged address | No trusted proxy, 4 sign-ins each with a new `x-forwarded-for` | 4th refused | `429` |
| Behind a trusted proxy | Peer in `TRUSTED_PROXIES`, two clients' `x-forwarded-for` | Separate buckets | — |
| Cross-site form post | Multipart upload, foreign `Origin` | Nothing written | `403 FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `packages/api/src/app.ts` -- `createApi` chain (L21), `createApp` (L32), `onError` (L44): mount the auth handler and the guard before `.route("/api", ...)`, add `/setup` to the chain, map the `csrf()` 403. `AppDeps` gains `auth` and the trusted origin.
- `packages/api/src/index.ts` -- builds `createAuth` from env and passes it to `createApp`.
- `packages/api/src/env.ts`, `env.spec.ts` -- two variables. `.env.example` -- `BETTER_AUTH_URL=http://localhost:5173`, generation hint for the secret (`openssl rand -base64 32`), what fails without each.
- `packages/api/src/lib/errors.ts` (L7 union), `errors.spec.ts` -- two codes. `lib/logger.ts` L15 already redacts `authorization` and `cookie`.
- New: `packages/api/src/services/auth.ts` (`createAuth({ db, secret, baseURL })`), `services/setup.ts`, `routes/setup.ts`, `routes/middleware/auth.ts`, `schemas/setup.ts`. `services/settings.ts` stays as it is.
- `packages/data/schema/check.ts` `inList`; `schema/imports.ts` L24/L97 is the enum pattern. `package.json` `exports` gains `./schema/auth` and `./schema/settings`; `types.ts` gains `User`, `Session`. `migrate.spec.ts` covers the role check.
- `packages/api/src/app.spec.ts` -- `buildApp` (L19), `ownClient` (L30), `postRaw` (L45), `request` (L227), about 49 call sites. Sign in once per file through `/api/auth/sign-in/email` and have these helpers send the cookie and an `Origin`; sessions live in the database, so every `buildApp` instance accepts the cookie. Fake time is 2026-09-21.
- `packages/web/src/main.tsx` -- router gains `context: { queryClient }`; `QueryCache.onError` (L22) and a new `MutationCache.onError` handle `UNAUTHORIZED`.
- `packages/web/src/routes/__root.tsx` -- `RootLayout` (L85) moves to `routes/_authed.tsx`; `comptes.index.tsx`, `comptes.$accountId.tsx`, `operations.tsx`, `index.tsx` become `_authed.*`. New `routes/setup.tsx`, `routes/connexion.tsx`, `lib/auth-client.ts` (`createAuthClient` from `better-auth/react`, `adminClient()`), `lib/safe-redirect.ts`. `lib/query-keys.ts` gains `session`. Add the shadcn `card` component. `locales/fr.json`: `setup`, `signIn`, `errors.UNAUTHORIZED`, `errors.FORBIDDEN`. Forms follow `components/CreateAccountDialog.tsx` (react-hook-form, `zodResolver`, `applyFieldErrors`).
- `packages/web/e2e/` -- `start-api.ts` (L22) passes `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL=http://localhost:4174`. `playwright.config.ts` gains a `setup` project that the `chromium` project depends on, with `storageState: "e2e/.auth/admin.json"` (gitignored). `fixtures.ts` `apiHelpers` (L125) inherits the cookie through the `request` fixture and sends `Origin` on uploads; `keyboard.spec.ts` L99 and `import-ofx.spec.ts` L95 call the API directly.
- `AGENTS.md` Testing section -- end-to-end tests run signed in as the admin created by the setup project.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/setup.spec.ts`, `routes/middleware/auth.spec.ts` or `app.spec.ts` -- tests first: every matrix row except the interface ones, through `createApp` on a temporary database.
- [x] `packages/data/schema/auth.ts`, `schema/settings.ts`, `drizzle/0010_*`, `package.json`, `types.ts`, `migrate.spec.ts` -- tables, `USER_ROLES`, check constraint.
- [x] `packages/api/src/env.ts`, `env.spec.ts`, `.env.example` -- two variables.
- [x] `packages/api/src/services/auth.ts`, `services/setup.ts`, `schemas/setup.ts`, `routes/setup.ts`, `routes/middleware/auth.ts`, `lib/errors.ts`, `app.ts`, `index.ts` -- Better Auth, setup, guard, `csrf()`.
- [x] `packages/api/src/app.spec.ts` -- signed-in helpers; the existing suite passes unchanged otherwise.
- [x] `packages/web/src/lib/auth-client.ts`, `lib/safe-redirect.ts` (+ spec), `lib/query-keys.ts`, `main.tsx`, `routes/__root.tsx`, `routes/_authed*.tsx`, `routes/setup.tsx`, `routes/connexion.tsx`, `components/ui/card.tsx`, `locales/fr.json` -- pages, guard, redirects.
- [x] `packages/web/e2e/auth.setup.ts`, `auth.spec.ts`, `start-api.ts`, `playwright.config.ts`, `fixtures.ts`, `.gitignore` -- the setup project drives `/setup` in the browser and saves the session; `auth.spec.ts` runs with an empty storage state.
- [x] `AGENTS.md` -- Testing section.

**Acceptance Criteria:**
- Given a database with no user, when I open `/comptes`, then I land on `/setup`, and creating the administrator lands me on `/` signed in.
- Given a user exists, when I open `/setup` without a session, then I land on `/connexion`.
- Given no session, when I open `/comptes/<id>?tab=imports` and sign in, then I land back on that URL.
- Given a wrong password, when I submit `/connexion`, then « Adresse e-mail ou mot de passe invalide. » shows and I stay on the page.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Implementation Notes

- Better Auth's logger goes through pino with the message only: its arguments can carry a raw database error with the session token among the bound parameters.
- `lib/error-toast.ts` replaces the twelve direct `toast.error` calls, so an `UNAUTHORIZED` write redirects without a toast.
- `completeSetup` also checks that no user exists before claiming the row.
- `app.spec.ts` signs in once on a template database copied for each test database; the fake clock is set to 2026-10-21 while signing in, so the 7-day session outlives every test.
- msw drops the `cookie` header of multipart requests, so `testing/auth.ts` encodes the form body itself.
- With `usePlural`, the adapter looks up `auth_accounts` under the key `auth_accountss`; the schema map points that key at the `auth_accounts` table.
- Better Auth skips its origin check when `NODE_ENV=test`, so Vitest cannot observe it; the end-to-end API runs without `NODE_ENV=test`.
- Better Auth's `disabledPaths` matches exact paths only, so the fifteen `/admin/*` endpoints are listed one by one; server-side `auth.api.createUser` is unaffected.
- Better Auth maps an IPv4-mapped peer (`::ffff:127.0.0.1`) to IPv4 before matching `trustedProxies`, so `127.0.0.1,::1` covers the preview proxy on a dual-stack socket; a spec pins it.
- Without a peer, Better Auth falls back to `127.0.0.1` under `NODE_ENV=test`, so in-process specs keep one shared bucket unless they name a peer.
- The guard forwards the `set-cookie` of `getSession({ returnHeaders: true })`, since Better Auth re-sends the cookie when it extends a session older than `updateAge`.
- Queries no longer retry `UNAUTHORIZED`: TanStack Query's default three retries delayed the redirect to `/connexion` by about seven seconds.
- `signInAgain` sets the session query to `null` instead of removing it: two reads failing together made the second removal cancel the session fetch `/connexion` had started, which showed the router's error page.
- `safeRedirect` scans character codes rather than using a regular expression, because oxlint's `no-control-regex` forbids control characters in one and the repository has no lint disables.

- `/connexion` with a session goes to its `redirect` (through `safeRedirect`) rather than always `/`.

## Spec Change Log

- Loop 1. Trigger: triage #1, Better Auth's default client-address detection lets a forged `x-forwarded-for` bypass the sign-in limit, and its shared-bucket fallback lets a stranger lock the owner out. Amended, on the owner's decision (safe by default for an open-source app): frozen block gains the client-address rule and `TRUSTED_PROXIES`; the Never items forbidding a proxy header are narrowed; two matrix rows; Design Notes rewritten. Code kept, not reverted, on the owner's earlier rejection of a full re-derivation. KEEP: everything implemented in step 3 and the patch-routed findings #2, #3, #4, #5, #7, #9, #15, #17.

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge, verification | `services/auth.ts` rate limit | A client rotating a single-value `x-forwarded-for` bypasses the sign-in limit; without the header all clients share one bucket, and the sliding window lets a stranger keep the owner locked out | high | `@better-auth/core/dist/utils/ip.mjs` `getIP` trusts one `x-forwarded-for` value by default and returns `null` without it outside dev/test; the e2e `clientAddress` fixture relies on the bypass. Contradicts the Design Notes' shared-bucket assumption; the frozen block forbids any rate-limit or IP-header change. | intent_gap |
| 2 | blind | `services/auth.ts` admin plugin | `/api/auth/admin/*` lets the signed-in admin create a second user, set role `user` (500 on the check) or ban themselves | low | Plugin endpoints are mounted by `auth.handler`; only the admin can call them. Direct fix: disable those paths. | patch |
| 3 | blind | tests | Disabled public sign-up untested | medium | No test posts to `/api/auth/sign-up/email`. | patch |
| 4 | blind, verification | tests | Better Auth's origin check on sign-in untested; Vitest cannot see it | medium | Pre-verified. Only the e2e suite runs with the check. | patch |
| 5 | blind, edge | `routes/middleware/auth.ts` | Guard drops the refreshed session cookie, so a tab used daily without reload is signed out after 7 days | medium | `getSession` without `returnHeaders`; `sessionQuery` has `staleTime: Infinity`. | patch |
| 6 | blind, edge | `services/setup.ts` | `createUser` failing after the user insert leaves a user without password | low | Needs a failure between two inserts on one local file; fix adds a branch. Rejected. | |
| 7 | blind, edge | `routes/connexion.tsx` | Any 4xx, including `403 INVALID_ORIGIN`, reads « mot de passe invalide » | medium | The branch covers 400–499; a wrong `BETTER_AUTH_URL` is the likeliest setup error. | patch |
| 8 | blind | `app.ts` `onError` | Every 403 `HTTPException` is attributed to `csrf()` | false | `csrf()` is the only source of one today. | |
| 9 | blind, edge | `lib/safe-redirect.ts` | `/<tab>/host` becomes `//host` once the URL parser strips the tab | medium | The guard checks the raw string only. Direct fix: refuse control characters. | patch |
| 10 | blind | `main.tsx` `signInAgain` | Other cached queries survive a lost session | low | Same single user; they refetch. Rejected. | |
| 11 | blind | `docs/deployment.md` | New required variables not documented | low | The page states nothing is deployable yet; Story 3.3 writes it. Rejected. | |
| 12 | blind, edge | `routes/setup.tsx` | Failed automatic sign-in after setup lands on `/connexion` without a word | low | A first sign-in cannot hit the limit; rare. Rejected. | |
| 13 | edge | `services/setup.ts` | A claim row with no user (crash mid-setup) leaves setup stuck | low | Needs a crash between two statements; fix adds recovery logic. Rejected. | |
| 14 | edge | `services/setup.ts` | A failing cleanup delete masks the original error | low | Negligible. Rejected. | |
| 15 | edge | `env.ts` | `BETTER_AUTH_URL` with a path breaks `/api/auth` | low | The spec defines it as an origin; direct fix: refuse a path. | patch |
| 16 | edge | `routes/_authed.tsx` | A network error in `beforeLoad` shows the router's default error screen | low | Server down anyway. Rejected. | |
| 17 | verification | `main.tsx` | Redirect on a session lost mid-use untested | medium | Pre-verified. | patch |
| 18 | spec-review standards | `services/auth.ts` logger bridge | Better Auth's `success` level has no pino method | false | `@better-auth/core/dist/env/logger.mjs` L69 maps `success` to `info` before calling `log`. | |
| 19 | spec-review standards | `routes/setup.ts` | The route writes a log line; AD-1 keeps routes to parse, call, shape | low | Direct fix: the line moves into `completeSetup`. | patch |
| 20 | spec-review standards | `lib/auth-client.ts` | Comment says the session is removed; `main.tsx` sets it to `null` | low | Direct fix. | patch |
| 21 | spec-review standards | `ARCHITECTURE-SPINE.md` Configuration row | `TRUSTED_PROXIES` missing from the variable list | low | Direct fix. | patch |
| 22 | spec-review standards | `connexion.tsx`, `setup.tsx` | `FieldMessage` copied in two more files | low | Already copied in four components; extracting it touches six files outside the story. Rejected. | |
| 23 | spec-review standards | `index.ts`, `testing/auth.ts` | `BETTER_AUTH_URL` and `TRUSTED_PROXIES` passed to both `createAuth` and `createApp` | low | Two call sites, both in wiring. Rejected. | |
| 24 | spec-review spec | `routes/connexion.tsx` | A malformed email gets Better Auth's `400 INVALID_EMAIL`, shown as an unexpected-error toast | medium | The form only checked non-empty. Direct fix: reuse `setupSchema.shape.email`. | patch |
| 25 | spec-review spec | `routes/connexion.tsx` `beforeLoad` | With a session, `/connexion` goes to its safe `redirect` instead of `/` | low | Better than the spec: a signed-in user following a stale link lands where it pointed; `safeRedirect` still applies. Accepted, noted. | |
| 26 | spec-review spec | `packages/data/types.ts` | `NewUser`, `NewSession` exported unused | low | Every table in `types.ts` exports its pair. Rejected. | |

## Design Notes

Setup claims a `settings` row instead of counting users because Better Auth writes through its own connection: a Drizzle transaction around `createUser` cannot see or lock its insert, and a count leaves two concurrent requests both open. The primary key makes the claim atomic. Releasing it on failure matters: without that, a `createUser` error would close setup with no user, and only editing the database would reopen it.

`BETTER_AUTH_URL` points at the interface, not the API port. The browser sends `Origin: http://localhost:5173` through the Vite proxy; with the API's own port as base URL, Better Auth refuses every sign-in with `INVALID_ORIGIN`. In production the two are one origin.

End-to-end tests sign in once, in the setup project. The setup project is also the only moment the database has no user, so it is where the first-launch criterion is tested. Signing in per test would hit the 3-per-10-seconds limit.

Better Auth reads the client address from headers only, and by default believes a single `x-forwarded-for` value, which any client can write: rotating it defeats the sign-in limit. Without the header it falls back to one bucket for everyone, and since each request restarts the 10-second window, a stranger could keep the owner locked out. Normalising the header from the TCP peer before Better Auth sees it keeps its own parser and trusted-proxy walk, and gives the safe default of Express and Rails: trust nothing unless configured. Behind an unlisted proxy every visitor shares the proxy's bucket, which `.env.example` says in plain words.

End-to-end tests run behind Vite's preview proxy, a real proxy on loopback, so `start-api.ts` sets `TRUSTED_PROXIES=127.0.0.1,::1` and each test's browser sends its own `x-forwarded-for`: the production path, exercised.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `auth.setup.ts`, `auth.spec.ts` and the existing suite pass.

**Manual checks:**
- With a fresh `local.db`, `pnpm api start:dev` and `pnpm web start:dev`: `/` leads to `/setup`, then to the dashboard; a private window leads to `/connexion`.
