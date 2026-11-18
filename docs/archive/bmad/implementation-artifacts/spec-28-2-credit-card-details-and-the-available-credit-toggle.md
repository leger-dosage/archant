---
title: 'Story 28.2: Credit card details and the available-credit toggle'
type: 'feature'
created: '2026-10-14'
status: 'done'
baseline_commit: '30cafec86a82be351f645a88b300031865ebcad7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A credit card has no details, and a bank that reports a card's remaining credit as its balance gives a wrong debt. Sure `00dd977fb` records available credit, minimum payment, APR, expiry and annual fee (`credit_cards/_form.html.erb`), and a per-bank-account `treat_balance_as_available_credit` read by `EnableBankingAccount::Processor#interpret_credit_card_balance`.

**Approach:** Card details in `accounts.details`, validated by their own Zod schema (AD-6); the bank's `credit_limit` and the toggle on `bank_accounts`, Sure's `enable_banking_accounts`; one pure function interprets a card's bank balance wherever a bank balance becomes a stored one.

## Boundaries & Constraints

**Always:**
- Fields in Sure's order and rows: « Crédit disponible »; « Paiement minimum » beside « TAEG »; « Date d'expiration » beside « Frais annuels ». Placeholders Sure's in French notation: `10000`, `100`, `15,99`, `99`. All optional, in creation and edit dialogs.
- Amounts are integer minor units in the account's currency, ≥ 0, parsed as every amount field (`parseAmount`). APR in millionths (AD-25), ≥ 0, at most two decimals, below Sure's `decimal(10,2)` bound of 100 000 000, no 100 % cap. Expiry any date. A blank field stores `null`.
- Toggle « Le solde correspond au crédit disponible » with Sure's `fr.yml` description, in the edit dialog only, only for a credit card linked to a bank (`bankConnection !== null`). Saved in the same transaction as the account; ignored silently for any other account, as Sure. A change starts that connection's sync after the response, as Sure's `sync_later`.
- Bank limit: `credit_limit.amount` of the session account, parsed at the callback and at renewal (the `bank_accounts` upsert), kept only in the bank account's currency. A non-positive limit counts as none, as Sure's `positive_credit_limit`.
- Interpretation (debt = `toStoredBankBalance`, already absolute for a liability):
  - On: limit = bank limit, else « Crédit disponible » if positive. With a limit, debt = max(limit − reported, 0) and « Crédit disponible » becomes the limit. Without, no balance is written and « Crédit disponible » becomes null.
  - Off: debt = reported. With a bank limit, « Crédit disponible » = max(limit − debt, 0); without, unchanged.
  - Details and anchor commit together. Applied on sync (`ingest`) and on link.
- Export: `accountable` carries `available_credit`, `minimum_payment`, `apr`, `annual_fee`, `expiration_date` as Sure's `as_json`, decimals as strings, null when blank; `sure-preflight.ts` admits them.

**Never:** no overview tab or display of the details (Sure deleted it in `e7f882c55`); no details in `get_accounts` (Sure has none); no currency selector on « Paiement minimum » (Sure discards it); no toggle in the creation dialog; no effect on loans; no SimpleFIN override; no extra Enable Banking call to read the limit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create with details | card, `availableCredit "3000"`, `apr "15,99"` | 201, `300000`, `159900` stored | none |
| Negative or bad | `annualFee "-1"`, `apr "1,234"` | nothing written | 400, `details.annualFee` `invalid_amount`, `details.apr` `invalid_rate` |
| Details on depository | `details` on a depository | nothing written | 400 `invalid_details` |
| On, bank limit | limit 1000, reported 900 | debt 100, available 1000 | none |
| On, overpaid | limit 1000, reported 1050 | debt 0 | none |
| On, manual only | no bank limit, available 1000, reported 900 | debt 100, available 1000 | none |
| On, no limit | none anywhere | balance unchanged, available null | none |
| Off, bank limit | limit 1000, reported 100 | debt 100, available 900 | none |
| Off, no bank limit | available 3000, reported 100 | debt 100, available 3000 | none |
| Limit ≤ 0 or other currency | bank limit 0, USD on EUR | as no bank limit | none |
| Toggle on unlinked | PATCH flag on an unlinked card | flag ignored, rest saved | none |

</frozen-after-approval>

## Code Map

- `packages/data/account-types.ts:151-162` -- add `CreditCardDetails` beside `LoanDetails`; `schema/accounts.ts:18-19` types `details` as either, loan readers narrow on type.
- `packages/data/schema/bank-accounts.ts` -- `creditLimit` (integer, nullable), `treatBalanceAsAvailableCredit` (boolean, default false); migration 0074 by `pnpm data generate`, additive.
- `packages/api/src/connectors/enable-banking/schemas.ts:60-75` -- `credit_limit` on `sessionAccountSchema`, `.catch(null)`; `bank-connector.ts` `BankAccountRef` carries it.
- `packages/api/src/services/bank-connections.ts:438-456` -- upsert stores the limit; `:702-760` link interprets the balance.
- `packages/api/src/schemas/accounts.ts:46-61,288-402` -- `creditCardDetailsInputSchema`, `parseCreditCardDetails`, reusing `parseAmount`; `parseRate` (`:92`) caps at 100 % and three integer digits, so APR needs a bound option or its own parser; `createAccountSchema` admits details for `credit_card`; `updateAccountSchema` and `accountSettingsFormSchema` take the flag.
- `packages/api/src/services/accounts.ts:167-263` -- `getAccount` exposes `treatBalanceAsAvailableCredit` (null when unlinked); `updateAccount` parses card details, writes the flag on the linked `bank_accounts` row, then `void` a sync as `routes/middleware/daily-sync.ts:39` does, logging a failure.
- New `packages/api/src/domain/balances/credit-card-balance.ts` -- the pure interpretation; `stored-balance.ts` stays.
- `packages/api/src/services/sync.ts:160-245`, `services/ledger/ingest.ts:647-659` -- select limit, flag, type and details; pass the interpretation into `ingest` so details and anchor share its transaction.
- `packages/app/src/components/LoanDetailsFields.tsx`, `lib/loan-details.ts` -- patterns for new `CreditCardDetailsFields.tsx` and `lib/credit-card-details.ts`.
- `CreateAccountDialog.tsx:60-72,243-249`, `EditAccountDialog.tsx:83-123,215-233` -- fields when `type === "credit_card"`; toggle with the `excludedFromReports` `Switch` pattern.
- `packages/app/src/locales/fr.json` -- `creditCardDetails.*`; toggle label and description under `accountActions.form`.
- `packages/api/src/services/export.ts:174-192,793-822`, `testing/sure-preflight.ts:262-274` -- `creditCardAccountable` with `decimal` and `percent`.
- `docs/sure-parity.md:62` -- Parity.

## Tasks & Acceptance

**Execution:**
- [x] `domain/balances/credit-card-balance.spec.ts`, `routes/accounts.spec.ts`, `services/sync.spec.ts`, `services/bank-connections.spec.ts`, `connectors/enable-banking/client.spec.ts`, `services/export.spec.ts`, `packages/data/migrate.spec.ts` -- write the I/O matrix as failing tests first, plus a toggle change starting a sync -- test-first.
- [x] `packages/data/*` -- types, columns, migration 0074.
- [x] `connectors/enable-banking/*`, `services/bank-connections.ts` -- parse and store the limit; interpret on link.
- [x] `domain/balances/credit-card-balance.ts`, `services/sync.ts`, `services/ledger/ingest.ts` -- interpret on sync.
- [x] `schemas/accounts.ts`, `services/accounts.ts` -- details, flag, sync.
- [x] `services/export.ts`, `testing/sure-preflight.ts` -- export.
- [x] `packages/app/src/**` -- fields, toggle, labels.
- [x] `packages/app/e2e/accounts.spec.ts`, `e2e/bank-connections.spec.ts` -- save a card's details and read them back in the edit dialog; switch the toggle on a linked card and read it back.
- [x] `docs/sure-parity.md` -- row.

**Acceptance Criteria:**
- Given a linked card with the toggle on and a bank limit, when a sync runs, then its balance and « Crédit disponible » change in one commit.
- Given a viewer, when they open a card, then no control writes details or the toggle.

## Implementation Notes

- The bank side (limit and toggle) is read inside the write's transaction in `ingest` and `linkBankAccount` (`creditCardBalanceOf` in `services/ledger/bank-link.ts`), not selected in `sync.ts`, so a toggle saved during a sync is the one applied.
- `startConnectionSync` in `services/sync.ts` takes the lease with the `settings` trigger, which skips the one-hour interval but never a held lease; AD-18 in `docs/architecture.md` records the exception and the card rule.
- `updateAccount` now takes `BankConnectionDeps`; three ledger specs use `bankDeps()` from `testing/ledger.ts`. `accountSettingsFormSchema` takes `{ type, currency, openingDate }`.
- `FieldMessage` takes per-code `messages`, for the APR's own bounds. The fake bank's card has a 3 000,00 limit.
- `bank_accounts.credit_limit` is typed `MinorUnits`.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence / route |
|-------|---------|---------|------------------|
| blind, edge, gap | A toggle change within the hour after a sync takes no lease, so the balance keeps the old reading until the next day | medium | `takeLease` refused `lastSyncedAt` within `MIN_INTERVAL_MS`; Sure's `sync_later` has no hour. Patched: the settings trigger skips the hour only; AD-18 updated. |
| blind | Reinterpret locally by storing the raw bank balance | low | Design alternative; the sync now runs at once; rejected. |
| blind | No interface refresh once the toggle's sync ends | medium | The page keeps the old debt until its queries refetch. Deferred. |
| blind | A partial PATCH `details` answers `invalid_union` instead of per-field codes | low | API-only; both dialogs send complete details; rejected. |
| blind, edge | PATCH union strips foreign keys, unlike creation's `hasForeignDetails` | low | Mixed details are a malformed request; a card sent both is refused `invalid_details`; rejected. |
| blind | `writeAvailableCredit` bumps `updatedAt` on every card sync | low | No reader depends on a card's `updatedAt`; adds a guard; rejected. |
| blind, edge | Toggle read outside the PATCH transaction | low | Fix is a move. Patched. |
| blind | Sprint status `in-progress` while spec `in-review` | false | Both reach `done` at completion. |
| blind | AD-6 and the Enable Banking rule do not mention card details or `credit_limit` | low | Patched: one sentence in AD-18's rule. |
| blind, standards | `loanDetailsOf` sniffs `rateChanges` | false | Migration 0058 set `rateChanges` on every stored loan detail. |
| blind | Cards saved before 28.2 return `details: null` | low | Every reader handles null; rejected. |
| blind | APR message says « positif » while 0 is accepted | low | Patched: « positif ou nul ». |
| blind | Fake bank's `credit_limit` hard-codes EUR | low | Patched: the account's currency. |
| blind | No Playwright test of a viewer on a card | low | The API refuses the write (403 test) and the edit menu is admin-only; rejected. |
| blind | Unlinking keeps the toggle and a limit in « Crédit disponible » | false | Same in Sure: the row and the column stay. |
| edge | Toggle on without any limit keeps a stale current anchor | false | Sure skips the balance update and keeps the account's balance; the old anchor is that balance. |
| edge | A dialog left open overwrites a synced « Crédit disponible » | low | Sure's form posts `available_credit` the same way; rejected. |
| gap, spec | A card created by relinking an unlinked bank account whose toggle is on, with no limit anywhere, opens at the raw figure | low | Reachable only after an unlink, with the toggle on and neither limit; Sure's new account has no balance either until a limit exists; rejected. |
| standards | `creditLimit` typed as a bare `number` (AGENTS.md: money is never a bare number) | medium | Patched: `$type<MinorUnits>()` on the column and `CreditCardBankSide`. |
| standards | Duplicated preamble in `startConnectionSync` and `startDailySync`; amount helper in both accountable writers | low | Two short copies; extracting adds a helper for two callers; rejected. |
| standards | Repeated loan/card branching across schema, dialogs, service, export | low | Two types with details today; a table waits for Story 28.8's third; rejected. |
| standards | `services/accounts.ts` starts a sync; `updateAccount` needs `BankConnectionDeps` | low | Sure's controller does the same in `update`; rejected. |
| standards | `takeLease` boolean doubles `SyncTrigger` | low | One caller; rejected. |
| spec | `getAccount` returns the toggle for any linked account | low | Invisible: only a card shows it; rejected. |
| spec | `FieldMessage` gained `messages` | low | Needed for the APR's bounds, which the shared rate message misstates; kept. |

## Design Notes

« Crédit disponible » means the limit when the toggle is on and the remaining credit when off, and a bank limit overwrites a typed value on each balance: both are Sure's, kept. The bank limit refreshes only at callback and renewal, where Enable Banking returns account objects; Sure's `GET /sessions` refresh skips UID-only accounts, so the result is the same.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green, no tracked file changed after.

**Manual checks (if no CLI):**
- Screenshots of the creation dialog for a card, the edit dialog of an unlinked and of a linked card, looked at in self-review and QA.
