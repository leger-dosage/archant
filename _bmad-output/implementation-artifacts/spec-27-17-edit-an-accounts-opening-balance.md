---
title: "Story 27.17: Edit an account's opening balance"
type: 'feature'
created: '2026-10-11'
status: 'done'
baseline_commit: '4e56c4f14f843c0c0dd301cedad696bae5307803'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An account's opening balance and date are fixed at creation, where Sure edits them in its valuation drawer; a snapshot on the opening date is refused, where Sure's `ReconciliationManager` rewrites the anchor; and no assistant tool answers Sure's `set_opening_balance` (#3820, `6b6a27e1c`). Sure read at `origin/main` `275f2f994`.

**Approach:** One ledger function moves the `opening_anchor` in place, date and amount, and recomputes from the earlier date; a route, a « Solde d'ouverture » row and sheet in « Soldes », and `set_opening_balance` call it.

## Boundaries & Constraints

**Always:**
- « Soldes » lists the opening balance as its oldest row, labelled « Solde d'ouverture », for every reader. For an administrator on an account without `bank_account_id` the row opens a sheet titled « Solde d'ouverture », Sure's `valuations.show` wording: « Date », « Valeur du compte à ce jour », « Notes », saved by « Mettre à jour la valeur ».
- `PATCH /api/accounts/:id/opening-balance` takes `{ date, balance, notes? }`, `balance` the stored balance's decimal text (AD-5: a loan's amount owed is positive). It refuses, as `VALIDATION_ERROR` fields: a date on or after the oldest other entry of the account, any kind, pending included (`date`, `not_before_oldest_entry`, `params: { date }`); a future date (`date_in_future`); an invalid amount (`balance`, `invalid_amount`). A linked account is refused with `ACCOUNT_LINKED`.
- The write runs in one transaction: the anchor keeps its id and kind; balances, and an investment account's holdings, are computed again from the earlier of the old and new dates; rows dated before a later new date are deleted, as `restoreOpening` does.
- A new snapshot dated on the opening date sets the anchor's amount, kind and date unchanged, as Sure's `prepare_reconciliation`; one dated before stays refused, with the snapshot code `before_opening_date`. Moving an existing snapshot onto the opening date answers `snapshot_exists`, as Sure's uniqueness validation. `record_valuation` goes through the same path and answers `replaced_existing: true`.
- `set_opening_balance` takes Sure's `account_id`, `balance` (a JSON number read through its decimal text), optional `date`, `dry_run`, with Sure's description. Refusals, in Sure's order, `{ success: false, error, message }` with Sure's messages: `not_found` (unknown or inactive account), `linked_account`, `invalid_balance`, `invalid_date` for a malformed or empty date, `invalid_date` plus `oldest_entry_date` for a date on or after the oldest entry, `invalid_date` for a future date. An omitted date keeps the current one. The answer is Sure's: `success`, `dry_run: true` or `changed`, `account { id, name, currency }`, `before` and `after` `{ date, balance }` in Story 27.9's decimal text, `current_balance { changes, by?, reason }` with Sure's three reasons (a later snapshot, an unchanged amount, otherwise moved by the difference). A dry run writes nothing and records `changedRows: 0`.

**Never:** no deletion of the opening anchor (AD-8 keeps exactly one); no Sure confirmation step before saving, absent from Archant's snapshots too; no change to lines before the opening date (still refused, row « Lines before the opening date »), to imports' opening move, to `restoreOpening` (Story 27.21), to statement balances on the opening date or to `rotateCurrentAnchor`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Earlier date | opened 2026-01-10 at 1 500, line 2026-01-15; set 2025-12-01, 1 000 | rows from 2025-12-01, today's balance −500 | none |
| Later date | same; set 2026-01-12 | rows before 2026-01-12 gone | none |
| On the oldest entry | set 2026-01-15 | nothing written | 400 `not_before_oldest_entry`, `params.date` 2026-01-15 |
| Snapshot on opening date | POST snapshot 2026-01-10, 1 800 | anchor 1 800, no reconciliation | none |
| Later snapshot | snapshot 2026-02-01; tool sets 1 000 | `current_balance.changes: false`, reason names 2026-02-01 | none |
| Linked account | `bank_account_id` set | row not clickable | route 409 `ACCOUNT_LINKED`; tool `linked_account` |
| Dry run | `dry_run: true` | `before`, `after`, effect; nothing written | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/balances.ts:286-375,419-438` -- `recomputeBalances`, `accountWithOpeningDate`, `openingAnchorOf`; reuse.
- `packages/api/src/services/ledger/import-revert.ts:110-150` -- `restoreOpening`: the in-place anchor update and the delete of rows before a later date to copy; leave unchanged.
- `packages/api/src/services/ledger/holdings.ts:93-104` -- holdings recomputed from the opening date.
- `packages/api/src/domain/balances/snapshot.ts:7-32` -- `snapshotRejectionFor`: `<` instead of `<=`, a new outcome for the opening day; rewrite its comment.
- `packages/api/src/services/ledger/snapshots.ts:118-219` -- `recordSnapshot` updates the anchor on its day; `updateSnapshot` answers `SNAPSHOT_EXISTS` there.
- `packages/api/src/services/snapshots.ts:31-35` -- `REJECTION_FIELDS`: `before_opening_date` for snapshots; transactions keep `not_after_opening_date`.
- `packages/api/src/services/accounts.ts:154-184` -- `AccountDetail` gains `openingBalance`, so « Soldes » draws the row without a new read.
- `packages/api/src/schemas/accounts.ts:345-363` -- the fixed-at-creation comment; add `openingBalanceSchema(currency)` beside `snapshotBodySchema` (`schemas/snapshots.ts`).
- `packages/api/src/routes/accounts.ts:62-70` -- add the PATCH beside the snapshot routes.
- `packages/api/src/lib/errors.ts:165` -- `ACCOUNT_LINKED`, reused.
- `packages/api/src/mcp/snapshots.ts:146-238` -- `record_valuation`'s pattern; `mcp/tool.ts:129-156,190,360-386` `SURE_REFUSALS`, `refuse`, `sureDecimalText`; `schemas/assistants.ts:1310` the input beside `recordValuationInput`.
- `packages/api/src/mcp/server.ts:85-133,176-179` -- `TOOLS` and « To record a balance: ».
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:211-262,502-514,743-748` -- `SnapshotsPanel`, `writable`, the dialogs.
- `packages/app/src/components/SnapshotList.tsx`, `SnapshotDialog.tsx`, `TransactionSheet.tsx` -- the list, the form to mirror, the sheet to copy.
- `packages/app/src/hooks/useSnapshots.ts` -- add `useSetOpeningBalance`, invalidated through `useInvalidateAccount`.
- `packages/app/src/locales/fr.json:239,2378` -- `accountActions.form.description` no longer says the opening balance is fixed; new keys.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/ledger/opening.spec.ts` -- first: earlier date, later date, refused on the oldest entry, a future date, the holdings of an investment account.
- [x] `packages/api/src/services/ledger/snapshots.spec.ts`, `domain/balances/snapshot.spec.ts` -- first: the opening-day snapshot rewrites the anchor; :108 and :233 change.
- [x] `packages/api/src/services/ledger/opening.ts` -- `setOpeningBalance(deps, accountId, { date?, balance, notes? }, { dryRun })`, returning `before`, `after` and the later snapshot's date, shared by route and tool.
- [x] `domain/balances/snapshot.ts`, `services/ledger/snapshots.ts`, `services/snapshots.ts` -- the opening-day rule.
- [x] `schemas/accounts.ts`, `services/accounts.ts`, `routes/accounts.ts` + `routes/accounts.spec.ts` -- the route and `openingBalance`; the spec covers a viewer's 403 and each refusal.
- [x] `packages/api/src/mcp/opening-balance.ts` + `.spec.ts`, `mcp/server.ts`, `mcp/server.spec.ts` -- the tool, each case of the matrix and of Sure's test file.
- [x] `packages/app/src/components/OpeningBalanceSheet.tsx`, `SnapshotList.tsx`, the account route, `useSnapshots.ts`, `fr.json` -- the row and the sheet; `not_before_oldest_entry` reads « La date doit précéder la plus ancienne opération du compte, le {{date}}. », `before_opening_date` « La date ne peut pas précéder celle du solde d'ouverture. »
- [x] `packages/app/e2e/snapshots.spec.ts` -- edit an opening balance to an earlier date and read the new balance; a date on the oldest line shows the error; `viewer.spec.ts`: a viewer sees the row without the sheet.
- [x] `docs/architecture.md` AD-8, `docs/sure-parity.md:85-86`, `docs/deployment.md:321,331`, `docs/security-model.md:75` -- AD-8: the opening anchor is moved in place, before the oldest entry, and a snapshot on its day sets it; both rows Parity, Story 27.17; the tool listed.

**Acceptance Criteria:**
- Given an opening balance edited, when `get_valuations` runs, then the anchor shows the new date and amount under the same `id`.
- Given a loan, when its opening balance changes, then its original principal reads the new amount, as Sure's « Original principal ».

## Design Notes

Sure's drawer refuses no date but the future; only `OpeningBalanceManager`, behind the tool, refuses one on or after the oldest entry. Archant refuses any line on or before the opening date (`BEFORE_OPENING_DATE`), so the route must refuse it too, as the epic says.

The linked account's row is read-only, where Sure's drawer is not gated: Archant computes a linked account backward and ignores the anchor's amount (`domain/balances/reverse.ts:24-30`, row « Opening amount on a linked account »), so an edited amount would look saved and change nothing. Sure's tool refuses it for the same reason.

The future-date refusal in the tool is Archant's: Sure's tool accepts one on an empty account, and Archant's balances never start after today.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run src/services/ledger src/mcp src/routes/accounts.spec.ts` -- expected: pass.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green.

**Manual checks (if no CLI):**
- Screenshots, light and dark: the « Soldes » tab with its opening row, the sheet, the date error.

## Implementation Notes

- `openingBalanceSchema` lives in `schemas/snapshots.ts`, beside the snapshot schemas it extends with `EARLIEST_OPENING_DATE`; the route takes `snapshotBodySchema` and the service parses the full schema in the account's currency.
- `findSnapshot` reads the opening anchor too, with no gap, so a snapshot recorded on the opening date can answer its row; `PATCH` and `DELETE /api/snapshots/:id` still answer `NOT_FOUND` for it.
- Without a date, `set_opening_balance` sends the current opening date, since the route requires one; the effect is Sure's.
- `RAILS_FALSE` moved from `mcp/bills.ts` to `mcp/tool.ts`, shared by `update_bill` and `set_opening_balance`.
- The opening row shows on the last page of « Soldes » only, and replaces the « Aucun solde saisi. » note.
- After review: nothing changed writes nothing and records `changedRows: 0`; a snapshot on a linked account's opening date stays refused, since its anchor amount counts in no balance; a date before 1900 is refused with `date_too_early`.
- After the standards and spec review: a snapshot on a linked account's opening date answers `not_after_opening_date`, whose « postérieure » text holds there, rather than `before_opening_date`; `set_opening_balance` names its 1900 floor.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Evidence | Route |
|---|--------|---------|---------|----------|-------|
| 1 | blind, edge | An unchanged opening balance is written, recomputed and recorded as `changedRows: 1` | medium | `setOpeningBalance` updated and recomputed whatever `moved`; Sure's `update_opening_anchor` saves only on a change | patch |
| 2 | blind | The recompute comment says « the earlier of the two dates » while the code passes the new date | low | The rows before a later date are deleted first, so the new date is right; only the comment misled | patch |
| 3 | blind | A dry run takes an immediate write lock | low | One household, one short read | reject |
| 4 | blind | No test shows `/api/snapshots/:id` refuses the anchor now that `findSnapshot` reads it | medium | `snapshotRow` refuses it, untested | patch |
| 5 | blind | Creating a snapshot on the opening date answers the anchor's id | low | Sure's `prepare_reconciliation` updates that same valuation; the list shows it in its opening row | reject |
| 6 | blind | The snapshot form gives no hint that the opening date replaces the opening balance | false | Sure's form gives none either | reject |
| 7 | blind | The `set_opening_balance` text split the `record_valuation` passage of `docs/deployment.md` | medium | « As in Sure, the source is required » followed it | patch |
| 8 | blind | `docs/security-model.md` said an opening balance is deleted and carries a citation | medium | Neither holds for the anchor | patch |
| 9 | blind | `FieldMessage` handles one parametrised code by hand | low | It renders right; a general params path adds surface | reject |
| 10 | blind, edge | `openingBalanceSchema` only returned `createSnapshotSchema`, and nothing refused a date before 1900 | medium | A year-1 date recomputed a row per day for centuries in one transaction | patch |
| 11 | blind | `getAccount` runs three times per tool call | low | A few reads per assistant call | reject |
| 12 | blind | A hand edit then an import revert re-applies the import's shift | low | The frozen Never leaves `restoreOpening` to Story 27.21, which stores the shift | reject |
| 13 | blind | A later date on an investment account is untested | medium | Only the earlier date covered holdings | patch |
| 14 | blind | The route accepts an inactive account the tool refuses | low | Snapshots accept an inactive account too; the tool's `not_found` is Sure's `visible` | reject |
| 15 | blind, gap | Nothing checks a linked account's opening row cannot be opened | medium | `viewer.spec.ts` fails on the role, never on the bank connection | patch |
| 16 | blind | « Tous les soldes suivants seront recalculés » is wrong after a later snapshot | false | Sure's `recalculate_notice` says the same | reject |
| 17 | blind | Spec and sprint status disagree | false | Both move to `done` at the end of the review | reject |
| 18 | edge, gap | A snapshot on a linked account's opening date rewrites an amount no balance reads | medium | `recordSnapshot` skipped `bankAccountId` on the opening-day path; the route and tool refuse such an account | patch |
| 19 | edge | A later opening date can put a loan's rate change before origination | low | Sure's tool does not guard it either, and it needs a loan without a start date | reject |
| 20 | edge | A pinned balance and an unchanged amount answer the pinned reason | false | Sure's `current_balance_effect` checks the later reconciliation first | reject |
| 21 | edge | A linked account's opening row shows an amount no balance starts from | low | The frozen block lists the row for every account; Sure shows it too | reject |
| 22 | edge | The tab shows nothing while the account loads | low | The account query is already loaded for the page header | reject |
| 23 | gap | The opening row on the last page only is untested | low | Needs more than a page of snapshots in e2e | defer |
