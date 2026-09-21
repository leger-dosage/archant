---
title: 'Story 1.4: Balance snapshots'
type: 'feature'
created: '2026-09-21'
status: 'ready-for-dev'
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
- [ ] `packages/data/schema/entries.ts`, `drizzle/0002_*.sql` -- partial unique index `entries_one_reconciliation_per_day` on `(account_id, date)` where `valuation_kind = 'reconciliation'`; generate with `pnpm data generate`.
- [ ] `packages/api/src/domain/balances/snapshot.spec.ts`, `snapshot.ts` (new) -- tests first, then `snapshotRejectionFor(date, { openingDate, today })` and `snapshotGap({ previous, movements, recorded, classification })` returning `{ computed, gap }`. 100% branches.
- [ ] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- tests first, then `recordSnapshot`, `updateSnapshot`, `deleteSnapshot` (each takes `origin`, recomputes in its transaction, returns a rejection like `UpdateResult`) and `listSnapshots` (page, plus `computed` and `gap` from the `D - 1` balance rows and the day's movement sums, three queries per page, not one per row).
- [ ] `packages/api/src/schemas/snapshots.ts` (new) -- body `{ date, balance }` as text, `createSnapshotSchema(currency)`, `updateSnapshotSchema(currency)`, shared with the form resolver.
- [ ] `packages/api/src/services/snapshots.ts` (new), `routes/accounts.ts`, `routes/snapshots.ts` (new), `app.ts`, `app.spec.ts` -- the four routes; the spec covers the I/O matrix through `app.request`.
- [ ] `packages/web/src/components/ui/tabs.tsx` -- `pnpm dlx shadcn add tabs`, patched for oxlint as the other `ui/` files.
- [ ] `packages/web/src/lib/query-keys.ts`, `hooks/useSnapshots.ts` (new) -- `accounts.snapshots(id, page)` = `["accounts", "detail", id, "snapshots", page]`; list, create, update, delete hooks invalidating as `useInvalidateAccount` does.
- [ ] `packages/web/src/components/Pagination.tsx` (new), `SnapshotList.tsx` (new), `SnapshotDialog.tsx` (new), `routes/comptes.$accountId.tsx`, `locales/fr.json` -- extract the pagination nav, add the tabs with `tab` and `snapshotsPage` search params (`.catch(undefined)`), the table, the dialog, the empty state and the error codes.

**Acceptance Criteria:**
- Given a snapshot saved, edited or deleted, when the dialog closes, then the header balance, the chart and the Soldes table show the new values without a reload.
- Given a transaction added on a snapshot's date, when the sheet closes, then that snapshot's Écart changes and the header balance does not.
- Given `/comptes/<id>?tab=snapshots` opened directly, then the Soldes tab is selected.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Implementation Notes

## Spec Change Log

## Review Triage Log

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
