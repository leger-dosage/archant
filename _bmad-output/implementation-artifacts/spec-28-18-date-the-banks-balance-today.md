---
title: "Story 28.18: Date the bank's balance today"
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_commit: '26058d4369f045857c51a3fa5ab4f5cf639044a8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `EnableBankingAccount::Processor#process_account!` calls `account.set_current_balance(balance)` without a date, so `Account::CurrentBalanceManager` dates the `current_anchor` today; the balance's `reference_date` only chooses which balance is taken (`EnableBankingItem::Importer#select_current_balance`). Archant dates the anchor on the `reference_date`, capped at today (`anchorDate` in `services/ledger/bank-link.ts`), and moves a later anchor back to an earlier statement's day, where Sure's `set_current_balance_for_linked_account(balance, date)` leaves a newer anchor where it stands and records the older figure as a reconciliation on its own date (`record_historical_balance`).

**Approach:** The link and every sync date the bank's balance today. `rotateCurrentAnchor` becomes Sure's `set_current_balance_for_linked_account`: an anchor dated after the balance's date stays, the balance becoming the valuation of its own day; one on the same day is updated; one on an earlier day becomes a reconciliation, as Story 11.7 already does. The connector stops returning a date nobody reads.

## Boundaries & Constraints

**Always:**
- `linkBankAccount` and `ingest`'s `planCurrentAnchor` date the anchor `today(deps.timeZone)`, whatever `reference_date` the bank gave; `reference_date` keeps choosing the balance in `chooseBalance` (AD-18).
- `rotateCurrentAnchor(tx, account, { date, balance }, opening, now)`, in Sure's order: previous anchor dated after `date` → the valuation already on `date` takes the amount, keeping its id and dropping its import, the opening anchor on the opening date included, as Sure's `ReconciliationManager#prepare_reconciliation` `find_by(date:)`; else a new `reconciliation`; the anchor is untouched and the balances recompute from `date`. Same day → amount updated in place. Earlier day → the existing rule: a reconciliation keeping its id, deleted when a snapshot holds its day or it sits on the opening date; then a new anchor.
- Returns the earliest date written, so `ingest` recomputes from it.
- An anchor stored before this story on a `reference_date` before today becomes a reconciliation at the next sync; no migration.
- `BankBalance.date` and `AnchorBalance` go: `linkBankAccount` takes the balance as `MinorUnits | null`; `sync.ts`' statement balance carries `day`.
- AD-8 and AD-18 change with this story; `docs/sure-parity.md` rows « Current anchor date » and « Earlier bank balances » become Parity.

**Never:** no change to unlink, to the backward pass, to the opening anchor's rules (Story 28.20) or to file statement balances; no migration; no change to the balance selection order; Playwright unchanged, no screen changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link | today 21, CLBD dated 20 | `current_anchor` on 21 | none |
| Sync, same day | anchor on 21, new figure on 21 | anchor amount updated, same id | none |
| Sync, next day | anchor on 21, sync on 22 | reconciliation on 21 keeping the id; anchor on 22 | none |
| Older figure | anchor on 22, balance dated 20 | reconciliation on 20; anchor and 22's balance stay | none |
| Older figure on a snapshot's day | snapshot on 20 | its amount set, id kept, import dropped | none |
| Older figure on the opening date | opening anchor on 20 | its amount set, date kept | none |
| Old anchor stored on a `reference_date` | anchor on 19, sync on 21 | reconciliation on 19, anchor on 21 | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/bank-link.ts` -- drop `anchorDate`, `AnchorBalance`; `linkBankAccount` dates today; `rotateCurrentAnchor` gets the historical branch, reusing `writeReconciliation`; takes the opening anchor's id and date.
- `packages/api/src/services/ledger/ingest.ts` -- `planCurrentAnchor` dates `day`; the call passes `{ id: account.openingId, date: openingMovedTo ?? account.openingDate }`.
- `packages/api/src/services/sync.ts` -- `toParsedStatement` dates the balance `day`.
- `packages/api/src/services/bank-connections.ts` -- passes the amount alone.
- `packages/api/src/connectors/bank-connector.ts`, `connectors/enable-banking/client.ts` -- `BankBalance` without `date`; `referenceDate` stays for `selectBalance`.
- Specs: `services/ledger/bank-link.spec.ts` (the rotation describe), `ingest.spec.ts`, `pending.spec.ts`, `services/sync.spec.ts`, `bank-connections.spec.ts`, `connectors/enable-banking/client.spec.ts`, `routes/accounts.spec.ts`, `services/export.spec.ts`, `testing/ledger.ts` (`link` loses its date).
- `docs/architecture.md` (AD-8, AD-18), `docs/sure-parity.md` (two rows).
- Sure, read-only, at `00dd977fb`: `app/models/account/current_balance_manager.rb`, `account/reconciliation_manager.rb`, `enable_banking_account/processor.rb`, `enable_banking_item/importer.rb`.

## Tasks & Acceptance

**Execution:**
- [x] `services/ledger/bank-link.spec.ts` -- link dated today against an older `reference_date`; the older figure kept as a reconciliation on its date, on a snapshot's day and on the opening date, the anchor and today's balance staying; rotation on the next day; failing first.
- [x] `services/sync.spec.ts` -- a sync dates the anchor today whatever the `reference_date`.
- [x] `bank-link.ts`, `ingest.ts`, `sync.ts`, `bank-connections.ts`, the connector -- the code.
- [x] Remaining specs -- set the clock where an anchor must sit on a past day.
- [x] AD-8, AD-18 and the parity rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with Playwright unchanged.

## Design Notes

Assumptions taken alone, each settled by Sure. A closing balance describing yesterday now counts today's booked lines a second time until the next day's sync, as in Sure, which dates it today all the same; the next sync turns it into a reconciliation and the chain closes. The historical branch is unreachable from a sync dated today unless the stored anchor is dated after today, as after an `APP_TIMEZONE` change; it is kept because Sure's manager has it and the story asks for it. On the opening date the older figure sets the opening anchor's amount, Sure's `find_by(date:)` finding that valuation, as Story 28.17's snapshot does.

## Implementation Notes

- `e2e/bank-connections.spec.ts` « a bank balance a later sync supersedes stays in Soldes on its own day » cannot pass unchanged: `DATED_BANK` gives yesterday's balance then today's within one day, which now dates both today and updates the anchor in place. The test moves the anchor back a day in the database (`anchorOn`), as a sync run yesterday would have, before the second sync. No other Playwright file changed.
- The historical branch is tested by running a sync with the clock set before the stored anchor's day.
- A ledger test needing an anchor stored before this story moves it with `anchorStoredOn`, then recomputes through `recomputeBalances`.
- Visual QA skipped: no screen changes; « Soldes » lists the same rows for the same bank figures, now dated the day each sync ran.

### Review Findings

- [x] [Review][Patch] The historical branch set `importId: null` on the opening anchor, which never carries one [packages/api/src/services/ledger/bank-link.ts]
- [x] [Review][Patch] `anchorOn` passed silently on zero rows, and its docstring and two e2e comments described the old dating [packages/app/e2e/bank-connections.spec.ts, packages/app/e2e/fake-enable-banking.ts]
- [x] [Review][Patch] An unlink test linked with today before the opening date [packages/api/src/services/ledger/bank-link.spec.ts]
- [x] [Review][Patch] AD-8 stated the superseded anchor's exceptions twice; parity statuses lacked « of Epic 28 » [docs/architecture.md, docs/sure-parity.md]

Rejected:
- A card's « Crédit disponible » written from the older figure in the historical branch (low): Sure's processor writes `available_credit` before `set_current_balance` whatever branch follows, and the branch needs an anchor dated after today.
- The historical branch overwriting a typed snapshot or the opening anchor's amount (low): Sure's `record_historical_balance` updates whatever valuation `find_by(date:)` returns.
- `status: "recorded"` for a historical figure (low): the import preview never shows a sync's outcome; Sure's `historical?` flag has no reader in Archant.
- Playwright changed though the story says unchanged (low): the story means no new coverage; one test's premise, an anchor on yesterday's `reference_date`, no longer exists.
- The double count of today's lines documented nowhere (low): Sure behaves the same and the parity row says the balance is dated today; no troubleshooting symptom has been reported.
- A sync's anchor beside a snapshot of today (low): possible before whenever `reference_date` was today; the next day's rotation keeps the snapshot.
- `StatementBalance.date` unread on the bank path (low): the type is shared with files.
- The e2e test moves the anchor in SQL (low): the following sync recomputes; Vitest covers the next-day rotation end to end.
- A test calling `recomputeBalances` directly (low): ledger specs already import ledger internals.
- No historical case before the opening date, nor a client case mixing an unreadable date with type competition (low): the first is `writeReconciliation`'s path, the second is covered by the `PRCD` « hier » case.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Historical branch sets `importId: null` on the opening anchor | low | patch | The opening anchor never carries an import; the key did nothing. |
| 2 | `anchorOn` in the e2e test passes on zero rows | low | patch | A silent no-op would fail later on an unrelated count; now throws unless one row moved. |
| 3 | Unlink test linked with today before the opening date | low | patch | A state the app refuses; rewritten as an anchor stored before this story. |
| 4 | AD-8 states the superseded anchor's exceptions twice | low | patch | Two sentences said the same; one kept. |
| 5 | Parity statuses lack « of Epic 28 » | low | patch | Neighbouring rows use the full form. |
| 6 | A sync writes today's anchor beside a snapshot of today | low | reject | Possible before this story whenever `reference_date` was today; the anchor wins its day, and the next day's rotation deletes it for the snapshot (AD-8). Sure raises on its unique valuation date instead. |
| 7 | The historical branch overwrites a snapshot the user typed | low | reject | Sure's `record_historical_balance` updates whatever valuation `find_by(date:)` returns; the branch needs an anchor dated after today. |
| 8 | A card's « Crédit disponible » follows an older figure in the historical branch | low | reject | Sure's processor writes `available_credit` before `set_current_balance` whatever branch it takes; same unreachable condition. |
| 9 | Playwright changed though the story says unchanged | low | reject | The story means no new end-to-end coverage; one existing test's premise, yesterday's dated anchor, no longer exists, recorded in Implementation Notes. |
| 10 | `StatementBalance.date` dead on the bank path | low | reject | The type is shared with files, which need it; a sync passes its day. |
| 11 | Design Notes understate the double count | false | reject | Fix would edit this spec's reasoning only; the parity row states Sure's behaviour. |
| 12 | Spec and sprint statuses differ | false | reject | Both move to done together at completion. |
| 13 | No test for the historical figure before the opening date or the same-day date | low | reject | Same `writeReconciliation` path as a snapshot's day; the same-day branch keeps a date equal by definition. |
| 14 | Earlier-bank-balances row Parity though Archant deletes a superseded anchor on a snapshot's day | low | reject | Unchanged by this story; Sure fails validation there, Archant keeps the user's value. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
