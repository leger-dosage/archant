---
title: 'Story 1.4: Balance snapshots'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_commit: '35edf916fdfcd7f3809784e6242f0d0c9dd1e1ea'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant's balance drifts from the bank's as soon as one transaction is missing or wrong, and the household has no way to pin it back to what the bank shows.

**Approach:** Let the user record, edit and delete a balance snapshot (a `reconciliation` valuation, AD-8) at a date, through the ledger, which recomputes balances from that date. Add a Soldes tab on `/comptes/$accountId` listing snapshots with the recorded balance, the balance Archant computed for that day, and the gap between them.

## Boundaries & Constraints

**Always:**
- Spine AD-2, AD-5, AD-8, AD-15 and the Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- A snapshot is an `entries` row, `kind: "valuation"`, `valuation_kind: "reconciliation"`, amount the stored balance (AD-5): a liability's snapshot is the amount owed, positive. It fixes that day's end-of-day balance; that day's transactions do not move it, and the next day continues from it. `forwardBalances` already does this, as Sure's `Balance::ForwardCalculator`.
- The computed balance of a snapshot day is `balance(date - 1) + sign × sum(transactions on date)`, sign as in `forwardBalances`. The gap is `recorded - computed`, in minor units, derived at read time and never stored.
- Date strictly after the opening date and not after today in `APP_TIMEZONE`, as Sure's valuation form limits it. Otherwise `400 VALIDATION_ERROR` on field `date`, codes `not_after_opening_date` and `date_in_future`.
- One snapshot per account and date, enforced by a partial unique index. Recording one on a date that has one updates it in place, same id. Editing one onto a date another snapshot holds is refused, field `date`, code `snapshot_exists`: an edit never deletes a second snapshot silently.
- Balance typed as signed text through `parseAmount` in the account currency; a checking account can be overdrawn, so no Dépense / Revenu toggle.
- Routes: `GET` and `POST /api/accounts/:id/snapshots`, `PATCH` and `DELETE /api/snapshots/:id`. The list follows AD-15: `page`, `pageSize`, `{ items, page, pageSize, total }`, most recent first. Items are `{ id, accountId, date, balance, computed, gap, currency }`.
- Interface: tabs « Opérations » and « Soldes » under the chart, in the `tab` search param (`transactions` default and absent from the URL, `snapshots`). The Soldes tab holds « Ajouter un solde » and a real table: Date, Solde saisi, Solde calculé, Écart. A zero gap reads « — ». Amounts through `Money`, never coloured. A row opens a dialog with date and balance, Enregistrer, and Supprimer behind a confirmation. Empty state « Aucun solde saisi. ».
- Every snapshot write refreshes the header balance, the chart, the sidebar and the Soldes table; every transaction write refreshes the Soldes table, whose gaps depend on it.

**Never:**
- No Imports or Paramètres tab, no snapshot marker on the chart, no notes on a snapshot, no editing of the opening balance.
- No `import_id` or source column: Story 2.2 adds it with the import-owned snapshots.
- No change to `forwardBalances` or to the transaction rules. No raw SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pin the balance | Checking opened 2026-01-10 at `1 500,00`, transaction `-120,00` on 2026-03-02; snapshot `2 000,00` on 2026-03-05 | Balance on 03-05 is `200000`; a `-50,00` on 03-06 gives `195000` | — |
| Gap | Same | Item `computed 138000`, `gap 62000` | — |
| Same-day transaction | Snapshot `2 000,00` and a `-30,00` transaction on 03-05 | 03-05 stays `200000`; `computed` drops by `3000`, `gap` rises by `3000` | — |
| Replace | Second `POST` on 03-05 with `1 990,00` | Same id, balance `199000`, one row in the list | — |
| Edit | Date moved from 03-05 to 02-20 | Balances recomputed from 02-20 | — |
| Edit onto a taken date | Snapshots on 02-20 and 03-05; move 03-05 to 02-20 | Nothing written | `400`, field `date`, `snapshot_exists` |
| Delete | Delete the 03-05 snapshot | Balances from 03-05 follow transactions again | — |
| Liability | Card owing `490,30`; snapshot `520,00` | Stored `52000`; `gap` is `52000 - computed` | — |
| Overdraft | Checking snapshot `-80,00` | Stored `-8000` | — |
| Opening day | Snapshot on the opening date | Nothing written | `400`, `not_after_opening_date` |
| Future | Snapshot tomorrow | Nothing written | `400`, `date_in_future` |
| Bad amount | `12,345` in EUR | Nothing written | `400`, field `balance`, `invalid_amount` |
| Unknown ids | Unknown account or snapshot | — | `404 NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- single writer (AD-2). `recomputeBalances` (L69) reads `reconciliation` valuations already (`FORWARD_VALUATION_KINDS`, L46); do not touch it. Pattern for writes: `updateTransaction` (L332), `deleteTransaction` (L400), one `immediate` transaction, recompute from `minDate(old, new)`. `accountWithOpeningDate` (L141) gives type, currency and opening date. `.oxlintrc.json` bans the `entries` and `balances` schemas outside this file, so the snapshot reads live here too.
- `packages/api/src/domain/balances/forward.ts` -- `forwardBalances` (L37): valuation wins over the day's movements. Its sign rule is what the gap computation must mirror.
- `packages/api/src/domain/statement.ts` -- `rejectionFor` (L41) and `RejectionCode` are transaction rules (366 days ahead allowed); snapshots get their own rule.
- `packages/data/schema/entries.ts` -- `entries_one_opening_anchor` (L45) is the partial unique index pattern. `pnpm data generate` writes `drizzle/0002_*.sql`.
- `packages/api/src/services/transactions.ts` -- `REJECTION_FIELDS` and `rejectionError` (L33–47) map ledger refusals to field errors; `createTransaction` (L78) parses per currency after `getAccount`.
- `packages/api/src/schemas/transactions.ts` -- body-as-text pattern, `amountIn` refinement (L41), `pageQuerySchema` (L103).
- `packages/api/src/routes/accounts.ts`, `routes/transactions.ts`, `app.ts` -- route patterns; mount `/snapshots` in the chain so `AppType` stays typed.
- `packages/api/src/app.spec.ts` -- helpers `request`, `openAccount`, `postTransaction` (L224–248).
- `packages/web/src/routes/comptes.$accountId.tsx` -- `searchSchema` (L25), transactions section and pagination nav (L118–212) move into the Opérations tab.
- `packages/web/src/hooks/useTransactions.ts` -- `useInvalidateAccount` (L38) invalidates `accounts.detail(id)`; a snapshots key under it is refreshed by transaction writes with no change there.
- `packages/web/src/components/CreateAccountDialog.tsx`, `ConfirmDialog.tsx`, `DateField.tsx`, `lib/form-errors.ts` -- dialog form, confirmation and field-error mapping to reuse.
- `~/github/sure/app/models/account/reconciliation_manager.rb` (L83–98, same-date update), `app/components/UI/account/balance_reconciliation.rb` (computed end balance and adjustments) -- reference.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/entries.ts`, `drizzle/0002_*.sql` -- partial unique index `entries_one_reconciliation_per_day` on `(account_id, date)` where `valuation_kind = 'reconciliation'`; generate with `pnpm data generate`.
- [x] `packages/api/src/domain/balances/snapshot.spec.ts`, `snapshot.ts` (new) -- tests first, then `snapshotRejectionFor(date, { openingDate, today })` and `snapshotGap({ previous, movements, recorded, classification })` returning `{ computed, gap }`. 100% branches.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- tests first, then `recordSnapshot`, `updateSnapshot`, `deleteSnapshot` (each takes `origin`, recomputes in its transaction, returns a rejection like `UpdateResult`) and `listSnapshots` (page, plus `computed` and `gap` from the `D - 1` balance rows and the day's movement sums, three queries per page, not one per row).
- [x] `packages/api/src/schemas/snapshots.ts` (new) -- body `{ date, balance }` as text, `createSnapshotSchema(currency)`, `updateSnapshotSchema(currency)`, shared with the form resolver.
- [x] `packages/api/src/services/snapshots.ts` (new), `routes/accounts.ts`, `routes/snapshots.ts` (new), `app.ts`, `app.spec.ts` -- the four routes; the spec covers the I/O matrix through `app.request`.
- [x] `packages/web/src/components/ui/tabs.tsx` -- `pnpm dlx shadcn add tabs`, patched for oxlint as the other `ui/` files.
- [x] `packages/web/src/lib/query-keys.ts`, `hooks/useSnapshots.ts` (new) -- `accounts.snapshots(id, page)` = `["accounts", "detail", id, "snapshots", page]`; list, create, update, delete hooks invalidating as `useInvalidateAccount` does.
- [x] `packages/web/src/components/Pagination.tsx` (new), `SnapshotList.tsx` (new), `SnapshotDialog.tsx` (new), `routes/comptes.$accountId.tsx`, `locales/fr.json` -- extract the pagination nav, add the tabs with `tab` and `snapshotsPage` search params (`.catch(undefined)`), the table, the dialog, the empty state and the error codes.

**Acceptance Criteria:**
- Given a snapshot saved, edited or deleted, when the dialog closes, then the header balance, the chart and the Soldes table show the new values without a reload.
- Given a transaction added on a snapshot's date, when the sheet closes, then that snapshot's Écart changes and the header balance does not.
- Given `/comptes/<id>?tab=snapshots` opened directly, then the Soldes tab is selected.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Implementation Notes

- `listSnapshots` reads a page, its count, the `D - 1` balance rows and the day's movement sums: four queries per page whatever its size. `gapReader` in `ledger.ts` throws `INTERNAL_ERROR` if a snapshot has no balance row the day before, which no write path can produce.
- A positive gap reads `+620,00 €` through `formatSignedMoney`, uncoloured, like the chart's change; `Money` signs only coloured transaction amounts.
- « Ajouter un solde » is disabled while the account opened today or later: no date can be valid yet.
- `pageSearch` moved to `lib/page-search.ts` and serves both the pagination links and the page clamp; pagination strings moved from `transactions.pagination.*` to `pagination.*`.
- A `POST` that replaces a snapshot answers `201` like a creation, with the kept id.
- Verified in Chromium on a throwaway database: checking opened 2026-06-01 at `1 500,00`, `-120,00` on 08-02, `+2 400,00` on 09-10, `-950,00` on 09-15. `?tab=snapshots` selects Soldes and shows « Aucun solde saisi. »; recording `3 000,00` on 12/09/2026 moves the header from `2 830,00 €` to `2 050,00 €`, the row reads `3 000,00 € / 3 780,00 € / −780,00 €`, focus returns to « Ajouter un solde »; a `-50,00` on 09-12 then moves the gap to `−730,00 €` and leaves the header. Light 1280 px and dark 600 px checked.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `comptes.$accountId.tsx` `canAdd`, `SnapshotDialog.tsx` `valuesOf` | An account opened today offers « Ajouter un solde », but no date is both after opening and not after today | medium | The create dialog defaults to opening today; every submission then fails with `not_after_opening_date`. | patch |
| 2 | verification | `schemas/snapshots.ts` `updateSnapshotSchema` | No test pins the ISO date check of a `PATCH` | medium | Pre-verified: loosening it to `z.string()` passes every test, and `snapshotRejectionFor` compares strings, so `2026-02-5` would be stored. | patch |
| 3 | blind | `ledger.ts` `snapshotRow` | `PATCH`/`DELETE` with the opening anchor's id is untested | low | The `reconciliation` filter protects the anchor today; the test is one case and guards the one path that could erase the opening balance. | patch |
| 4 | verification | `Pagination.tsx` `pageSearch`, route `useClampPage` | The page-param mapping is written twice and untested | medium | Pre-verified: swapping either copy passes every test; Suivant on Soldes would then move the transactions page. | patch |
| 5 | blind, edge | `locales/fr.json` `transactions.title` | Orphan key after the `<h2>` gave way to the tabs | low | No reader left; direct deletion. The tab list names the panels for screen readers. | patch |
| 6 | blind, edge | `SnapshotDialog.tsx` default date | Browser date versus `APP_TIMEZONE` near midnight | low | Same as `TransactionSheet` since Story 1.2; one household in one zone. Rejected. |  |
| 7 | blind | `ledger.ts` `recordSnapshot` | Create on a taken date replaces silently | false | The frozen intent and the story's AC say a second snapshot on the same date replaces the first. |  |
| 8 | blind | `SnapshotDialog.tsx` | No unsaved-changes prompt on close | low | EXPERIENCE.md asks it of the transaction sheet; a two-field dialog loses little. Rejected. |  |
| 9 | blind | `ledger.spec.ts` | Rollback tested for `recordSnapshot` only | low | Update and delete use the same `immediate` transaction and recompute; adding tests adds no guard. Rejected. |  |
| 10 | blind | `ledger.ts` `gapReader` | `INTERNAL_ERROR` if the opening date moves past a snapshot | false | No code path moves the opening date; Story 1.6 edits name and subtype only. |  |
| 11 | blind | web | No component or end-to-end tests for the tab, list and dialog | low | The web package has no component harness (Story 1.3 #11, deferred). | defer |
| 12 | blind | spec, `sprint-status.yaml` | Statuses disagree | false | Step 5 moves both to their final state. |  |
| 13 | blind | `ledger.ts` snapshot writes | `origin` unused without comment | low | Same `_options` as `createAccount` and `deleteTransaction`; snapshots have no locked fields. Rejected. |  |
| 14 | blind | `services/snapshots.ts` `updateSnapshot` | Reads the gap twice per edit | low | Three indexed reads on a user click. Rejected. |  |
| 15 | blind | `SnapshotRecord` | `currency: string`, `balance: number` in the raw row | low | `balance` is branded `MinorUnits` on the record; same shape as `TransactionRecord`. Rejected. |  |
| 16 | blind | `SnapshotDialog.tsx` | Supprimer and Annuler stay active while saving | low | A double action needs deliberate clicks within one request. Rejected. |  |
| 17 | edge | `SnapshotDialog.tsx` `onCloseAutoFocus` | Focus falls to the body after deleting the opener row | low | Same fallback as `TransactionSheet`; fixing it adds a branch. Rejected. |  |
| 18 | edge | `services/snapshots.ts` re-read | A concurrent delete between write and re-read returns 404 | low | Needs two writers on one household's snapshot within milliseconds. Rejected. |  |
| 19 | edge | `ledger.ts` `listSnapshots` | Page, count and gap reads are not one transaction | low | Same as `listTransactions`; a stale total self-corrects on the next read. Rejected. |  |
| 20 | edge (claim) | `ledger.ts` `listSnapshots` | Four queries, not three | low | The count is the fourth; still constant per page, which is the point. Rejected. |  |
| 21 | edge (claim) | `ledger.ts` `deleteSnapshot` | Returns `void`, not a rejection | low | Delete has nothing to refuse, like `deleteTransaction`. Rejected. |  |

## Design Notes

A Soldes tab rather than Sure's mixed activity feed: EXPERIENCE.md names the account tabs Opérations and Soldes, and keeping valuations out of the transaction list keeps Story 1.5's cross-account list and its totals free of rows that are not flows.

Sure's same-date lookup ignores the valuation kind, so a "reconciliation" on the opening date rewrites the opening anchor. Archant refuses that date instead; changing the opening balance is not part of Epic 1.

The gap's `previous` row always exists: a snapshot is dated after the opening date, and balances are written from the opening date on.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, coverage thresholds met, `git status` clean afterwards.
- `pnpm data migrate:local` -- applies `0002` on an existing local database.

**Manual checks:**
- On a checking and a card account: record a snapshot, check the header, the chart and the gap; record a second one on the same date; move and delete one; add a transaction on a snapshot day; light and dark, 1280 and 600 px.
