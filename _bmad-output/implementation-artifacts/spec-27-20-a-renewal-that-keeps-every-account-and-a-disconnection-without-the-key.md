---
title: "Story 27.20: A renewal that keeps every account, and a disconnection without the key"
type: 'bugfix'
created: '2026-10-12'
status: 'done'
baseline_commit: 'ac51573f8c699ad5cf5e8a370f20d9d7137982fb'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A renewal whose session leaves out a linked account, absent or unreadable, sets `bank_accounts.listed` to false, and the sync then skips that account without a word, where Sure's `linked_accounts_query` reads every linked account of a visible account. And when `ENCRYPTION_KEY` is lost or changed, or the stored credentials no longer resolve, every bank route answers 503 `BANK_CONNECTOR_UNAVAILABLE`, disconnection and the connection list included, so the credentials stay locked behind connections nobody can remove; Sure's `revoke_session` does `return unless provider` and deletes anyway. Sure read at `origin/main` `275f2f994`.

**Approach:** Drop `listed`: a renewal keeps every stored bank account and its link, refreshing the uid of those it lists, and the sync reads each linked account of an active account under its last uid, a failure being that account's error. Let listing, reading a connection's bank accounts and disconnecting work without a connector, the revocation skipped and logged.

## Boundaries & Constraints

**Always:**
- Renewal, as Sure's importer: `completeConnection` upserts the session's accounts on `identification_hash` as today and changes nothing on a stored row the session leaves out, its `provider_uid` kept.
- Sync, as Sure's `linked_accounts_query`: every bank account of the connection that feeds an active account, whatever the last session listed. A refused read under a stale uid is that account's error, as today's per-account path: the run fails, `last_error` holds the first failed account's code, `last_synced_at` does not move, the consent is untouched (Story 27.19 kept session-level 401/404 apart).
- Migration from `pnpm data generate` dropping `bank_accounts.listed`; every row and every `accounts.bank_account_id` survives it.
- Without a connector: `GET /api/bank-connections`, `GET /api/bank-connections/:id/accounts` and `DELETE /api/bank-connections/:id` answer as with one; every other bank route still answers 503. `disconnectConnection` catches `BANK_CONNECTOR_UNAVAILABLE` from `resolveBankConnector`, logs `{ connectionId, code: "BANK_CONNECTOR_UNAVAILABLE" }` at `warn` as « bank session not revoked », then takes the lease, unlinks and deletes as today.
- « Réglages › Banques »: while `setup.locked` and the connector is unavailable (`missing` not empty, or `source` null), « Banques connectées » shows above the existing notice or locked form, without the country and picker. The connection page's « Déconnecter » works; « Synchroniser » and « Renouveler » answer their toast. Once the last connection goes, `locked` is false and the form saves new credentials, as today.
- `docs/architecture.md` AD-18 says both; `docs/sure-parity.md` « Renewal » reads Parity, « Disconnect » names the skipped revocation; `docs/deployment.md`'s « Without `ENCRYPTION_KEY`, the bank routes answer `503` » names the three that still answer. The two Story 27.20 entries of `deferred-work.md` get `resolved: Story 27.20.` lines.

**Never:** no per-bank-account error column: Sure's per-account capture is a debug log, and the connection's `last_error` is what the page shows. No session account list read at sync (`GET /sessions/{id}` gives bare uids, no hash). No disabling of « Synchroniser » or « Renouveler ». No change to `BankAlerts`, which reads connections only while `available`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Account left out | card linked; renewal lists checking only | card row and link kept under its old uid; next sync reads it, checking synced | card's 404 → `last_error` `BANK_PROVIDER_ERROR`, consent kept |
| Account unreadable | renewal sends the card without `uid` | same as left out, and the drop logged as today | same |
| Listed again | a later renewal lists the card | its uid refreshed, it syncs | none |
| No key | `ENCRYPTION_KEY` unset, one connection | list and accounts answer; disconnect unlinks and deletes, no `DELETE /sessions` sent | logged `BANK_CONNECTOR_UNAVAILABLE` |
| Key changed | stored credentials undecryptable | same as no key; then `bankSetup().locked` false and saving credentials succeeds | same |
| Other routes | no connector | sync, renew, link, institutions, start, callback | 503 `BANK_CONNECTOR_UNAVAILABLE` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/bank-accounts.ts` -- `listed` and its comment go.
- `packages/data/drizzle/` -- new migration dropping the column; `packages/data/migrate.spec.ts` keeps 0030's test, which migrates only that far.
- `packages/api/src/services/bank-connections.ts` -- `completeConnection` (≈ line 466) loses the unlisting update and `listed: true`; `listConnections` and `listBankAccounts` lose their `resolveBankConnector` gate; `disconnectConnection` and `revokeSession` take a connector that may be absent.
- `packages/api/src/services/sync.ts` -- `runSync`'s `eq(bankAccounts.listed, true)` and its comment go.
- `packages/api/src/routes/bank-connections.ts` -- the three routes move above the guard middleware.
- `packages/app/src/routes/_authed.settings.banks.tsx` -- `BanksPage` shows `Connections` when locked and unavailable; `Connections` takes `onChooseBank` as optional.
- `packages/app/e2e/bank-connections.spec.ts` -- `SETUP` route mock and `setupData` exist (≈ line 628).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/bank-connections.spec.ts` -- write first: replace « marks a bank account the renewal leaves out unlisted » with the kept-row case and the unreadable-account case; « when unavailable » keeps refusing the six other operations; disconnection without a key and with unreadable stored credentials, no revocation request, the log line, then `bankSetup` unlocked and `saveBankCredentials` accepted.
- [x] `packages/api/src/services/sync.spec.ts` -- write first: turn « after a renewal that drops the card… never asks for the card's uid » into the card read under its old uid, its 404 the run's `last_error`, checking synced, consent untouched.
- [x] `packages/api/src/routes/bank-connections.spec.ts` -- write first: the three routes answer 200 without `ENCRYPTION_KEY`, another answers 503.
- [x] `packages/data/schema/bank-accounts.ts`, `packages/data/drizzle/` -- drop the column, `pnpm data generate`.
- [x] `packages/api/src/services/bank-connections.ts`, `services/sync.ts`, `routes/bank-connections.ts` -- as the Code Map says.
- [x] `packages/app/e2e/bank-connections.spec.ts` -- write first: a test's own connection, `SETUP` mocked unavailable and locked; « Banques connectées » lists it, its page's « Déconnecter » confirms, the toast shows and Banques no longer lists it.
- [x] `packages/app/src/routes/_authed.settings.banks.tsx` -- the list while locked and unavailable.
- [x] `docs/architecture.md`, `docs/sure-parity.md`, `docs/deployment.md`, `deferred-work.md` -- as Boundaries say.

**Acceptance Criteria:**
- Given a renewal that leaves out a linked account, when the next sync runs, then that account is read and its failure shows as the connection's last error on its page.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- Migration `0071_drop_bank_accounts_listed` is a bare `DROP COLUMN`; `migrate.spec.ts` checks a link and the row's uid and hash survive it, and that 0030's test only migrates that far.
- `revokingConnector` in `services/bank-connections.ts` resolves the connector inside the lease, after `activeConnection`, and only when the connection holds a session, as Sure's `revoke_session` returns before looking for a provider: a `SYNC_IN_PROGRESS` refusal or a session-less row logs no « not revoked » line.
- The route spec lists, reads and deletes a real connection through an app built without `ENCRYPTION_KEY` on the same database; `depsWithoutKey()` in the service spec stands for that server.
- `Connections` takes `onChooseBank` as optional, its empty state then without a button; `BanksPage` renders it only while `setup.locked`.
- `docs/security-model.md` says a bank connected before a key change stays listed and its session lapses unrevoked.
- QA on a dev server without `ENCRYPTION_KEY`: before, « Banques » showed only the notice although a connection existed; after, the connection is listed above it, its page disconnects it, and the log reads `BANK_CONNECTOR_UNAVAILABLE` « bank session not revoked ».

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| A left-out account fails every run and holds the connection's last sync, so the stale banner shows | false | Sure's `EnableBankingItem::Syncer#perform_sync` raises when `transactions_failed > 0`, failing the whole sync; Design Notes accept it. | reject |
| AD-18, the `runSync` comment and the parity row read « its failure is its own » | low | Ambiguous next to a run that fails. | patch: say the refusal fails the run, `last_error` set, `last_synced_at` kept, as Sure's syncer |
| Route tests reach `:id/accounts` and `DELETE` only on an unknown id | low | 404 proved only that the guard was passed. | patch: a real connection listed, read and deleted without the key, no request sent |
| « when unavailable » leaves out `syncConnection` | low | It resolves the connector first. | patch: asserted |
| No e2e for the key-changed page (`missing` empty, `source` null, locked) | medium | Moving `Connections` beside `Unavailable` would hide it and fail nothing. | patch: e2e variant; the fresh install asserts no list |
| e2e clicks the link without checking « Banques connectées » | low | | patch: link reached through the named list |
| The unreadable-account test matches any log line holding « unreadable » | low | | patch: exact message, `connectionId`, `dropped: 1` |
| 0071's test does not check the column is gone or the row intact | low | | patch: `pragma_table_info` and uid and hash |
| `docs/deployment.md` names only the missing key | low | Changed key and unresolved credentials lock the same way. | patch |
| `docs/security-model.md` gives no way to cut access before the consent ends | low | | patch: withdraw it from the bank's site |
| `disconnectConnection` logs « not revoked » for a connection without a session | low | Sure returns before looking for a provider. | patch: no lookup without a session |
| Test settings cleanup skipped when an assertion fails; `onConflictDoNothing` could mask a row | low | | patch: `try/finally`, plain insert |
| Duplicated « without key » deps in the service spec; `bank` names a connector | low | | patch: `depsWithoutKey()`, `revocation` |
| The connection page still offers linking, which answers 503 | false | Boundaries keep « Synchroniser » and « Renouveler » answering their toast; linking reads balances from the provider like them. | reject |
| The success toast does not say the session was not revoked | false | Sure's `destroy` shows the same notice either way. | reject |
| No log names the failing account | false | `runSync` logs `accountId` and `code` on « bank account sync failed ». | reject |
| A pending row cannot be removed without the key | low | Pre-existing; pending rows lock nothing (`isLocked` reads active ones) and `startConnection` clears them. | reject |
| Spec says the log comes before the lease | — | Fix would edit the frozen spec; the order is noted above. | reject |
| Tracking statuses still `ready-for-dev` | false | Set at completion. | reject |
| No troubleshooting section for a renewal that leaves an account out | low | A self-hoster reads « BANK_PROVIDER_ERROR » on the connection page with no guide entry. | defer |

## Design Notes

A left-out account now fails each run and keeps the connection's last sync still, so after 48 hours the stale banner shows: that is Sure's behaviour, where the item's sync fails, and it is the signal the story asks for instead of silence. The owner ends it by renewing with the account shared again, or by disconnecting. `listed` was the only reason a renewal could differ from Sure here; keeping it always true would leave a column nothing reads.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/bank-connections.spec.ts src/services/sync.spec.ts src/routes/bank-connections.spec.ts` -- expected: pass.
- `pnpm --filter @archant/data exec vitest run migrate.spec.ts` -- expected: pass.
- `pnpm test` and `pnpm test:e2e` -- expected: pass.

**Manual checks:**
- Self-review and QA: screenshot « Réglages › Banques » with `ENCRYPTION_KEY` unset and one connection, and the connection page with « Déconnecter ».
