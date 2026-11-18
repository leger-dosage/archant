---
title: 'Story 10.1: Connect a bank'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '34475383c17fab12b898cad23caabc2399222405'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-10-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant can only be fed by files. Before any sync, the household must be able to grant Archant read access to a bank through Enable Banking (FR48).

**Approach:** Port Sure's connect flow (`Provider::EnableBanking`, `EnableBankingItemsController#select_bank/authorize/callback`) behind the `BankConnector` port: a settings page `/reglages/banques` picks a country and a bank, the API starts the authorisation and stores a pending `bank_connections` row keyed by a random `state`, and the browser comes back to a page that posts `code` and `state` to the API, which opens the session and stores it encrypted.

## Boundaries & Constraints

**Always:**
- Env (`env.ts`, `.env.example`, `docker-compose.yml` pass-through): `ENABLE_BANKING_APPLICATION_ID`, `ENABLE_BANKING_PRIVATE_KEY` (base64 of the PEM, PKCS#1 or PKCS#8), `ENCRYPTION_KEY` (base64, must decode to 32 bytes), all optional; `ENABLE_BANKING_API_URL` defaults to `https://api.enablebanking.com`. A present but malformed value fails startup, as for `BETTER_AUTH_SECRET`. Bank connection is available only when the three are set; otherwise every bank route except `setup` answers `503 BANK_CONNECTOR_UNAVAILABLE` and the rest of the app is untouched.
- JWT as in Sure: header `{ typ: "JWT", alg: "RS256", kid: <application id> }`, claims `iss: "enablebanking.com"`, `aud: "api.enablebanking.com"`, `iat`, `exp = iat + 3600`, signed with `jose` from `crypto.createPrivateKey`, one per request.
- Provider calls: `GET /aspsps?country=`, `POST /auth` with `access.valid_until`, `aspsp { name, country }`, `state`, `redirect_url`, `psu_type: "personal"`, `language: "fr"`; `POST /sessions { code }`. Every response is parsed by Zod; unknown keys are dropped.
- `valid_until` = now + min(bank's `maximum_consent_validity`, 90 days), as in Sure. The bank is re-read from `/aspsps` at start, so an unknown name answers `VALIDATION_ERROR`.
- `redirect_url` = `BETTER_AUTH_URL` + `/reglages/banques/retour`. `.env.example` and `docs/deployment.md` say this URL must be registered in the Enable Banking control panel.
- `state` is `crypto.randomUUID()`, stored on the pending row, single use, accepted for 30 minutes. Starting a connection deletes pending rows older than that.
- Stored on success: `session_id` encrypted by `services/crypto.ts` (AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>`), `consent_expires_at` in clear from `access.valid_until` (epoch ms, 10.5 needs to query it), bank name and country, status `active`, `state` cleared.
- API, all session-guarded: `GET /api/bank-connections/setup` → `{ available, missing: string[] }` (variable names, never values); `GET /api/bank-connections/institutions?country=FR` → `{ name, country, logo, bic }[]`; `POST /api/bank-connections` `{ country, institution }` → `{ url }`; `POST /api/bank-connections/callback` `{ code, state }` → the connection; `GET /api/bank-connections` → active connections without any secret.
- Provider failures become sanitised `AppError`s: `BANK_PROVIDER_ERROR` 502, `BANK_REDIRECT_NOT_ALLOWED` 502 with `params: { url }` when the provider answers `REDIRECT_URI_NOT_ALLOWED` (Sure shows the URL to register), `BANK_AUTHORIZATION_INVALID` 400 for an unknown, used or expired `state`. Logs carry the connection id, HTTP status and provider error code only.
- Countries: Sure's 31 codes as a `const` array in `@archant/data`, France first and selected by default, names from `Intl.DisplayNames("fr")`.
- Page: country select, bank list with logo and name filtered by a search field (Sure's `bank-search`), a button per bank that redirects the browser; below, active connections with bank, country and « Consentement valable jusqu'au … ». When unavailable, the page names each missing variable and links to `docs/deployment.md`. The return page shows a spinner, then lands on `/reglages/banques` with a success toast, or shows the translated error; a bank `error` query parameter shows « La banque n'a pas donné son accord. » without calling the API.

**Never:** no account listing or linking (10.2), no sync, no `SYNC_SECRET` handling (10.3), no renewal, revocation or deletion (10.5), no storage of the accounts returned by `POST /sessions`, no `auth_method` or PSU headers, no credentials entered in the interface, no provider payload or session id in logs or responses, no network in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | FR, bank « Banque Test », `maximum_consent_validity` 180 days | `/auth` gets `valid_until` now + 90 days; callback stores an active row, `session_id` starts with `v1:` | — |
| Short consent | `maximum_consent_validity` 30 days | `valid_until` now + 30 days | — |
| Unknown state | callback with a random `state` | nothing written | 400 `BANK_AUTHORIZATION_INVALID` |
| Replayed state | same `state` twice | second call writes nothing | 400 `BANK_AUTHORIZATION_INVALID` |
| Stale state | pending row 31 minutes old | nothing written | 400 `BANK_AUTHORIZATION_INVALID` |
| Not configured | `ENCRYPTION_KEY` unset | `setup` → `{ available: false, missing: ["ENCRYPTION_KEY"] }`; `/api/accounts` still 200 | other bank routes 503 `BANK_CONNECTOR_UNAVAILABLE` |
| Redirect not registered | provider 4xx `REDIRECT_URI_NOT_ALLOWED` | pending row removed | 502 `BANK_REDIRECT_NOT_ALLOWED`, `params.url` |
| Malformed response | `/sessions` without `session_id` | nothing written | 502 `BANK_PROVIDER_ERROR`, no payload in log |
| PKCS#1 key | `BEGIN RSA PRIVATE KEY` | JWT signs and verifies | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/env.ts` -- `validateEnv`; optional vars are `z.string().optional()` with `emptyStringAsUndefined`. `env.spec.ts` spreads a `required` object.
- `packages/api/src/services/deps.ts` (`ServiceDeps { db, timeZone }`), `app.ts` (`AppDeps`, chained `createApi`), `index.ts`, `testing/auth.ts` `buildTestApp` -- add `bankConnector: BankConnector | null`, `encryptionKey`, `bankSetup` (missing names), `redirectUrl`; `buildTestApp` must pass them too.
- `packages/api/src/connectors/file-source.ts`, `registry.ts` -- model for the new `connectors/bank-connector.ts` port (`id`, `listInstitutions`, `startAuthorization`, `completeAuthorization` only; later stories add the rest). Register `enable-banking` in `registry.ts`. `connectors/**` needs 100 % branches (`vitest.config.ts`).
- `packages/api/src/lib/errors.ts` `ERROR_STATUSES` and `packages/web/src/locales/fr.json` `errors.*` -- add the three codes on both sides.
- `packages/api/src/routes/middleware/auth.ts` -- `PUBLIC_PATHS` stays as is: the callback is a session-bearing POST from the SPA.
- `packages/api/src/routes/recurring.ts`, `services/recurring.ts`, `schemas/recurring.ts` -- route/service/schema pattern (`zValidator` + `validationError`, `{ data }`).
- `packages/api/vitest.setup.ts` -- msw `server`; use `server.use(...)` per test with fixtures under `connectors/enable-banking/fixtures/`.
- `packages/data/schema/recurring-transactions.ts`, `schema/check.ts` `inList`, `types.ts`, `package.json` `exports`, `migrate.spec.ts` -- table conventions; `pnpm --filter @archant/data generate --name add_bank_connections` gives `0026_*`.
- `packages/web/src/routes/_authed.reglages.tsx` `SECTIONS` -- add Banques first; `hooks/useRecurring.ts`, `lib/query-keys.ts`, `lib/error-toast.ts` -- query and error patterns.
- `packages/web/e2e/start-api.ts` -- env of the 8788 server; `e2e/recurring.spec.ts`, `e2e/fixtures.ts` -- spec pattern.
- Sure: `~/github/sure/app/models/provider/enable_banking.rb` 27–88 and 250–268, `app/controllers/enable_banking_items_controller.rb` 100–227.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts`, `schema/bank-connections.ts`, `bank-countries.ts`, `types.ts`, `package.json`, `drizzle/0026_*` -- failing tests for the status check and the unique `authorization_state`, then `bank_connections` (`id`, `connector` check `enable-banking`, `institution_name`, `country`, `status` check `pending|active`, `authorization_state` nullable unique, `session_id` nullable, `consent_expires_at` nullable, `created_at`, `updated_at`) and `BANK_COUNTRIES`.
- [x] `packages/api/src/env.spec.ts`, `env.ts`, `.env.example`, `docker-compose.yml` -- the four variables, malformed key and wrong-length `ENCRYPTION_KEY` rejected.
- [x] `packages/api/src/services/crypto.spec.ts`, `crypto.ts` -- round trip, `v1:` format, fresh IV per call, tampered tag rejected.
- [x] `packages/api/src/connectors/enable-banking/*.spec.ts`, `jwt.ts`, `schemas.ts`, `client.ts`, `fixtures/*.json`, `connectors/bank-connector.ts`, `registry.ts` -- JWT header and claims for PKCS#1 and PKCS#8 keys, each endpoint against msw fixtures, the `valid_until` cap, error mapping. Add `jose` to `@archant/api`.
- [x] `packages/api/src/services/bank-connections.spec.ts`, `bank-connections.ts`, `schemas/bank-connections.ts`, `lib/errors.ts` -- every matrix row but PKCS#1; no secret in the list; a log capture holds no session id.
- [x] `packages/api/src/routes/bank-connections.ts`, `app.ts`, `index.ts`, `testing/auth.ts`, `app.spec.ts` -- routes, deps, 401 without session, 503 when unavailable while `/api/accounts` answers.
- [x] `packages/web/e2e/fake-enable-banking.ts`, `start-api.ts` -- a `node:http` fake serving `/aspsps`, `/auth` (returns a URL that redirects to `redirect_url` with `code` and `state`) and `/sessions`; the server gets a generated key, an application id, a random `ENCRYPTION_KEY` and `ENABLE_BANKING_API_URL`.
- [x] `packages/web/src/routes/_authed.reglages.banques.tsx`, `_authed.reglages.banques.retour.tsx`, `_authed.reglages.tsx`, `hooks/useBankConnections.ts`, `lib/query-keys.ts`, `locales/fr.json` -- the two pages.
- [x] `packages/web/e2e/bank-connections.spec.ts` -- connect end to end through the fake; search filters the list; France preselected; missing variables shown (`page.route` on `setup`); bank refusal message.
- [x] `docs/deployment.md` -- generating the key pair and `ENCRYPTION_KEY`, registering the redirect URL, losing the key means reconnecting.

**Acceptance Criteria:**
- Given the variables set, when I open Banques, then France is selected and its banks are listed with a search field.
- Given I choose a bank, when I approve at the bank, then I land on Banques with the connection and its consent end date, and the database holds an encrypted `session_id`.
- Given `ENCRYPTION_KEY` missing, when I open Banques, then the page names it, and accounts, transactions and imports still work.

## Implementation Notes

- The return page is `_authed.reglages.banques_.retour.tsx`: with the name the Code Map gives, TanStack Router would nest it inside the bank list, which has no `<Outlet />`. The URL is unchanged, `/reglages/banques/retour`.
- The closed union gains four codes, not three: `BANK_CONNECTOR_UNAVAILABLE` (503) sits beside the three the Code Map names, since the matrix requires it.
- `ENABLE_BANKING_API_URL` is validated as an http(s) URL; `ENABLE_BANKING_PRIVATE_KEY` is parsed into a `KeyObject` and `ENCRYPTION_KEY` into a `Buffer` at startup, so a malformed value fails there.
- `/reglages` still opens Catégories: opening the settings must not call the provider.
- Review: the pending cleanup filters on `updatedAt`, which the callback's claim bumps, so a claimed row is never deleted while the provider opens its session; a blank `ENABLE_BANKING_APPLICATION_ID` fails startup; an e2e test shows the redirect URL in the `BANK_REDIRECT_NOT_ALLOWED` toast. Comments no longer say PSD2 caps a consent at 90 days: the cap is Sure's choice.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| Pending cleanup can delete a row claimed near minute 30 while `/sessions` runs (edge, blind) | low | Cleanup filters `createdAt`, claim bumps only `updatedAt`. Patch: filter on `updatedAt`. |
| Session opened but `encrypt`/final update fails leaves an orphan (edge, blind) | low | `encrypt` cannot fail with a validated 32-byte key; a failed SQLite update after a successful one is not reachable in practice. Rejected: fix adds guards. |
| `row === undefined` answers `BANK_AUTHORIZATION_INVALID` after consent (edge) | low | Only reachable through the cleanup race, fixed above. Rejected. |
| Whitespace `ENABLE_BANKING_APPLICATION_ID` counts as configured (edge, blind) | low | `z.string().optional()` accepts `"  "`. Patch: `.trim().min(1)`. |
| No test shows `params.url` in the `BANK_REDIRECT_NOT_ALLOWED` toast (verification) | medium | Searched web specs and e2e, none. Patch: e2e test. |
| `/reglages` index comment says it opens the first section (verification) | low | Banques is now first; redirect targets Catégories on purpose. Patch: comment. |
| Compose pass-through of bank variables unverified (verification) | medium | CI `image` job sets no bank variable. Deferred. |
| Duplicate active connections to one bank (blind) | false | Sure allows several connections; intent follows Sure. |
| `psu_types` ignored, business-only bank fails (blind) | low | Real, but a French household's banks offer `personal`; fix adds a filter branch. Rejected. |
| `required_psu_headers` ignored (blind) | false | Only data calls need PSU headers (Sure); the intent excludes them. |
| Two banks with the same name (blind, edge ×2) | false | Enable Banking identifies an ASPSP by name and country in `/auth`; names are unique per country. |
| Abandoned pending rows linger until next start (blind) | low | Harmless rows without secrets. Rejected. |
| Existing connections hidden when a variable is removed (blind) | low | The frozen intent makes every route but `setup` answer 503. Rejected. |
| `jose` added without justification (blind) | false | The architecture spine (AD-18) names `jose`; the pull request states why. |
| Consent date in browser time zone; e2e near midnight (blind) | low | Household shares the server's zone; Playwright fixes it. Rejected. |
| Missing API tests: route-level provider failure, base64url key (blind) | low | Service tests cover the failure; `z.base64()` refuses base64url, which is correct. Rejected. |
| Refusal leaves pending row, generic refusal text (blind) | low | Cleaned on the next start; the spec asks for one message. Rejected. |
| Diff omits lockfile and generated files (blind) | false | Excluded on purpose from the review diff; they are generated. |
| `http://` provider URL accepted in production (blind) | low | Only an operator can set it. Rejected. |
| RSA key under 2048 bits gives a 500 (edge) | low | Enable Banking issues 2048-bit keys or more. Rejected: adds a check. |
| `BETTER_AUTH_URL` with a path loses it (edge) | false | `env.ts` refuses anything but an origin. |
| Cleanup delete throwing masks the provider error (edge) | low | Unlikely; rejected. |
| Timeout while reading a 2xx body logs status 200 (edge) | low | Log still says the call failed; rejected. |
| `valid_until` already past stored as active (edge) | low | Provider contract violation; rejected. |

## Design Notes

The callback lands on an SPA page rather than an API `GET` because a `GET` that writes needs its own CSRF reasoning, and the SPA already translates `errors.<CODE>` and shows toasts. The session cookie reaches the POST since the bank redirects to the same origin as `BETTER_AUTH_URL`.

Fixtures are written from the Enable Banking API reference, not recorded: no credentials exist in this repository. Each fixture keeps only fields the Zod schemas read, anonymised, so swapping in a recorded response later changes no test.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, 100 % branches on `connectors/**`.
- `pnpm test:e2e` -- expected: green, no request leaves loopback.
