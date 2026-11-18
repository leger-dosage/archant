---
title: "Story 27.19: Every balance a bank sends, and a revoked consent at once"
type: 'feature'
created: '2026-10-12'
status: 'done'
baseline_commit: '13788c1c21c826020f8b4b33952e741c20b7b4c7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The connector reads only `ITBD`, then `CLBD`, so a bank sending other balance types shows no balance, where Sure's `select_current_balance` reads seven types and falls back to the first sent. A consent the bank revokes is noticed only by the 48-hour stale banner, because Archant never reads the session; Sure reads it first and asks for a reconnection on a session-level 401 or 404. Sure read at `origin/main` `275f2f994`.

**Approach:** Port Sure's balance choice, its currency split (#4077) included, into the Enable Banking client, and read the session at the start of each sync: a refused session ends the consent now, so the existing « consent expired » path shows the banner and stops syncing.

## Boundaries & Constraints

**Always:**
- Balance choice, as Sure's `split_balances_by_currency` then `select_current_balance`: when the balances carry more than one currency, keep those in the linked account's currency, else in the first currency listed. Types compare after removing `_` and `-` and lower-casing; per type, the last balance listed wins, as Sure's `index_by`. Priority `CLBD`, `closingBooked`, `ITBD`, `interimBooked`, `OPBD`, `openingBooked`, `PRCD`, `previouslyClosedBooked`, `XPCD`, `expected`, `CLAV`, `closingAvailable`, `ITAV`, `interimAvailable`, then the first balance kept. When the hit is `OPBD` or `PRCD` (either spelling) with a readable `reference_date`, the `XPCD`, `CLAV` or `ITAV` balance (either spelling) with the latest strictly newer `reference_date` wins; a missing or unreadable date skips the check. `null` only for an empty list. The `DBIT` sign and the `reference_date` dating stay as today.
- When non-zero balances in other currencies were left out, log at `info` the chosen currency and how many, never an amount.
- Session read, as Sure's `fetch_session_data`: after the lease and before any account, `GET /sessions/{id}` through the client's `call`. A valid answer sets `consent_expires_at` from `access.valid_until` when it differs. A 401 or 404 sets `consent_expires_at` to the run's start and `last_error` to `CONSENT_EXPIRED`, syncs no account, and the run ends as `consent_expired` (the button answers `CONSENT_EXPIRED`, as for an expired consent). Any other failure sets `last_error` to its code, syncs no account and fails the run, as Sure returns `@session_error`.
- A stored session id that cannot be decrypted reads as a refused session: logged `SESSION_UNREADABLE`, then the same as a 401, since only a renewal stores a readable one.
- A 401 or 404 on an account's balances or transactions stays that account's error, as today.
- AD-18 in `docs/architecture.md` states the new balance order, the session read and the currency split; `docs/sure-parity.md` « Balance » and « Consent check » read Parity.

**Never:** no new connection status or migration: Sure's `requires_update` is a consent that ends now. No check of the session's `status` field (Sure has none). No use of the session's account list (Story 27.20). No interface change: the banner, « Reconnecter » and « Renouveler le consentement » exist.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Only OPBD | `[OPBD 100.00]` | 100.00 | none |
| Fresher available | `OPBD` dated 10-10, `ITAV` 10-11, `XPCD` 10-12 | the `XPCD` | none |
| Same-day available | `OPBD` and `ITAV` both dated 10-11 | the `OPBD` | none |
| Booked order | `ITBD` then `CLBD` | the `CLBD` | none |
| Long name | `closingBooked` only | read as `CLBD` | none |
| Unknown types | `[INFO 5.00, OTHR 6.00]` | `INFO` | none |
| Two currencies | EUR account; `CLBD` USD 12, `CLBD` EUR 50 | EUR 50, one log line | none |
| Revoked session | `GET /sessions/{id}` → 401 or 404 | consent ends now, no account read, banner « expired » | `CONSENT_EXPIRED` |
| Session moved | valid, `valid_until` later than stored | stored expiry updated, accounts sync | none |
| Account 404 | session valid, one account's transactions 404 | that account fails, connection keeps its consent | `BANK_PROVIDER_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/api/src/connectors/enable-banking/client.ts` -- `BALANCE_TYPES` and `chooseBalance` (≈ line 295) replaced; `call` already maps an HTTP failure to `BankProviderError` with `failure.status`; add `readSession`.
- `packages/api/src/connectors/enable-banking/schemas.ts` -- `balanceSchema` keeps `reference_date`; add a session-read schema holding only `access.valid_until` (the GET answer lists accounts as uid strings, unlike `sessionResponseSchema`).
- `packages/api/src/connectors/bank-connector.ts` -- port: `fetchBalance(uid, currency)`, `readSession(sessionId) => { consentExpiresAt }`; doc comments follow.
- `packages/api/src/services/sync.ts` -- `runSync` reads the session first; `runLeased`/`syncOne` turn a refused session into `consent_expired`; pass the account's currency to `readBalance`.
- `packages/api/src/services/bank-connections.ts` -- `revokeSession` shows how to decrypt `session_id` and log `SESSION_UNREADABLE`; reuse, do not copy.
- `packages/api/src/services/bank-credentials.ts` -- `resolveBankConnector` yields `encryptionKey`.
- `packages/api/src/domain/bank-connection-alert.ts` -- unchanged; reads `consent_expires_at`.
- `packages/api/src/testing/enable-banking.ts` -- `mockProvider` gains `GET /sessions/:id`; new fixture beside `connectors/enable-banking/fixtures/balances.json`.
- `packages/app/e2e/fake-enable-banking.ts` -- answers `GET /sessions/{id}` from its `sessions` set, 404 when unknown, or every e2e sync fails.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/enable-banking/client.spec.ts` -- write first: every balance row of the matrix, the long names, a `DBIT`, the session read's 200, 401 and 404 -- the money path is covered to the branch.
- [x] `packages/api/src/connectors/enable-banking/client.ts`, `schemas.ts`, `connectors/bank-connector.ts` -- Sure's choice and `readSession`.
- [x] `packages/api/src/services/sync.spec.ts` -- write first: revoked session (401, 404) ends the consent and reads no account, the daily sync then skips it; valid session updates the expiry; unreadable session id; a 500 on the session fails the run without reading accounts; an account's 404 leaves the consent.
- [x] `packages/api/src/services/sync.ts` -- the session read and the currency passed down.
- [x] `packages/api/src/testing/enable-banking.ts`, `packages/app/e2e/fake-enable-banking.ts` -- `GET /sessions/{id}`.
- [x] `docs/architecture.md` AD-18, `docs/sure-parity.md` rows « Balance » and « Consent check » -- as Boundaries say.

**Acceptance Criteria:**
- Given a bank whose session is revoked, when the first visit of the day starts a sync, then the next page load shows « Le consentement de {bank} a expiré » with « Reconnecter », without waiting 48 hours.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with the e2e fake answering the session read.

## Design Notes

Ending the consent is Sure's `needs_authorization? = !session_valid? || requires_update?` with one column: every reader already treats a past `consent_expires_at` as « reconnect », and a renewal writes a new one. The session endpoint belongs to Enable Banking, not the bank, so it costs nothing against PSD2's four daily unattended calls per account.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/connectors/enable-banking src/services/sync.spec.ts` -- expected: pass.
- `pnpm test` and `pnpm test:e2e` -- expected: pass.

**Manual checks:**
- Self-review and QA: with the e2e fake made to answer 404 for the session, screenshot the dashboard banner and the connection page after a sync.

## Implementation Notes

- `BankBalance` gains `otherCurrencies`, the count of funded balances left out; `logOtherCurrencies` in `services/bank-connections.ts` logs it from the sync and from the link, never an amount.
- `readableSessionId` in `services/bank-connections.ts` is the one decryption of a stored session id, shared by `revokeSession` and the sync's session read. A connection with no stored session id reads as refused too.
- The session is read even when nothing is linked, as Sure reads it first.
- `fixtures/balances.json` swaps its amounts so the `CLBD` holds 1 234,56 € undated: every existing sync expectation keeps its figure under the new order.
- Review patches: the expiry update after the provider call's `try`; a session answer without `access.valid_until` keeps the stored end, as Sure; a two-currency link test.
- The e2e fake gains `REVOKED_BANK`, whose session read answers 404 once a statement was read; `bank-connections.spec.ts` covers the acceptance criterion through the first visit of the day.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| Spec `in-review` while sprint status says `in-progress` | false | The workflow moves sprint tracking at the presentation step, not at review. | reject |
| A valid session whose `valid_until` is past still reads accounts | low | True, and Sure does the same: `session_valid?` is checked before `fetch_session_data`, not after reconciling; the next sync stops. | reject |
| Link passes the bank account's currency, not the Archant account's | false | `linkBankAccounts` compares the balance with `bankAccount.currency`; passing it keeps both consistent. | reject |
| `fundedCount` reads amounts unlike Ruby's `to_d` | low | Only a log count differs, for scientific-notation amounts Enable Banking does not send. | reject |
| A connection without a session id ends its consent with no specific log | low | An active connection always holds a session id; only `pending` rows have none, and they never sync. | reject |
| The session refusal is logged twice | false | Same pattern as `runSync`: `logFailure` carries status and provider code, the second line the outcome. | reject |
| No test serves two currencies at link time | medium | Dropping `currencyOf(bankAccount)` or `logOtherCurrencies` in `linkBankAccounts` failed nothing. | patch: test added in `bank-connections.spec.ts` |
| An unreadable 200 session answer is not tested in `sync.spec.ts` | false | After the patch below it no longer fails the run; the missing-end case is tested. | reject |
| Session-read writes do not check the lease | low | `runSync`'s writes filter on the id alone too; a run outliving its 10-minute lease is pre-existing. | reject |
| The e2e revocation depends on the fake's pagination | false | The fake always serves two pages, so `page-2` is always read. | reject |
| An application-level 401 ends every consent | low | Sure treats any session-level 401 the same way. | reject |
| Connection deleted between lease and session read | low | A disconnection during a held lease is a pre-existing race; nothing is written to a missing row. | reject |
| The expiry update sits inside the provider call's `try` | low | A local database error would be logged and stored as a provider failure. | patch: update moved after the `try/catch` |
| An unreadable chosen balance throws where a later type could read | low | Same as before the change for `ITBD`; Enable Banking amounts are decimal strings. | reject |
| A session answer without `access.valid_until` fails every sync | medium | Sure's `reconcile_session_expiry!` returns when it is blank and the sync goes on. | patch: `valid_until` optional, stored end kept |
