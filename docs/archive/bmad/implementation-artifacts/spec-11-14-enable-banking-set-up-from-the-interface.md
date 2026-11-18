---
title: 'Story 11.14: Enable Banking set up from the interface'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: '9db47e42d8170f362c1c3b83e8c03ab9c8050935'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Connecting a bank needs `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY` on the server, a base64 PEM, and a restart (manual QA C1, 2026-09-25). A household should never edit a server file to connect a bank.

**Approach:** « Réglages › Banques » lists Sure's steps and takes the application ID and the `.pem` file. The server checks them with Enable Banking, stores the key encrypted in `settings`, and resolves the connector per request, the environment winning. `ENCRYPTION_KEY` stays a variable.

## Boundaries & Constraints

**Always:**
- Steps as Sure's panel (`settings/providers/_enable_banking_panel.html.erb`): create an application on the Enable Banking portal (link), register the redirect address the server derives (`REDIRECT_PATH` on `BETTER_AUTH_URL`) with a copy button, enter the application ID and upload the `.pem`. No country field: Archant asks for it when connecting.
- The browser reads the file and sends its text as JSON. The server parses it with `createPrivateKey` (PKCS#1, PKCS#8, a key bundled with its certificate) and stores it re-exported as PKCS#8 PEM, encrypted with `services/crypto.ts`. The application ID is stored plain, as Sure does: it names the key and signs nothing.
- The check is `GET /application` signed with the submitted pair, before anything is written. 401 or 403 is `BANK_CREDENTIALS_REFUSED`; a `redirect_urls` list without the derived address is `BANK_REDIRECT_NOT_ALLOWED` with `params.url`, the mistake `/auth` otherwise reports only at the first connection.
- `GET /api/bank-connections/setup` answers `{ available, source: "environment" | "interface" | null, applicationId, redirectUrl, locked, missing }`, never the key. `missing` can only hold `ENCRYPTION_KEY` now.
- Setting only one of the two `ENABLE_BANKING_*` variables stops the server at startup naming the other, as a malformed value already does (Story 11.9).
- Locked means an `active` row in `bank_connections`, as Sure locks on an authenticated session; a `pending` row is a consent in flight and does not lock. Sure locks in the view only; here the server refuses too (`BANK_CREDENTIALS_LOCKED`, 409). The page then shows Sure's warning and disables the form.
- With `ENCRYPTION_KEY` absent, the page says so and links `#connecting-a-bank`; saving answers `BANK_CONNECTOR_UNAVAILABLE`. Stored credentials that no longer decrypt read as unconfigured and log only the code.
- Every service that called `requireBankConnector` resolves the connector at call time, never from a value captured at boot.

**Never:** no country, no removal action (Sure has none; disconnecting unlocks), no credentials in a log, an error or a response, no cache shared across requests, no new dependency, no change to the consent flow, no `ENCRYPTION_KEY` rotation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First setup | no credentials, `ENCRYPTION_KEY` set | steps, redirect address with copy button, ID field, file input | N/A |
| Save | valid ID and `.pem`, address registered | stored encrypted; page shows the country picker | N/A |
| Refused | wrong key or ID | nothing stored | « errors.BANK_CREDENTIALS_REFUSED » in the form |
| Address missing | valid pair, address not in `redirect_urls` | nothing stored | message naming the address |
| Not a key | text file | nothing stored | `VALIDATION_ERROR`, field `privateKey` |
| No encryption key | `ENCRYPTION_KEY` unset | explanation, link to `#connecting-a-bank`, no form | save answers 503 |
| Environment | both variables set | « configuré par le serveur », ID shown, no form | `PUT` answers `BANK_CREDENTIALS_FROM_ENVIRONMENT` 409 |
| Locked | one `active` connection | warning, form disabled | `PUT` answers 409 |
| Half set | one `ENABLE_BANKING_*` variable | server does not start, output names the other | N/A |

</frozen-after-approval>

## Code Map

- `packages/api/src/env.ts:89-121` -- the two optional variables; add the both-or-neither refinement.
- `packages/api/src/services/bank-connections.ts:50-141` -- `BankConnectionDeps.bankConnector`, `bankDepsFromEnv`, `bankSetup`, `requireBankConnector`; ten call sites here and three in `services/sync.ts`. `REDIRECT_PATH` at :41.
- `packages/api/src/routes/bank-connections.ts:29-41` -- `/setup` and the gating middleware; the new `PUT /credentials` is registered before the middleware.
- `packages/api/src/connectors/bank-connector.ts:80-133` -- `BankConnector` port, `BankProviderError`; `connectors/enable-banking/client.ts` `call` (:321) and `createEnableBankingConnector` (:362); `jwt.ts` untouched.
- `packages/api/src/services/crypto.ts` -- `encrypt(key, text)`, `decrypt(key, stored)`, reused as is.
- `packages/data/schema/settings.ts` -- key-value table; no migration.
- `packages/api/src/lib/errors.ts` -- `ERROR_STATUSES`.
- `packages/api/src/testing/enable-banking.ts`, `testing/bank.ts`, `testing/auth.ts:33-66` (`NO_BANK`, `buildTestApp`), `app.spec.ts:6714-6880` -- msw fixtures and bank app builders.
- `packages/app/src/routes/_authed.settings.banks.tsx` -- `Unavailable` (:78-102), `BanksPage` (:308-371), `DEPLOYMENT_GUIDE`.
- `packages/app/src/hooks/useBankConnections.ts:28`, `lib/query-keys.ts:67-72` -- `useBankSetup`; its "never change" comment becomes wrong.
- `packages/app/src/components/ImportDialog.tsx:540-589` -- file input pattern to follow.
- `packages/app/e2e/start-api.ts:22-56`, `fake-enable-banking.ts` (:172-193 token check, :271 `/aspsps`), `auth.setup.ts`, `bank-connections.spec.ts:176-191`.
- `docs/deployment.md:37-39, 109-160`, `.env.example:55-75`, `docker-compose.yml:28-30`, `ARCHITECTURE-SPINE.md` :170 and :208, `docs/sure-parity.md` Enable Banking table.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/env.spec.ts` -- half-set pair fails naming the other; then `env.ts`.
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts`, `client.ts`, `bank-connector.ts`, `testing/enable-banking.ts` -- `describeApplication()` reading `GET /application` into `{ redirectUrls }` through Zod; msw fixture.
- [x] `packages/api/src/services/bank-credentials.spec.ts`, `bank-credentials.ts` -- `resolveBankConnector(deps)` (environment, else decrypted `settings`, else `BANK_CONNECTOR_UNAVAILABLE`), `bankSetup(deps)`, `saveBankCredentials(deps, input)` with the order: parse key, check lock, call `/application`, write both rows in one transaction. Cover every matrix row and a log line holding no key.
- [x] `packages/api/src/services/bank-connections.ts`, `services/sync.ts` -- deps carry env credentials, `encryptionKey`, `apiUrl`, `redirectUrl`; every `requireBankConnector` becomes `await resolveBankConnector`.
- [x] `packages/api/src/schemas/bank-connections.ts`, `routes/bank-connections.ts`, `lib/errors.ts`, `app.spec.ts` -- `PUT /credentials`, the new setup shape, codes `BANK_CREDENTIALS_REFUSED` (400), `BANK_CREDENTIALS_LOCKED` and `BANK_CREDENTIALS_FROM_ENVIRONMENT` (409).
- [x] `packages/app/e2e/start-api.ts`, `fake-enable-banking.ts`, `auth.setup.ts` -- the e2e server drops both `ENABLE_BANKING_*` variables; the fake serves `/application`; the key goes to `e2e/.auth/enable-banking.pem` and `setup` saves it through `PUT`, so every bank test runs on interface-stored credentials.
- [x] `packages/app/e2e/bank-connections.spec.ts` -- steps and copy button, wrong key refused, right key saved, locked with a connection, and through `page.route` the environment and no-`ENCRYPTION_KEY` pages. Written before the interface.
- [x] `_authed.settings.banks.tsx`, `useBankConnections.ts`, `query-keys.ts`, `locales/fr.json` -- setup panel, read-only environment card, lock warning, error translations; saving invalidates `setup`.
- [x] `docs/deployment.md`, `.env.example`, `ARCHITECTURE-SPINE.md`, `docs/sure-parity.md`, `epic-11-context.md` -- interface first under `## Connecting a bank`, variables as the override; parity row « Credentials ».

**Acceptance Criteria:**
- Given the finished story, when `grep -rn "bankConnector:" packages/api/src` runs, then no dependency object captures a connector at boot.
- Given the finished story, when the AGENTS.md verification gate and `pnpm test:e2e` run, then all pass and no tracked file changes.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Route | Evidence |
|-------|---------|---------|-------|----------|
| blind, edge, gap | Credentials that no longer resolve with an active bank lock the page and 503 every route, disconnect included | medium | defer | `disconnectConnection` needed a connector since Spec 10.5; `docs/deployment.md` wrongly promised the form comes back, patched |
| blind | Removing the `ENABLE_BANKING_*` variables with a bank connected hits the same lock | medium | patch (docs) | same root; `docs/deployment.md` now says to disconnect first |
| blind, edge | A `pending` consent completes against a changed pair and fails | low | reject | the frozen intent chose Sure's lock on authenticated sessions; the failure is a translated provider error |
| edge | `completeConnection` racing a save may activate a session of the old application | low | reject | seconds-wide window on a single-household server; a guard adds a cross-service check |
| blind | Middleware and service resolve the connector twice per request | low | reject | one settings read, a decrypt and a key parse, next to a network call |
| blind, edge | `BANK_CREDENTIALS_UNREADABLE` logged on every resolve | low | reject | log noise only in a broken state; carries no secret |
| blind | Raw SQL in the upsert | false | reject | the same Drizzle `sql` `excluded` helper is used in `services/bank-connections.ts:38` |
| blind | Environment card lacks the redirect address | medium | patch | a self-hoster pinning the pair must still register it |
| blind | `.env.example` claims saving is refused for the environment pair; over-wide line | low | patch | direct correction |
| blind, gap | No e2e test of the form naming a missing redirect address | medium | patch | verification gap: swapping `errorMessage` for the bare code keeps the suite green |
| blind | `BANK_REDIRECT_NOT_ALLOWED` answers 502 for a user mistake | low | reject | the frozen intent reuses the code for its translation |
| blind | e2e tests depend on file order | low | reject | `workers: 1` and the ordered projects are the suite's documented design |
| blind | `NO_BANK` repeats the default API URL | low | reject | test-only constant, no divergence observed |
| blind | Hard-coded ids, no client size cap, encrypted PEM message | low | reject | form renders once; the server caps size; rare |
| blind | e2e key file written 0644 | low | patch | direct correction, `mode: 0o600` |
| edge | RSA key under 2048 bits makes `jose` throw a 500 | low | reject | Enable Banking's portal issues 2048-bit keys |
| edge | Unknown application ID may return a 4xx other than 401/403 | maybe-false | defer | needs one sandbox call |
| blind | Spec `in-review` while sprint status says `in-progress` | false | reject | the workflow keeps the sprint at `in-progress` until done |

## Design Notes

Resolving per request costs one `settings` read, a decrypt and a `createPrivateKey`, next to a network call to the bank; a cache would need invalidating across instances on a hosted Turso deployment. The environment still wins because a self-hoster who pins secrets in a vault must not be overridden by a click.

## Verification

**Commands:**
- `pnpm test` -- expected: pass, branch coverage unchanged on `connectors/**`.
- `pnpm test:e2e` -- expected: pass.
