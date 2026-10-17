---
title: "Story 29.1: Choose the bank's country with the credentials, and remove them, as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'd057348f28958d9c33578712d27ce6ce0ee0234b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's Enable Banking panel (`settings/providers/_enable_banking_panel.html.erb`) asks « Pays » first, opened on « Sélectionner le pays... », beside the application ID and the certificate, and saves it with them; `select_bank` and `authorize` read that `country_code`, so connecting lists the country's banks at once. Its « Supprimer » (`destroy`) runs `unlink_all!`, `revoke_session` and `destroy_later`. Archant saves no country, asks it on the page before every connection, and offers no way to remove the credentials.

**Approach:** The country becomes a third credential, a `settings` row saved and read with the pair, or `ENABLE_BANKING_COUNTRY` beside the two `ENABLE_BANKING_*` variables. The server reads it for the bank list and the authorisation; the page loses its country select. A `DELETE` on the credentials disconnects every bank, then deletes the three rows.

## Boundaries & Constraints

**Always:**
- `enable_banking_country` in `settings`, one of `BANK_COUNTRIES`. Stored credentials without a readable country count as none, as Sure's `credentials_configured?`.
- `PUT /api/bank-connections/credentials` takes `country` (required) and `applicationId` with `privateKey`, both or neither. Both: today's check with the provider, refused while a bank is active (`BANK_CREDENTIALS_LOCKED`). Neither: the country alone, over stored credentials, allowed while a bank is active, since Sure's country select is never disabled and each Archant connection keeps its own country; without stored credentials, `VALIDATION_ERROR` on `applicationId` and `privateKey`. The environment's credentials refuse both (`BANK_CREDENTIALS_FROM_ENVIRONMENT`).
- `GET /setup` returns `country`, `null` when none applies. `GET /institutions` and `POST /` take no country: they read it with the credentials, as `select_bank` and `authorize`. Renewal keeps the connection's own country.
- `ENABLE_BANKING_COUNTRY`, optional, one of `BANK_COUNTRIES`, `FR` when unset; any other value stops the server at startup. Listed in `.env.example`.
- Migration 0085 writes `enable_banking_country` where an application ID is stored: the country of the latest connection, else `FR`.
- `DELETE /api/bank-connections/credentials`, before the connector guard: each active connection is disconnected through `disconnectConnection` (session revoked, accounts kept as manual), pending attempts are deleted, then the three rows. A running sync answers `SYNC_IN_PROGRESS` and leaves the credentials. Environment credentials refuse it. Returns the new setup.
- Form, saved from the interface: « Pays » first, a select of the 31 countries named `<French name> (<code>)` in French alphabetical order, placeholder « Sélectionner le pays... »; then the lock warning, the application ID, the key file. While locked, only the ID and the file are disabled. Saved credentials make the file optional: without a file, only the country is sent; a changed ID still needs the file. « Supprimer » beside « Enregistrer » once credentials are saved, confirmed by « Voulez-vous vraiment supprimer cette connexion ? » saying every bank is disconnected and its accounts kept as manual ones; afterwards the empty form shows.
- Environment credentials: the panel names the country and offers no form and no « Supprimer ».
- « Connecter une banque » keeps only « Choisir une banque »; the picker lists the saved country's banks.
- `docs/sure-parity.md` « Credentials » and « Connect, choose country and bank » become Parity; `docs/deployment.md`, `docs/security-model.md` and AD-14 follow.

**Never:** no country chosen per connection; no country on the connection's page; no change to consent, sync or unlink behaviour (other Epic 29 stories); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First save | `BE`, ID, key | three rows stored; setup `country: "BE"` | none |
| Country only | `DE`, saved credentials, a bank active | country stored; ID and key unchanged | none |
| Country only, nothing saved | `DE` | nothing written | `VALIDATION_ERROR` `applicationId`, `privateKey` |
| ID without key | `FR`, ID | nothing written | `VALIDATION_ERROR` `privateKey` |
| Unknown country | `US` | nothing written | `VALIDATION_ERROR` `country` |
| Bank list | saved `BE` | `/aspsps?country=BE` | none |
| Remove | two active banks, one pending | sessions revoked, accounts manual, every connection and the three rows gone | none |
| Remove during a sync | lease held | credentials kept | `SYNC_IN_PROGRESS` |
| Remove, environment | `ENABLE_BANKING_*` set | nothing removed | `BANK_CREDENTIALS_FROM_ENVIRONMENT` |
| Environment country | `ENABLE_BANKING_COUNTRY` unset | `FR` | invalid value fails startup |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/bank-credentials.ts` -- `COUNTRY_SETTING`; `BankCredentials` gains `country`; `storedCredentials`, `bankSetup` (`country`), `saveBankCredentials` (country-only branch), new `removeBankCredentials`.
- `packages/api/src/services/bank-connections.ts` -- `bankDepsFromEnv` reads `ENABLE_BANKING_COUNTRY`; `listInstitutions(deps)` and `startConnection` read the country from `resolveBankConnector`; `disconnectConnection` reused as is.
- `packages/api/src/env.ts` -- `ENABLE_BANKING_COUNTRY`; `.env.example`.
- `packages/api/src/schemas/bank-connections.ts` -- `saveBankCredentialsSchema` (country, pair both or neither); drop `institutionsQuerySchema` and `country` from `startConnectionSchema`.
- `packages/api/src/routes/bank-connections.ts` -- `DELETE /credentials` registered before `DELETE /:id` and before the guard.
- `packages/data/drizzle/0085_*.sql` -- `pnpm data generate --custom`; test in `packages/data/migrate.spec.ts` « bank connections ».
- `packages/app/src/components/BankCredentials.tsx`, `routes/_authed.settings.banks.tsx`, `components/BankPickerDialog.tsx`, `hooks/useBankConnections.ts`, `lib/query-keys.ts`, `locales/fr.json`.
- Tests: `services/bank-credentials.spec.ts`, `services/bank-connections.spec.ts`, `routes/bank-connections.spec.ts`, `env.spec.ts`, `testing/app.ts` (`linkedConnection` posts no country); `app/e2e/bank-connections.spec.ts`, `auth.setup.ts` (saves `FR`), `proportions.spec.ts` mock.
- Docs: `docs/sure-parity.md` rows 115-116, `docs/deployment.md` « Connecting a bank », `docs/security-model.md` `/aspsps` row, `docs/architecture.md` AD-14 and the configuration row.
- Sure, read-only, at `00dd977fb`: `app/views/settings/providers/_enable_banking_panel.html.erb`, `app/controllers/enable_banking_items_controller.rb` (`destroy`, `select_bank`, `authorize`), `app/models/enable_banking_item.rb`, `config/locales/views/settings/fr.yml` `enable_banking_panel`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: credentials service (saved country, country-only while locked, refusals, removal with revocation, pending deletion, sync lease, environment), routes (`/institutions` and `POST /` read the saved country, `DELETE /credentials`, viewer refused), env, migration 0085.
- [x] Schema, env, migration, services, routes.
- [x] Hooks, form, page, picker, locales.
- [x] Playwright: save with « Belgique (BE) », the picker lists Belgian banks with no country asked; with a bank connected, change the country alone; remove, the account stays manual and the form is empty; restore `FR` credentials.
- [x] Docs and parity rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and the form is screenshotted light and dark, desktop and phone width, beside Sure's panel.

## Implementation Notes

- `removeBankCredentials` lives in `services/bank-connections.ts`, not `services/bank-credentials.ts`: it calls `disconnectConnection`, and `bank-connections.ts` already imports `bank-credentials.ts`, so the other placement is an import cycle that `import/no-cycle` refuses. `bank-credentials.ts` exports the two pieces it needs, `assertRemovable` and `deleteStoredCredentials`.
- Removal refuses up front when any active connection holds a fresh sync lease, before disconnecting any, so a running sync leaves every bank and the credentials as they were.
- A country-only save over a stored key that no longer decrypts answers the same `VALIDATION_ERROR` as nothing saved: such credentials count as none.
- Logs name neither the country nor the application ID (AD-14).
- Screenshots of the form, light and dark, desktop and 390 px, taken from the e2e server; Sure's panel was compared from its ERB and `fr.yml`, not run.

## Spec Change Log

- Review: removal refuses with `BANK_CREDENTIALS_LOCKED`, credentials kept, when a pending attempt turned active while the banks were being disconnected; the frozen matrix names only `SYNC_IN_PROGRESS` and the environment. Known-bad state avoided: an active connection whose session can no longer be revoked. KEEP: banks disconnected before the rows go.
- Review: migration 0085 takes the latest active connection's country before a newer pending attempt's; the frozen text says « the latest connection ». Known-bad state avoided: an abandoned attempt in another country choosing the saved country.
- Review: while a bank is locked and no readable credentials are saved, the country select and « Enregistrer » are disabled too, since nothing can be saved then.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A pending attempt activated by the callback during removal survives as an active connection with its credentials deleted | medium | patch | `removeBankCredentials` reads active rows once; the final transaction deletes only `pending` rows. |
| 2 | A sync leased mid-loop leaves some banks disconnected and the credentials kept, answering `SYNC_IN_PROGRESS` | low | reject | Each bank disconnected is final and correct; pressing « Supprimer » again finishes, as Sure's per-item `destroy`. |
| 3 | Unreadable stored credentials show no « Supprimer » | low | reject | The setup cannot tell unreadable rows from none without a new field; disconnecting the banks then saving new credentials overwrites them. |
| 4 | « Enregistrer » enabled while locked with nothing readable saved, producing errors on disabled fields | low | patch | `submit` disabled only on `pending` now. |
| 5 | Migration 0085 may take an abandoned pending attempt's country | low | patch | Its subquery ignores `status`. |
| 6 | A pinned install outside France lists French banks after upgrade until `ENABLE_BANKING_COUNTRY` is set | medium | patch | The page asked the country before; it no longer does. Documented in `docs/deployment.md`; the pull request carries `breaking-change`. |
| 7 | `docs/deployment.md` omits removal among the routes answering without `ENCRYPTION_KEY`, untested | low | patch | The route sits before the guard. |
| 8 | The picker shows the cached country while the server reads its own | low | reject | Only another tab changing the country meanwhile reaches it; the next setup read realigns. |
| 9 | E2e tests changing the shared country have no `finally` | low | reject | They restore `FR` on success; a failure already fails the run. |
| 10 | `saveCountry` checks then writes outside a transaction | false | reject | A country row alone counts as no credentials (`storedCredentials` wants all three) and the next save overwrites it. |
| 11 | `isBankCountry` duplicated in API and interface | low | patch | One guard belongs beside `BANK_COUNTRIES`. |
| 12 | Spec Code Map and Implementation Notes disagree on where removal lives; statuses out of step | false | reject | The notes record the move; statuses move to done together. |
| 13 | A file left selected after a pair save resends the pair once a bank locks the form | low | patch | The form keeps its key when ID and country are unchanged. |
| 14 | Removal does not drop cached connection detail queries | low | reject | It invalidates the list, setup, accounts and transactions, as `useDisconnectBankConnection`. |
| 15 | No viewer test for `DELETE /credentials` | low | patch | Added beside the other role checks. |
| 16 | No test of a key sent without its application ID | low | patch | The schema's first `superRefine` branch was unexercised. |
| 17 | No interface test of removal's cache invalidations | low | reject | Same pattern as `useDisconnectBankConnection`; the server state is asserted. |
| 18 | No interface test of a refused removal | low | reject | The server refusal is tested; the catch reuses `showFailureToast`. |
| 19 | `ENABLE_BANKING_COUNTRY` comment claims a pinned install keeps its banks | low | patch | Untrue outside France; reworded. |
| 20 | `.env.example` says the country is read only with the pair | low | patch | `validateEnv` validates it always. |
| 21 | `docs/security-model.md` names only a disconnection as cause of `DELETE /sessions/{id}` | low | patch | Removal revokes each session too. |
| 22 | Readable pair with a missing country cannot be repaired while a bank is active | low | reject | Migration 0085 writes the country wherever an ID is stored; only a hand-edited database reaches it. |
| 23 | `upsert` names a row builder | low | patch | Renamed `settingRow`. |
| 24 | Verbless sentence in `removeBankCredentials`'s comment; uneven doc comments | low | patch | Direct correction. |
| 25 | « Pays » enabled while locked with nothing readable saved | low | patch | Nothing can be saved in that state. |
| 26 | Removal's e2e wait reads `"syncing":true` from a string | low | reject | The response shape is the app's own and stable; the test fails loudly on a timeout. |
| 27 | Keyboard path to the country select untested | low | reject | It is a stock shadcn `Select`, keyboard-tested by Radix; the picker's keyboard test stays. |
| 28 | `DELETE /credentials` on a fresh install answers 200 | false | reject | Removing nothing is idempotent and harmless, as `deleteStoredCredentials` deletes no row. |
| 29 | `docs/deployment.md` tells history | low | patch | Current rule only. |
| 30 | Migration filter on unknown countries untested | low | reject | `IN` list mirrors `BANK_COUNTRIES`; the `FR` fallback is tested. |
| 31 | A callback completing while removal deletes its pending row leaves a provider session unrevoked | low | defer | Pre-existing with the 30-minute cleanup in `startConnection`; the session lapses at its consent end. |
| 32 | Cached bank list survives removal or a new pair | low | patch | Another application may list other banks for an hour. |
| 33 | Removal over an expired lease untested | low | patch | The pre-check's `LEASE_MS` bound was unexercised. |
| 34 | Key rotation with the saved ID untested in the form | medium | patch | Simplifying `countryOnly` would drop a new key silently. |
| 35 | Removal's cache invalidations untested | low | reject | Carried from row 17. |
| 36 | `BANK_CREDENTIALS_LOCKED` from removal is not in the matrix | low | reject | Recorded in the Spec Change Log; it keeps a session revocable. |
| 37 | Migration prefers an active connection over the latest | low | reject | Recorded in the Spec Change Log (row 5). |
| 38 | Screenshots not in the diff | false | reject | Taken under `.agents/qa/29.1/`, never committed, posted on the pull request. |

## Design Notes

Assumptions taken alone, each settled by Sure. The story locks the country with the credentials; Sure's panel disables only `application_id` and `client_certificate`, and its `update` saves the country alone, so the country stays editable. Sure's options read « France (FR) »; Archant names them in French with the code. Sure has no environment credentials: `ENABLE_BANKING_COUNTRY` completes the pinned pair, `FR` by default, the country the page opened on; a pinned install outside France sets it once. Sure's « Supprimer » sits on each item row because each item holds its credentials; Archant holds one set, so the button sits on the form and disconnects every bank. Removal deletes the connections at once rather than through Sure's `destroy_later` job: Archant has no job queue and `disconnectConnection` is already synchronous.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
