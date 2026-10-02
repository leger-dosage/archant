---
title: 'Story 16.1: Connect an assistant'
type: 'feature'
created: '2026-10-02'
status: 'ready-for-dev'
baseline_commit: 'b3841913eacb9f1fde2f4f1ce78cdf3378f3b6c3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-16-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The owner wants an AI assistant (Claude Code, VS Code, Cursor on the tailnet) to act in Archant, and today nothing but the browser session reaches the API.

**Approach:** Better Auth becomes an OAuth authorisation server (`jwt`, `@better-auth/mcp` over `@better-auth/oauth-provider`, `@better-auth/cimd`); `POST /api/mcp` serves MCP from the API's process through `@modelcontextprotocol/server` with four read tools; a consent page and « Réglages › Assistants IA » let the owner grant read or read and write, see each assistant and disconnect it at once; every tool call is recorded. Story 16.1 of `epics.md` is the acceptance contract; this spec adds what reading the packages (1.7.7 and 2.2.0, 2026-10-02) settled.

## Boundaries & Constraints

**Always:**
- Versions: catalog `better-auth: ^1.7.7`; `@better-auth/mcp`, `@better-auth/oauth-provider`, `@better-auth/cimd` `^1.7.7` and `@modelcontextprotocol/server` `^2.2.0` in `@archant/api`; `@better-auth/oauth-provider` in `@archant/app` for `oauthProviderClient`. No `@modelcontextprotocol/hono`.
- Plugins in order `admin`, `twoFactor`, `jwt`, `mcp`, `cimd`: `twoFactor` before `mcp`, so its hook expires the cookie before the OAuth continuation runs. `loginPage: "/sign-in"`, `consentPage: "/oauth/consent"`, scopes `archant:read`, `archant:write` and `offline_access` (Better Auth issues a refresh token only for it), `accessTokenExpiresIn: 600`, refresh 30 days, `allowDynamicClientRegistration` and `allowUnauthenticatedClientRegistration` true, `cimd({ fetchClientMetadataResource })` from `@better-auth/cimd/node` (public addresses only, no redirect). `disabledPaths` adds `/oauth2/create-client` and `/oauth2/update-client`.
- Assistants exist only when `BETTER_AUTH_URL` is HTTPS or loopback, because `mcp()` refuses anything else at start-up: otherwise the three plugins are not loaded, `/api/mcp` answers `404`, the server still starts, and « Assistants IA » says HTTPS is required with the link to the docs.
- Token check in process: `verifyJwsAccessToken` from `better-auth/oauth2` with `jwksFetch` reading the key set through `auth.api` (no HTTP, so neither the host's public name nor `HOST` matter, and tests stay offline), audience `${BETTER_AUTH_URL}/api/mcp`, issuer `${BETTER_AUTH_URL}/api/auth`; failures answer through `createResourceServerChallenge` (`401` with `WWW-Authenticate` naming `/.well-known/oauth-protected-resource/api/mcp`). Then one read: the token's `azp` and `sub` still hold a row in `oauth_consents`, else `401`. A cookie alone is `401`. An `Origin` other than `BETTER_AUTH_URL`'s is `403 ORIGIN_MISMATCH`; no `Origin` passes (CLI clients send none).
- One `McpServer` per request, stateless, through `createMcpHandler`; the factory registers only the tools the token's scopes allow; `GET` is `405`. Tools sit in `packages/api/src/mcp/`, one file per resource, follow AD-1 (Zod input, one service call with the route's `deps`, no `db` or Drizzle), return `structuredContent` against an `outputSchema` with `readOnlyHint: true`, amounts as decimal strings with their currency. An `AppError` becomes `isError` with its code and message. Server `instructions` and the descriptions of tools returning bank-written text say it is bank data, never instructions.
- Disconnection: one database transaction deletes the consent, the client's refresh tokens and access tokens for that user, as `invalidateRefreshFamily` does; the client row stays (Better Auth refuses deleting an ownerless client). Archant has one user, so « connected » means « holds a consent ».
- `assistant_calls`: client id, tool, time, outcome code (`OK` or the error code), changed-row count (0 for reads); never arguments or results; rows older than 90 days deleted in the same write, as `purgeStalePreviews` does.
- New tables in `@archant/data`, snake_case, by hand, one migration `0038`: every model the configured plugins declare (`jwks`, `oauth_clients`, `oauth_refresh_tokens`, `oauth_access_tokens`, `oauth_consents`, and the others their `schema` lists), keyed in the adapter as `usePlural` expects (`jwkss`, `oauthClients`…), plus `assistant_calls` indexed on `created_at` and `client_id`.

**Never:** no static token or API key; no session cookie on `/api/mcp`; no tool beyond the four; no `create-client` or `update-client`; no widening of `form-action`; no outbound fetch but CIMD's; no change to `/api/auth/*` sign-in behaviour for a sign-in without an OAuth query.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| No token | `POST /api/mcp` | `401`, challenge header |
| Wrong audience | token for `/api/auth` | `401` |
| Expired | token past `exp` | `401` |
| Disconnected | valid JWT, consent deleted | `401` before any tool |
| Refresh after disconnect | old refresh token | `invalid_grant` |
| Read-only token | `tools/list` | four read tools; a write tool (none yet) absent |
| Foreign origin | `Origin: https://evil.test` | `403 ORIGIN_MISMATCH` |
| HTTP public URL | `BETTER_AUTH_URL=http://nas.lan:8787` | server starts, `/api/mcp` `404`, page explains |
| Service failure | `listAccounts` throws `AppError` | `isError`, code and message, call recorded with that code |

</frozen-after-approval>

## Code Map

- `pnpm-workspace.yaml:12` -- `better-auth` catalog range.
- `packages/api/src/services/auth.ts:20-136` -- `createAuth` deps, plugins `:82-90`, `disabledPaths: ADMIN_PATHS` `:37-53,116` (exact paths), adapter `schema` map `:64-79` (note `auth_accountss`).
- `packages/api/src/app.ts:304-409` -- `compress` `:313` (add `/api/mcp` to `except`), `bodyLimit` `:329` (applies), `sameOrigin` `:338` and `csrf()` `:343` (except `/api/mcp`, `/api/auth/oauth2/token`, `/api/auth/oauth2/revoke`), auth mount `:361-365` (mount `/.well-known/oauth-authorization-server/api/auth` and `/.well-known/oauth-protected-resource/api/mcp` to `deps.auth.handler` beside it, any other `/.well-known/*` a JSON `404`), `/api/mcp` before `requireSession` `:366`, SPA fallback `:371`.
- `packages/api/src/routes/middleware/auth.ts:12-13` -- `PUBLIC_PATHS` gains `/api/mcp`.
- `packages/api/src/routes/middleware/same-origin.ts:19-41` -- reuse its origin comparison for `/api/mcp`.
- Services for tools: `listAccounts` (`services/accounts.ts:96`, groups of `AccountSummary`, flatten with `classification`), `listCategories` (`categories.ts:52`), `listMerchants` (`merchants.ts:40`), `listTags` (`tags.ts:33`); `ServiceDeps` `services/deps.ts:7-16`.
- `packages/data/money.ts:270-293` -- extract the exact decimal string `formatMoney` builds into an exported `toDecimalString`; keep 100 % branches.
- `packages/api/src/lib/errors.ts:7-80` -- add `ASSISTANT_NOT_FOUND: 404`, translated in `fr.json` `errors`.
- `packages/api/src/services/imports.ts:566-573` -- retention pattern.
- `.oxlintrc.json` -- overrides replace each other: a new `mcp/**` override repeats the AD-2 table bans and adds `drizzle-orm`, `drizzle-orm/*`, `@archant/data/client`.
- `packages/data/schema/auth.ts`, `packages/data/package.json` exports, `packages/data/drizzle/` (last `0037`).
- `packages/api/src/testing/{auth,app}.ts` -- `createTestAuth`, `useSignedInApp`; `vitest.setup.ts` fails unmocked requests, so CIMD tests inject a fake `fetchClientMetadataResource` through `createAuth`.
- `packages/app/src/lib/auth-client.ts:10-15` -- add `oauthProviderClient()`; it sends `oauth_query` from `window.location.search` on every non-GET call.
- `packages/app/src/routes/sign-in.tsx:22-24,95-126,189-228` -- search schema keeps unknown keys so the signed query stays in the URL; when a response is `{ redirect: true, url }`, set `window.location.href = url` instead of `completeSignIn`.
- `packages/app/src/routes/oauth.consent.tsx` (new, `OutsideShell`, own session check) -- the `/oauth2/public-client` endpoint through `authClient` for the name and redirect host, `authClient.oauth2.consent({ accept, scope })`, then `window.location.href = url`.
- `packages/app/src/routes/_authed.settings.tags.tsx` -- template for the list page; `ConfirmDialog`; `components/SettingsNav.tsx:9-15`; `components/BankCredentials.tsx:50-80` `RedirectAddress` to extract as a shared copy component; `locales/fr.json`.
- `packages/app/vite.config.ts:59,61` -- proxy `/.well-known` beside `/api`.
- `packages/app/e2e/` -- `two-factor` project (serial, 2FA turned on through the UI, `totp.ts`), `fixtures.ts` `api` and `outsideRequestGuard`, `start-api.ts` (`BETTER_AUTH_URL` is loopback, so assistants are on).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/data/money.spec.ts`, `money.ts` -- `toDecimalString` cases first (negative, zero, 0- and 3-decimal currencies), then extract it.
- [ ] `pnpm-workspace.yaml`, both `package.json` -- versions above; pull request description gives each dependency's reason.
- [ ] `packages/data/schema/oauth.ts`, `schema/assistant-calls.ts`, `package.json`, `pnpm data generate` -- tables and `0038`; a spec compares every plugin `schema` model and field with the adapter map, so an upgrade adding a field fails the gate.
- [ ] `packages/api/src/services/auth.spec.ts`, `services/auth.ts` -- options above and the HTTPS-or-loopback switch; specs for metadata (PKCE `S256`, registration endpoint, CIMD), disabled paths, refresh rotation, consent deletion leaving refresh tokens valid (pins the gap).
- [ ] `packages/api/src/services/assistants.spec.ts`, `assistants.ts` -- `listAssistants` (client name, scopes, consent date, last call), `disconnectAssistant` in one transaction, `holdsConsent(clientId, userId)`.
- [ ] `packages/api/src/services/assistant-calls.spec.ts`, `assistant-calls.ts` -- record and 90-day purge.
- [ ] `packages/api/src/mcp/server.spec.ts`, `mcp/server.ts`, `mcp/{accounts,categories,merchants,tags}.ts` -- handler, token check, consent check, origin, scope filtering, call recording; every matrix row.
- [ ] `packages/api/src/routes/assistants.spec.ts`, `routes/assistants.ts`, `app.ts`, `routes/middleware/auth.ts`, `lib/errors.ts`, `.oxlintrc.json` -- `GET /api/assistants`, `DELETE /api/assistants/:clientId`; middleware and `/.well-known` wiring; `app.spec.ts` covers the passes.
- [ ] `packages/app/src/lib/auth-client.ts`, `routes/sign-in.tsx`, `routes/oauth.consent.tsx`, `routes/_authed.settings.assistants.tsx`, `hooks/useAssistants.ts`, `lib/query-keys.ts`, `components/SettingsNav.tsx`, shared copy component, `locales/fr.json`, `vite.config.ts`.
- [ ] `packages/app/e2e/assistants.spec.ts` in the `two-factor` project -- register a client dynamically, sign in with a TOTP code, untick write, exchange the code with PKCE, `tools/list` shows read tools only, disconnect from « Assistants IA », then the access token (before expiry) and the refresh token are refused. The client's `redirect_uri` is a loopback URL fulfilled by `page.route`.
- [ ] `docs/deployment.md` « Connecting an assistant », `docs/hosting.md`, `docs/security-model.md` (CIMD fetch under « What leaves the server »), `.env.example` nothing new, `EXPERIENCE.md:143` « no assistant chat », `epics.md` Story 16.1 and AD-19 in `docs/architecture.md` -- the key set read in process rather than over loopback, `offline_access`, the HTTPS-or-loopback switch.

**Acceptance Criteria:**
- Given Story 16.1 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given the owner's instance at `https://<machine>.<tailnet>.ts.net`, when Claude Code adds `/api/mcp`, then sign-in, consent and `get_accounts` work (manual check, recorded in Implementation Notes).

## Design Notes

Reading the key set over `http://127.0.0.1:${PORT}` fails when `HOST` names one interface, and breaks the offline test rule; `requireMcpAuth` takes no custom fetch, so the check uses the two public helpers it is built from. A test pins that `requireMcpAuth` and this check refuse the same tokens.

`offline_access` is granted with read and never shown as a choice: without it the assistant signs in again every ten minutes. Whether Claude Code asks for it is unverified; the manual check settles it.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `money.ts` 100 % branches
- `pnpm test:e2e` -- expected: green

## Implementation Notes

## Spec Change Log

## Review Triage Log
