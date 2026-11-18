---
title: "Story 27.21: Revert imports in any order"
type: 'bugfix'
created: '2026-10-12'
status: 'done'
baseline_commit: '2786dd924e012e13382000207ce2d3362b3af414'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant refuses every entry dated on or before an account's opening date (`BEFORE_OPENING_DATE`), so an import offers to move the opening back and shifts its amount, and a revert must undo that move: it gives back the lines' current amounts, so an edited line drifts the old opening day, and reverting the older of two moving imports first leaves the date stranded, so re-importing counts lines twice. Sure has none of this: it accepts entries before the opening anchor, and its revert never touches the anchor. The departure has no reason the owner accepts (2026-10-12: « On peut s'aligner sur Sure ? » « oui »). Sure read at `origin/main` `275f2f994`.

**Approach:** Take Sure's model. Every source accepts entries before the opening date; balances start at the oldest entry from zero and the anchor sets its day; only a QIF import moves the anchor's date, keeping its amount; a revert deletes its lines and leaves the anchor.

## Boundaries & Constraints

**Always:**
- `rejectionFor` (`domain/statement.ts`) drops `BEFORE_OPENING_DATE`; files, bank sync, manual lines, edits and assistant tools then accept any date up to `DATE_TOO_LATE`, the opening date itself included. `BEFORE_OPENING_DATE` leaves `RejectionCode` and every closed union; the field codes `not_after_opening_date` and `before_opening_date` go with their `fr.json` keys.
- Trades: `refuseDate` (`ledger/trades.ts`) goes. Snapshots: `snapshotRejectionFor` accepts a date before the opening date as a `reconciliation`; on the opening date it keeps setting the anchor's amount (Story 27.17), and a linked account keeps refusing that day. An import's statement balance follows the same rule.
- Balances as Sure's `Balance::BaseCalculator#calculation_start_date`: computation starts at the earlier of the opening date and the oldest non-pending entry. Forward, a day before the anchor starts from zero (Sure's `opening_starting_balances`), each valuation sets its day's end, the anchor included, so no balance on or after the opening date changes. Backward (linked accounts), the pass continues past the opening date down to the oldest entry. Holdings recompute from the same start.
- History: `periodRange` (`domain/balances/history.ts`) and every reader of it start at that same date, as Sure's `history_start_date`; the dashboard, goals and the balance chart follow.
- Import: CSV and OFX never move nor shift the anchor; the preview loses `opening` and `openingSuggestion`, `ImportDialog` its banner and « Avancer la date d'ouverture » button, `importPreviewSchema` and `preview_import` their `moveOpeningDate` / `move_opening_date`, `ImportOptions` its `moveOpeningDate`, `mcp/server.ts` its step about it. A QIF import whose earliest line precedes the anchor moves the anchor to the day before that line, amount kept, as Sure's `adjust_opening_anchor_if_needed!`; nothing else in Sure moves it.
- Revert: `restoreOpening` goes; the anchor's date is never touched, and a new import never touches its amount. Decision 2026-10-12 (owner: « s'aligner sur Sure mais éviter de perdre ou corrompre mes données »): `imports.previous_opening_date` stays, written by no new import, so an import confirmed before this story that shifted the anchor stays revertable: its revert gives the anchor back the current amounts of the lines it deletes dated on or before that date, with the asset/liability sign rule, the date kept. No migration; the production instance holds three such imports.
- Interface: `canDateAfterOpening` and `canSnapshot` stop hiding the add buttons; a new transaction defaults to today, as Sure.
- `docs/architecture.md` AD-4 step 1 and AD-8; `docs/sure-parity.md` rows « Lines before the opening date », « Revert », « Balance history range » set to Parity; `docs/deployment.md`'s `preview_import` paragraph; `bank-connections.ts`'s opening-date comment; the two Story 27.21 entries of `deferred-work.md` get `resolved: Story 27.21.` lines.

**Never:** no change to `setOpeningBalance`'s refusal of a date on or after the oldest entry (Sure's `date_error`), to the default opening date of a new account, to the QIF connector's refusal of an `Opening Balance` record, to how a linked account ignores the anchor's amount backward (row « Opening amount on a linked account »), or to existing anchors and entries: no data migration beyond the dropped column. No undo of a QIF anchor move at revert, as Sure. No conversion of legacy anchors to their original date and amount.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Older file | opening 09-01 at 1 234,56; OFX with 08-20 −20,00 and 09-05 −3,00 | both created; 09-01 ends 1 234,56; 08-20 ends −20,00; history from 08-20 | none |
| Revert any order | two such files, reverted oldest first, re-imported | history equals the one after the first two imports; anchor never moved | none |
| Edited line | 08-20 edited to −35,00, then reverted | balances from 09-01 unchanged | none |
| Opening day | manual line on 09-01 | accepted; 09-01 still ends at the anchor | none |
| Snapshot before | snapshot 08-15 at 500,00 | recorded as reconciliation | none |
| QIF | QIF earliest line 08-20 | anchor 08-19, amount kept; today's balance moves by the lines | none |
| Linked account | sync brings a line before the opening date | accepted; balances derived backward through it | none |
| Legacy import | confirmed before the upgrade, shifted the anchor by −20,00; reverted | anchor amount back by the deleted lines, date kept; balances from the old opening day as before it | none |
| Too late | line 400 days ahead | still refused | `DATE_TOO_LATE` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/statement.ts:75-81` -- `rejectionFor`; `RejectionCode` and its users (`connectors/`, `services/imports.ts`, `mcp/imports.ts:81,152`, `fr.json:887,903`).
- `packages/api/src/domain/balances/snapshot.ts:11-35` -- `snapshotRejectionFor`, `SnapshotRejectionCode`; `services/snapshots.ts:34-36` maps codes.
- `packages/api/src/services/ledger/ingest.ts:123,205-209,496-512,666-674,742-796,928-937,1003,1013` -- `moveOpeningDate`, `moveTo`, `movedIn`, `opening`, `openingSuggestion`, `planStatementBalance`, the confirm write and the recompute start. The QIF move hooks here when the import's source is `qif`.
- `packages/api/src/services/ledger/trades.ts:121-135,379,520,645` -- `refuseDate` and callers.
- `packages/api/src/services/ledger/edits.ts:112-125`, `services/transactions.ts:215-220,575-635` -- update and create refusals, `REJECTION_FIELDS`.
- `packages/api/src/services/ledger/balances.ts:129-165,286-312,352,383,421-438` -- `recomputeBackward` from `openingDate`, forward `from` and its zero seed, `balanceOn`, `openingDateOf` comments; `services/ledger/holdings.ts:103-104`.
- `packages/api/src/domain/balances/reverse.ts:11,31` -- `from` documented as the opening date.
- `packages/api/src/domain/balances/history.ts:17-28` -- `periodRange`; callers `services/balances.ts:51-58,145`, `services/reports.ts:138-142`, `services/goals.ts:98-102,289`.
- `packages/api/src/services/ledger/bank-link.ts:166,229-236,281-324` -- ranges `between(openingDate, last)`; widen where an entry before the opening date would now be missed.
- `packages/api/src/services/ledger/import-revert.ts:110-152,181,255-259` -- `restoreOpening`, `previousOpeningDate`.
- `packages/data/schema/imports.ts:47-48,90-95` -- `moveOpeningDate`, `previousOpeningDate`; `packages/data/drizzle/` new migration.
- `packages/api/src/schemas/imports.ts:69-79`, `schemas/assistants.ts:1578-1582`, `mcp/imports.ts:124-134,247-251,316-319`, `mcp/server.ts:170-171`.
- `packages/app/src/components/ImportDialog.tsx:281-326,389-541`, `packages/app/src/lib/transaction-form.ts:12`, `packages/app/src/routes/_authed.accounts.$accountId.tsx:536-537`, `packages/app/src/locales/fr.json:887,895-896,903,2406-2407`.
- `packages/api/src/services/bank-connections.ts:721-727` -- comment only.
- Tests asserting the refusal, to turn into acceptance: `domain/statement.spec.ts:13`, `domain/balances/snapshot.spec.ts:20`, `services/ledger/{ingest,edits,snapshots,trades,pending,bank-link,import-revert}.spec.ts`, `services/history-volume.spec.ts:698`, `routes/{transactions,trades,accounts,imports}.spec.ts`, `mcp/{imports,snapshots,transactions}.spec.ts`, `packages/data/migrate.spec.ts:481`, `testing/ledger.ts:170-206`; e2e `import-ofx.spec.ts:167,409`, `import-history.spec.ts:164`, `fixtures.ts:325`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/statement.spec.ts`, `domain/balances/snapshot.spec.ts`, `domain/balances/{forward,reverse,history}.spec.ts` -- write first: the matrix's dates accepted, the zero seed before the anchor, the backward pass past it, the history range from the oldest entry.
- [x] `packages/api/src/services/ledger/{ingest,import-revert,trades,snapshots,edits,bank-link}.spec.ts` -- write first: the matrix rows; replace each refusal test by its acceptance; revert tests assert the anchor untouched and the oldest-first re-import; a QIF move test.
- [x] Domain, ledger, services, schemas, MCP -- as the Code Map says; `pnpm data generate` for the dropped column, with `migrate.spec.ts` checking it.
- [x] `routes/*.spec.ts`, `mcp/*.spec.ts` -- payloads without `moveOpeningDate`; acceptance instead of refusal.
- [x] `packages/app/e2e/import-ofx.spec.ts`, `import-history.spec.ts`, `fixtures.ts` -- write first: an OFX file older than the opening date imports without any offer, and its revert leaves « Solde d'ouverture » as it was.
- [x] `packages/app/src` -- dialog, form default, buttons, `fr.json` keys removed.
- [x] Docs as Boundaries say.

**Acceptance Criteria:**
- Given an account, when a file older than its opening date is imported then reverted, then every daily balance from the opening date on is as before, and the import dialog showed no opening offer.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, the volume project included.

## Design Notes

Archant's forward pass already seeds zero when no row precedes the affected day (`balances.ts:308-312`), which is Sure's seed before the anchor; the anchor is a valuation, so it already sets its own day's end. The work there is the starting date and the comments that assume no entry precedes the anchor.

QIF example: anchor 09-01 at 1 234,56, QIF lines 08-20 −20,00 and 09-05 −3,00: anchor moves to 08-19 at 1 234,56; 08-20 ends 1 214,56 and today's balance drops by 23,00, as Sure.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/domain src/services/ledger` -- expected: green.
- `pnpm --filter @archant/api exec vitest run --project volume` -- expected: green, query plans unchanged.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: green.

**Manual checks:**
- Dev server: import an OFX file older than the opening date; screenshot the preview before (offer shown) and after (lines created, no offer), and the « Soldes » tab after a revert.

## Implementation Notes

- `historyStartOf` in `services/ledger/balances.ts` is the one start date: the oldest entry that is not pending, valuations included, as Sure's `calculation_start_date` and `history_start_date`. `recomputeBalances` deletes the rows before it, so `setOpeningBalance` and the revert no longer delete rows themselves. `get_accounts`' `start_date` reads it too.
- A statement balance dated on the opening date reads the anchor as the owner's value on that day: `present` when equal, `kept` with its gap otherwise; nothing writes the anchor's amount through an import, so a revert has nothing to give back.
- A snapshot on a linked account's opening date answers `snapshot_exists`, as moving one onto that date already did; `not_after_opening_date` is gone.
- Trades keep refusing a date after today (`refuseFutureDate`); only the opening-date refusal went.
- With no opening bound left, a date typed by hand, for a line, a trade or a snapshot, is refused before 1900 with `date_too_early` (`entryDateSchema`): a year typo such as 0026 would otherwise write a balance row per day since. Files and banks already stop at 1900 in `providerDate`.
- Unlinking an account whose balances start before the opening date fixes the first day with a reconciliation when its movements alone do not give its stored balance, so every balance stays.

## Spec Change Log

- Spec review, 2026-10-12: the frozen block says both « an import's statement balance follows the same rule » (a snapshot on the opening date sets the anchor's amount) and « a new import never touches its amount ». The implementation keeps the second: a statement balance on the opening date is compared with the anchor (`present` or `kept` with its gap) and never writes it, so a revert never has an amount to restore; a linked account's skips it. Known-bad state avoided: an import rewriting the owner's opening amount that no revert could give back. KEEP: the snapshot rule for snapshots the owner or an assistant records.

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind, edge | Dropping `previous_opening_date` leaves imports confirmed before the upgrade unrevertable without drifting every later balance | high | The production instance holds three such imports | intent_gap, answered by the owner on 2026-10-12: the column stays for them and their revert gives the shift back, date kept |
| 2 | blind, verification | A QIF move is not shown in the preview | false | Sure's `will_adjust_opening_anchor?` notice is rendered nowhere: Sure shows nothing either | reject |
| 3 | blind, edge | A QIF import moves a linked account's anchor | low | The backward computation ignores the anchor's amount and its date only bounds nothing now; Sure's QIF adjust checks no link either | reject |
| 4 | blind, edge | A statement balance on a linked account's opening date is read against an ignored anchor | medium | Contradicts the frozen « a linked account keeps refusing that day » | patch: `skipped` with `OPENING_DATE`, tested |
| 5 | blind | « Soldes » draws the opening row last although a reconciliation may now precede it | medium | `SnapshotList.tsx` placed it unconditionally | patch: ordered by date; across pages the anchor still shows on the last page only, low, left |
| 6 | blind, edge | Comments and the `create_transaction` description still describe the refusal | low | Direct corrections | patch |
| 7 | blind | `historyStartOf` adds a query per write without a plan assertion | low | The volume project passes with its timings; one indexed lookup | reject |
| 8 | blind | A preview made before the upgrade confirms as stale | low | The owner previews again; nothing is written | reject |
| 9 | blind | Tracking files disagree mid-run | false | The completion step syncs them | reject |
| 10 | blind | No liability case for the zero seed or the QIF move | low | Direct test additions | patch |
| 11 | blind | `openingBalanceSchema` checks 1900 twice, and the French text says « postérieure » for a `>=` rule | low | Direct correction | patch |
| 12 | blind | A QIF of lines all present still moves the anchor | false | Sure's `earliest_row_date` reads every row, present or not | reject |
| 13 | edge | Unlink recomputes from the opening date, leaving backward rows before it | low | Direct correction | patch: recompute from the history start |
| 14 | verification | History readers, `rotateCurrentAnchor` before the opening date, holdings purge and pending exclusion untested | medium | Each mutation passed every test | patch: four tests added |
| 15 | verification | The linked-account snapshot code `snapshot_exists` on the opening date is untested | low | Only the error text is at stake | defer |
