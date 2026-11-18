---
title: 'Story 11.1: Opening dates that accept today and survive a revert'
type: 'bugfix'
created: '2026-09-25'
status: 'done'
baseline_commit: '384a5e993a2f961b5aa468e49485f6fc0e6f7940'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Three opening-date bugs from `deferred-work.md` and the manual QA. The account form defaults the opening date to today, and `rejectionFor` refuses any line dated on or before it, so a new account refuses today's transaction. `revertImport` gives the opening anchor back its amount but keeps the date the import moved it to, so the same file imported again is no longer moved in and its total counts on top: Livret A goes from 9 100,00 to 10 200,00. The preview hint under « Rapprochées » says the lines were entered by hand, though a line from another file or a sync matches too.

**Approach:** Default the form's opening date to two years back, as Sure's `OpeningBalanceManager#default_date`. A revert moves the anchor's date back toward `imports.previous_opening_date`, as far as the entries still on the account allow. The hint names no origin.

## Boundaries & Constraints

**Always:**
- Form default: today minus two calendar years in the browser's time zone, a 29 February clamped to the 28th as Rails' `2.years.ago`. Still editable. `EARLIEST_OPENING_DATE` is unchanged.
- `rejectionFor` keeps refusing `line.date <= openingDate`: the opening balance is an end-of-day balance (Spec 1.2).
- Revert, step 4 of `revertImport`: after the deletes, when `previous_opening_date` is set, the restored date is the earlier of `previous_opening_date` and the day before the account's earliest entry other than the opening anchor that is dated on or before `previous_opening_date`, whatever its kind (transaction, reconciliation, current anchor). It never goes earlier than the anchor's current date. The amount gets back the deleted lines' shift, as today. Moving the date forward only crosses days with no entry, so every balance from the restored date on is unchanged.
- The balance rows before the restored date are deleted: `recomputeBalances` forward only rewrites from the day it is given, and would otherwise leave or write rows before the opening date.
- Hint: « Ces opérations existent déjà dans le compte. Elles seront reliées au fichier, sans être modifiées. »
- `services/ledger.ts` and `domain/**` stay at 100 % branches; no test reaches the network.

**Never:** no change to what `ingest` offers or writes when it moves the opening date; no migration (`previous_opening_date` exists since 0009); no opening-date edit after creation (Spec 1.4); no change to how linked accounts get their opening date; nothing on the other « No decision recorded » rows of `docs/sure-parity.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New account, today's line | form default, line dated today | accepted, balance includes it | — |
| Plain revert | opening 09-01, file moved it to 08-19, revert | anchor back to 09-01 with its old amount, no balance row before 09-01 | — |
| Revert then re-import | same file again, move accepted | same balances as after the first import | — |
| Line kept by another source | kept line on 08-25 | anchor on 08-24, balances from 08-24 unchanged | — |
| Later import moved it further | B moved it to 08-09, revert A | anchor stays 08-09 | — |
| Revert B, then A | reverse order | anchor back to the original date and amount | — |
| Credit card | liability, moved then reverted | amount owed back, date back | — |
| Linked account | revert on a bank-linked account | date back, backward recompute from it | — |
| Hint | matched group from a CSV line, OFX file | new hint, no « à la main » | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/components/CreateAccountDialog.tsx:56-64` -- `defaults()` sets `openingDate: toIsoDate()`.
- `packages/web/src/lib/dates.ts:4` -- `toIsoDate`; add a years-back helper beside it, with `dates.spec.ts` cases.
- `packages/web/src/components/TransactionSheet.tsx:78` -- `defaultDate` already gives today when the opening is before it; unchanged.
- `packages/api/src/domain/statement.ts:75-93` -- `rejectionFor`; unchanged.
- `packages/api/src/services/ledger.ts:2692-2820` -- `revertImport`; step 4 moves the date, step 6 recomputes from `earliest`. `accountWithOpeningDate` (:376) gives `openingId`, `openingDate`, `openingBalance`. `recomputeBalances` (:304): forward path deletes only `>= from`; backward path (`recomputeBackward` :220) rewrites every row from the anchor's date.
- `packages/api/src/services/ledger.ts:1326-1345, 1455-1466` -- `ingest` computes `opening` and writes `previousOpeningDate`; read only.
- `packages/data/schema/imports.ts:90-93` -- `previous_opening_date` comment says the revert gives back the amount only; update it.
- `packages/api/src/services/ledger.spec.ts:1560-1658` -- four revert tests assert the date stays; rewrite them to the matrix.
- `packages/web/src/locales/fr.json:491` -- `imports.hints.matched`.
- `packages/web/e2e/accounts.spec.ts`, `import-history.spec.ts`, `import-ofx.spec.ts` -- `fixtures.ts` `openAccount` defaults to 30 days ago.
- `docs/sure-parity.md:83,100` -- default opening date row and revert row.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first: every API matrix row, including re-import after revert yielding the first import's balances, and no balance row left before the restored date.
- [x] `packages/api/src/services/ledger.ts` -- `revertImport` step 4 and 6 as above; update its doc comment.
- [x] `packages/data/schema/imports.ts` -- comment on `previousOpeningDate`.
- [x] `packages/web/src/lib/dates.ts`, `dates.spec.ts`, `components/CreateAccountDialog.tsx` -- two-years-back default.
- [x] `packages/web/src/locales/fr.json` -- hint.
- [x] `packages/web/e2e/accounts.spec.ts` -- create through the form with the default date, add a transaction dated today, balance includes it.
- [x] `packages/web/e2e/import-history.spec.ts` -- import a file with lines before the opening date, accept the move, revert: the opening date shows again; import it again: same balance as the first time.
- [x] `packages/web/e2e/import-ofx.spec.ts` -- a preview matching a CSV-imported line shows the new hint.
- [x] `docs/sure-parity.md` -- row 83 becomes Parity; row 100 says the revert moves the date back, unlike Sure, because Archant refuses lines before the opening date.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every row above has an automated test: Playwright for what the interface shows, Vitest for the rest.

## Implementation Notes

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Two moving imports reverted oldest first leave the opening at the newer one's `previous_opening_date`; re-importing the older file counts on top (blind, edge) | medium | A moves 09-01 to 08-19, B to 08-09; reverting A is blocked by B's line, reverting B restores 08-19. A correct chain needs the shift or the moved-to date stored per import, a migration the spec excludes. | defer; limit written in `docs/sure-parity.md` |
| Same limit unstated in the Revert row of `docs/sure-parity.md` (blind, edge) | low | The row read as a full undo in any order. | patch |
| No test shows a non-transaction entry bounds the restored date (blind, verification-gap) | medium | Only a CSV-kept transaction exercises `kept`; a `kind = 'transaction'` filter would pass. | patch |
| `importFile` preview call lacks `headers: sameOrigin` (blind) | low | The upload and confirm calls around it send it. | patch |
| User edits a created line's amount before the revert; the give-back uses the edited amount (edge) | medium | Pre-existing: the give-back read current amounts before this story too. | defer |
| Revert e2e balance assertions pass with the old code (blind) | false | The second `importWithMove` asserts « Rejetées 2 » and the move offer naming J-30 as the current opening date, which fail with the old code. | reject |
| `accounts.spec.ts` recomputes two years back instead of importing `yearsAgo` (blind) | low | An independent oracle in `TIME_ZONE` is deliberate; the node and browser zones can differ. | reject |
| `importFile` infers the MIME type from `csv`, not the name (blind) | low | No caller passes a QIF. | reject |
| Two-year default: 730 balance rows, a flat two-year chart, « Date du solde » reads as a past balance (blind) | low | Sure's default, decided in the spec; the chart range row already says it starts at the opening date. | reject |
| `restoreOpening`'s `deleted` receives `created` (blind) | false | `created` holds only the rows the revert deleted (`unclaimedBeyond`). | reject |
| `dates.spec.ts` "same local day" cases do not pin a time zone (blind) | low | Local `Date` constructors make them hold in every zone, which is the claim. | reject |

## Design Notes

Sure keeps the moved date on revert because it accepts lines before the opening date. Archant refuses them, so a kept date changes how the same file is read next time. Restoring only across empty days keeps every balance a remaining entry depends on, and makes reverts in reverse order a full undo.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, ledger at 100 % branches.
- `pnpm test:e2e` -- expected: green.
