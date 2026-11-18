---
title: 'Story 2.5: Import history and revert'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: 'cd14857f0b1efda9a061acbfc17a323c3f471314'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A confirmed import cannot be seen again nor undone, so a wrong file (wrong account, wrong export) stays in the history for good (FR18).

**Approach:** An Imports tab on the account lists its confirmed and reverted imports. Reverting one, in a single ledger transaction, removes the keys it wrote, the transactions it created that no other key still holds, and its snapshot, gives the opening anchor back the amount its lines had shifted, marks it `reverted` and recomputes balances (AD-7).

## Boundaries & Constraints

**Always:**
- Creation marker: `ledger.ingest` sets `entries.import_id` on the transaction entries it inserts (created and possible duplicates), not on matched ones. Keys alone cannot tell a created entry from a matched manual one. No backfill: no import has shipped to a user.
- Revert of import X, in one immediate transaction in `ledger.revertImport`: (1) delete every `entry_keys` row with `import_id = X`, on created and matched entries alike; (2) delete each transaction entry with `import_id = X` that has no key left, its `transactions` row first; one that keeps a key (another source confirmed it) stays and its `import_id` becomes `null`; (3) delete the `reconciliation` whose `import_id = X`; a snapshot the user edited has `import_id` cleared already and stays; (4) when X moved the opening anchor, leave its date where X put it, as Sure never moves it back, and add back to its amount what X's deleted lines dated on or before `imports.previous_opening_date` had shifted it by, so every later balance returns to its value before X; (5) set `status = 'reverted'`, `reverted_at`; (6) recompute balances from the earliest date touched. Deletes are chunked like the inserts.
- A transaction X created is deleted even when the user edited it since: only another source's key keeps it, as Sure deletes every entry of the import.
- Migration 0009: `imports.status` check gains `reverted`; nullable `reverted_at` integer and `previous_opening_date` text, the opening date before `ingest` moved it, written only when it does. `migrate.spec.ts` flips its `reverted` refusal.
- `GET /api/accounts/:id/imports?page=` lists `confirmed` and `reverted` imports, newest `confirmed_at` first, paged as snapshots: `{ data: { items, total } }`, each item `{ id, fileName, source, confirmedAt, revertedAt, counts, removable }`. `removable` is `{ transactions, snapshot }`, what a revert would delete now, computed per listed confirmed import, `null` for a reverted one.
- `POST /api/imports/:id/revert` answers `{ data: { id, removed: { transactions, snapshot } } }`. Unknown id: `404 NOT_FOUND`. A `previewed` or `reverted` import: `409 IMPORT_NOT_REVERTABLE`, a new `AppError` code with its `errors` translation.
- Imports tab (`?tab=imports`, `importsPage`), after Soldes: one row per import with date, file name, format (OFX, CSV, QIF), « Créées » (`created + duplicates`), « Rapprochées », « Déjà présentes », « Rejetées ». A reverted row reads « Annulé le 22 sept. » and has no action. Empty: « Aucun import. »
- « Annuler l'import » opens `ConfirmDialog`: title « Annuler l'import de releve.ofx ? », description from `removable` (« 42 opérations et 1 solde relevé seront supprimés. »), destructive button « Supprimer 42 opérations », or « Annuler l'import » when nothing would be deleted. Success toast gives numbers only: « Import annulé, 42 opérations supprimées. » Errors go through `errors.<CODE>`.
- Revert invalidates the account's queries (balance, chart, transactions, snapshots, imports) and the cross-account transaction list.
- Logs: import id, counts, duration, error code only.

**Never:** no deletion of the `imports` row; no revert of a previewed import (it is purged); no undo of a revert; no restore of an earlier import's snapshot that X overwrote (not recorded); no update of other imports' stored counts; no revert from the transaction sheet; no « Importer un fichier » empty-state action (separate gap).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Plain revert | X created 10, statement balance written | 10 transactions and the snapshot deleted, balances as before X | — |
| Matched manual entry | X matched 1 manual entry | Entry kept, X's keys gone, sheet shows « manuel » | — |
| Other source confirmed | CSV import Y matched an entry X created | Entry kept, Y's key stays, `import_id` null | — |
| Edited after import | User changed a label X created | Transaction deleted | — |
| User-edited snapshot | User edited X's snapshot | Snapshot kept | — |
| Opening moved | X moved opening 01/03 → 01/01 | Opening stays 01/01, its amount gets X's shift back, balances as before X | — |
| Moved further since | Import Y moved opening again after X | Only X's share of the shift is given back | — |
| Re-import | Same file after revert | Every line under À créer, matched ones under Rapprochées | — |
| Twice | Revert an already reverted import | Nothing changes | `409 IMPORT_NOT_REVERTABLE` |
| Unknown | Random id | Nothing changes | `404 NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/imports.ts` -- `IMPORT_STATUSES` (L24), table (L72–96) gains `revertedAt`, `previousOpeningDate`; generate with `pnpm data generate --name add_import_revert`, which rebuilds the table as 0007/0008 did. `schema/entries.ts` L35 comment: `import_id` now also marks created transactions. `migrate.spec.ts` L187.
- `packages/api/src/services/ledger.ts` -- `ingest` (L647): transactions insert (L784) sets `importId: target?.id ?? null`; opening move (L827) also writes `previous_opening_date` on the import. `attachKeys` (L470) unchanged. `recomputeBalances` (L126) and `accountWithOpeningDate` (L189) are private: `revertImport` lives here, since only the ledger writes money tables. `deleteTransaction` (L968) shows the key → transaction → entry delete order; `inSequence`/`ROWS_PER_INSERT` for chunks.
- `packages/api/src/services/imports.ts` -- `confirmImport` (L345) shows the immediate-transaction wrapper; add `listImports` and `revertImport` there.
- `packages/api/src/routes/accounts.ts` (L96 snapshots list pattern), `routes/imports.ts` (confirm route pattern), `schemas/imports.ts`, `lib/errors.ts` (L7 union).
- `packages/web/src/routes/comptes.$accountId.tsx` -- `ACCOUNT_TABS` (L41), search schema (L54), `SnapshotsPanel` (L164) as the panel to copy. `lib/query-keys.ts`: `accounts.imports(id, page)` under `accounts.detail(id)`. `hooks/useImports.ts` gains `useAccountImports`, `useRevertImport` (invalidate like `useConfirmImport`, plus `transactions.all`). `components/ConfirmDialog.tsx`, `AccountSettings.tsx` L216 for the delete flow. `locales/fr.json`: `accountDetail.tabs`, `imports`, `errors`.
- Tests: `services/ledger.spec.ts` (`ingest from an import` L573, `deleting imported transactions` L1257), `app.spec.ts` (`upload` helpers L1688), `packages/web/e2e/import-ofx.spec.ts` and `fixtures.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger.spec.ts` -- tests first: every matrix row except the HTTP ones, `import_id` set on created and duplicate entries only, `previous_opening_date` written, a 5,000-line revert in one transaction.
- [x] `packages/data/schema/imports.ts`, `entries.ts`, `drizzle/0009_*`, `migrate.spec.ts` -- status, columns, migration.
- [x] `packages/api/src/services/ledger.ts` -- creation marker, `previous_opening_date`, `revertImport`, `removableOf` for the list.
- [x] `packages/api/src/lib/errors.ts`, `services/imports.ts`, `schemas/imports.ts`, `routes/accounts.ts`, `routes/imports.ts`, `app.spec.ts` -- list and revert endpoints, `409`, `404`, re-import after revert creates the lines again.
- [x] `packages/web/src/lib/query-keys.ts`, `hooks/useImports.ts`, `components/ImportHistory.tsx`, `routes/comptes.$accountId.tsx`, `locales/fr.json` -- tab, list, confirmation, toast.
- [x] `packages/web/e2e/import-history.spec.ts` -- one test per acceptance criterion below.

**Acceptance Criteria:**
- Given an account with a confirmed OFX import, when I open its Imports tab, then the row shows the file name, OFX, the date and the four counts.
- Given that import, when I revert it and confirm, then its transactions leave Opérations, the balance returns to its value before the import, and the row reads « Annulé le … ».
- Given a reverted import, when I import the same file again, then Aperçu lists its lines under À créer.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Implementation Notes

- Superseded by review loop 1: `previous_opening` held `{ date, balance, movedTo }` to restore the anchor; the anchor is no longer restored, so only the old date is kept, in `previous_opening_date`.
- `drizzle-kit` generated 0009 copying `reverted_at` and `previous_opening_date` from the old `imports` table, which has neither; the copy is hand-fixed to leave them null, and `migrate.spec.ts` migrates a database stopped before 0009.
- The history list returns `{ items, page, pageSize, total }`, as the snapshots list does (AD-15).
- The confirmation handles each case: transactions and snapshot, transactions only, snapshot only (« Supprimer le solde relevé »), nothing (« Annuler l'import », not destructive). The toast reads « Import annulé. » when no transaction was deleted.
- `sgml` and its `Line` type moved from `import-ofx.spec.ts` to `e2e/fixtures.ts`, beside a new `api.importFile` helper.

- QA on a throwaway database, Chromium 1280 px: a three-line OFX file moves the balance from 1 000,00 € to 2 438,60 €; the Imports tab lists « releve-septembre.ofx, OFX, 3 0 0 0 »; the confirmation reads « 3 opérations seront supprimées. » with « Supprimer 3 opérations »; the toast reads « Import annulé, 3 opérations supprimées. », the row « Annulé le 22 sept. 2026 », and the balance is back at 1 000,00 €.

## Spec Change Log

- Loop 1. Trigger: triage #1, an opening X moved but could not restore kept X's shifted amount, so later balances stayed off by X's deleted moved-in lines, against AC 2. Amended, on the owner's answer « comme Sure »: step 4 no longer restores the date; it gives back the amount X's deleted lines shifted, and `previous_opening` becomes `previous_opening_date`. Avoids a silent balance drift after a revert. KEEP: everything else of the implementation, the hand-fixed 0009 copy, and the review patches #3, #5, #9–#11, #13, #14, #16–#18, #20, #21 (#16 and #17 now test the new step 4 instead of the removed guard).

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `ledger.ts` `revertImport` step 4 | An opening X moved but cannot restore keeps X's shifted amount, so later balances stay off by X's deleted moved-in lines | medium | The blocked-restore test expects `123456 + 2000 - 700`; frozen step 4 says "otherwise leave it", against AC 2. | intent_gap |
| 2 | blind | `ImportHistory.tsx` dialog | Confirmation does not say the opening moves back | low | Restoring puts balances back where they were; adds a text branch. Rejected. | |
| 3 | blind | `useImports.ts` `useRevertImport` | 409 leaves a stale row with its button | low | Invalidates on success only. Direct fix. | patch |
| 4 | blind | revert semantics | Lines a later same-source import saw as present vanish without warning | low | Accepted in Design Notes, as Sure; a warning adds UI surface. Rejected. | |
| 5 | blind | `imports.ts` `listImports` | `confirmedAt ?? 0` renders 1970 instead of failing; `reduce` over one row | low | Direct fix. | patch |
| 6 | blind | `imports.ts` `listImports` | Page, total and removable read outside one transaction | low | A race shows `{0,0}`; the revert then answers 409 and the list refreshes. Rejected. | |
| 7 | blind | spec | Contract changes recorded in Implementation Notes, not the change log | false | The change log records review loopbacks only. | |
| 8 | blind | `sprint-status.yaml` | Story `in-progress` while spec is `in-review` | false | The sprint sync runs at presentation. | |
| 9 | blind | `ledger.spec.ts` | Revert of possible duplicates untested | low | Only the marker is asserted. | patch |
| 10 | blind | `ledger.spec.ts` | Liability opening restore untested | medium | `ingest` flips the shift sign for liabilities; no revert test covers it. | patch |
| 11 | blind, verification | `ImportHistory.tsx` `describeRemoval` | Three of four confirmation branches and the « Import annulé. » toast untested | medium | Pre-verified. | patch |
| 12 | blind | `ImportHistory.tsx` | Same accessible name for two imports of one file on one day | low | Rare; adding the time is cosmetic. Rejected. | |
| 13 | blind | `imports.ts` `revertImport` | Unexpected error logged without import id | low | Direct fix. | patch |
| 14 | edge | `ImportHistory.tsx` | Annuler while pending closes the dialog, the revert still commits | low | `onOpenChange` ignores `isPending`. Direct fix. | patch |
| 15 | edge | `ImportHistory.tsx` | `removable` stale if entries changed since load | low | The toast gives the server's counts. Rejected. | |
| 16 | verification | `ledger.spec.ts` | `movedTo` guard not isolated by any test | medium | Pre-verified. | patch |
| 17 | verification | `ledger.spec.ts` | `lte` boundary of the blocking query untested | medium | Pre-verified. | patch |
| 18 | verification | `import-history.spec.ts` | « Créées » never checked with duplicates | medium | Pre-verified. | patch |
| 19 | verification | `useImports.ts` | `placeholderData` relies on the id's position in the key | low | Correct today. Rejected. | |
| 20 | self | `schema/imports.ts` | `PreviousOpening` balances typed as bare `number` | low | AGENTS.md: a bare number meaning money is a bug. | patch |
| 21 | blind | `fr.json` `confirm.nothing` | Text names only matched lines, the case also covers kept created ones | low | Direct fix. | patch |

## Design Notes

The epic's rule "delete an entry only if no key from another source remains" holds with a simpler test: no key at all remains once X's keys are gone. A later import of the same source never adds a key to an entry X created: an exact key match puts the line under Déjà présentes, which writes nothing, and matching excludes entries that already carry a key from that source. So any remaining key belongs to another source, a CSV of the same account today, the bank in Epic 10.

The consequence the user sees: import January–February, then February–March, then revert the first; February's lines go, although the second file held them. Re-importing the second file brings them back. Sure behaves the same, since it destroys every entry of the import. Recording each "already present" hit would need a table of its own for a rare case.

`previous_opening_date` exists because `ingest` shifts the opening balance by the moved-in lines to keep the old opening day's balance (L718). Sure keeps the amount and moves only the date, so its revert has nothing to undo. Here the revert gives the amount back for the lines it deletes, found as X's deleted lines dated on or before the old date, and leaves the date as Sure does. This holds whether or not something moved the opening since: only X's share of the shift is given back.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `import-history.spec.ts` and the existing suite pass.

**Manual checks:**
- On a throwaway database at 1280 px: import an OFX fixture, match one line to a manual entry, revert; the balance equals its value before the import and the manual entry remains.
