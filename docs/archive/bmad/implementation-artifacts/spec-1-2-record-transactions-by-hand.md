---
title: 'Story 1.2: Record transactions by hand'
type: 'feature'
created: '2026-09-21'
status: 'done'
baseline_commit: 'b686f4803251ac66335cca403cc42a39816e671b'
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

**Problem:** An account holds only its opening balance. The household cannot record what happened since, so every balance Archant shows is stale from day one.

**Approach:** Add a `transactions` table and a ledger that ingests, edits and deletes a manual transaction and recomputes the account's daily balances in the same database transaction (AD-2, AD-4, AD-5). A new account page `/comptes/$accountId` shows the balance and the account's transactions, most recent first, with a sheet to add or edit one and a confirmed delete.

## Boundaries & Constraints

**Always:**
- Spine AD-2, AD-4, AD-5, AD-6, AD-7, AD-8, AD-10, AD-15 and the Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- Balances are recomputed in the write's own `immediate` transaction, from the earliest affected date (for an edit, the earlier of the old and new dates) to `max(today, latest entry date)`. Rows past that end are deleted. Asset day balance is `previous + sum`, liability `previous - sum`.
- Manual creation goes through `ledger.ingest(accountId, statement, { manual: true }, { origin: "user" })`. Only steps 1 (reject lines not after the opening anchor), 4 (insert) and 8 (recompute) exist; later steps land in their slot with their epic. No `entry_keys`, no `dryRun`.
- The currency of a transaction is its account's; the request carries none.
- The opening balance is the end-of-day balance of its date, as in Sure (`Balance::ForwardCalculator` lets a valuation override that day's flows; `Account::OpeningBalanceManager#set_opening_balance` keeps the anchor strictly before the oldest entry). A transaction must therefore be dated after the opening date: on or before it answers `400 VALIDATION_ERROR` with `fields: [{ path: "date", code: "not_after_opening_date" }]`, on create and on edit. A date more than 366 days after today answers `date_too_late`: a year typo would otherwise write tens of thousands of balance rows under the write lock.
- Label is trimmed, 1 to 200 characters. Notes are optional, trimmed, at most 2 000 characters, blank stored as null. A zero amount is accepted, as in Sure.
- `origin: "user"` writes add field names to `transactions.locked_fields`: every field filled on create, every changed field on edit (AD-10).
- The amount field has a Dépense / Revenu toggle, Dépense by default; typing a leading minus switches it to Dépense. The form sends a signed amount as text, parsed by `parseAmount` with the account's currency, through one schema shared by the form resolver and the API.
- The sheet saves on `⌘Enter`/`Ctrl+Enter` or Enregistrer, closes on `Esc` or Annuler, and asks « Abandonner les modifications ? » only when the form is dirty. It shows the source line « Saisie manuelle ». No success toast.
- Delete is a « Supprimer » button in the sheet of an existing transaction, confirmed by an alert dialog stating what is lost, focus on Annuler.
- Account rows on `/comptes` and in the sidebar become links to `/comptes/$accountId`.

**Never:**
- No chart, no tabs, no Soldes/Imports/Paramètres surfaces, no category, merchant, tags or exclude fields, no cross-account `/operations` list, no keyboard shortcuts beyond the sheet's (all later stories).
- No `transfers` table: AD-11's transfer cleanup arrives with Epic 5.
- No change to the opening balance or date, no valuations shown in the list.
- No raw SQL; no new npm dependency (`alert-dialog` comes from the existing `radix-ui` package through the shadcn CLI).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create expense | Checking opened 2026-09-01 at `1 234,56`; `2026-09-10`, `Boulangerie`, `-42,90` | `201`, amount `-4290` in `EUR`; balance from 2026-09-10 on is `119166` | — |
| Card purchase | Card owing `490,30`; `-30,00` | Stored `-3000`; card balance `520,30` | — |
| Edit amount and date | `-42,90` on 09-10 becomes `-50,00` on 09-05 | Balances recomputed from 09-05; `locked_fields` holds `date`, `amount` | — |
| Delete | Existing transaction | `200 { data: { id } }`; balance back to its previous value | Unknown id: `404 NOT_FOUND` |
| On or before opening | `2026-09-01` or `2026-08-31` | `400`, `fields: [{ path: "date", code: "not_after_opening_date" }]` | Message under the date |
| Far future | today + 400 days | `400`, `code: "date_too_late"` | Message under the date |
| Bad input | label `"  "`, amount `12,3,4` | `400`, both fields reported together | Messages under the fields |
| Unknown account | `GET /api/accounts/nope/transactions` | `404 NOT_FOUND` | Page shows « Compte introuvable » with a link to `/comptes` |
| Ordering | Two transactions on one day | `date DESC, created_at DESC, id DESC`, 50 per page | — |

</frozen-after-approval>

## Code Map

- `packages/data/schema/entries.ts` -- `entries` has no label or notes; transactions are rows with `kind = 'transaction'`. Keep it unchanged.
- `packages/data/schema/transactions.ts` (new) -- `transactions (entry_id PK → entries.id ON DELETE RESTRICT, label, notes, locked_fields JSON text default '[]')`, per AD-8. Add to `exports`, `types.ts`, a new migration via drizzle-kit.
- `.oxlintrc.json` -- add `@archant/data/schema/transactions` to the `packages/api/src/**` ban that already covers `entries` and `balances`.
- `packages/api/src/domain/balances/forward.ts` -- `forwardBalances(anchor, until)` ignores transactions; extend it with day movements and the account's classification. 100% branch threshold in `vitest.config.ts`.
- `packages/api/src/domain/statement.ts` (new) -- `ParsedStatement` / `NormalizedTransaction` holding only the fields this story stores (`date`, `amount`, `currency`, `label`, `notes`); Epic 2 adds the rest with their columns, so no field is silently dropped.
- `packages/api/src/services/ledger.ts` -- `createAccount` (L39) shows the `immediate` transaction and the sequential chunked insert (`BALANCE_ROWS_PER_INSERT`); `Origin` (L18) exists unused. Extract the recompute from `createAccount` into one private function every write calls. `balanceOn` (L96) stays the only reader.
- `packages/api/src/services/accounts.ts` -- `summarise` (L37); add `getAccount(deps, id)` returning the summary plus `classification` and `openingDate`, throwing `AppError("NOT_FOUND")`.
- `packages/api/src/schemas/accounts.ts` -- pattern to copy: amount as text, `superRefine` then `transform` with `parseAmount`, custom issue message = field code.
- `packages/api/src/routes/accounts.ts`, `app.ts` (`createApi`, L18) -- chained mounts keep `AppType` typed; `zValidator` hook throws `validationError`.
- `packages/web/src/components/CreateAccountDialog.tsx` -- form pattern (`zodResolver(..., { raw: true })`, `applyFieldErrors`, toast fallback). `DateField.tsx`, `Money.tsx`, `lib/api.ts` (`unwrap`), `lib/query-keys.ts`, `hooks/useAccounts.ts`, `AccountGroups.tsx` (rows are `<li>`, L34–46), `AppSidebar.tsx`.
- `~/github/sure/app/controllers/transactions_controller.rb`, `app/models/entry.rb` -- reference for the nature toggle, hard delete and locking on create and update. Sure stores expenses positive; Archant does not (AD-5).

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/transactions.ts`, `types.ts`, `package.json`, `drizzle/0001_*`, `migrate.spec.ts`, `.oxlintrc.json` -- table, exports, generated migration, lint ban -- storage first.
- [x] `packages/api/src/domain/balances/forward.spec.ts`, `forward.ts` -- tests first: no movement, several movements on one day, the anchor day carrying exactly the anchor, a gap day carrying the previous balance, a liability, a start date after the anchor from a given previous balance. 100% branches.
- [x] `packages/api/src/domain/statement.ts` -- the narrowed statement types.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- tests first, then `ingest`, `updateTransaction(deps, entryId, patch, { origin })`, `deleteTransaction(deps, entryId, { origin })` and the shared recompute: the I/O matrix rows, locked fields, rollback leaving no row when the recompute fails, rows past the new end deleted after a delete. 100% branches.
- [x] `packages/api/src/services/transactions.ts` -- `listAccountTransactions(deps, accountId, { page, pageSize })` returning `{ items, page, pageSize, total }`, `createTransaction`, `updateTransaction`, `deleteTransaction`; each item carries `source: "manual"`. Maps an ingest rejection to `VALIDATION_ERROR` on `date`.
- [x] `packages/api/src/schemas/transactions.ts` -- create and update schemas shared with the web form, list query schema (`page` ≥ 1, `pageSize` 1–200, default 50).
- [x] `packages/api/src/routes/accounts.ts`, `routes/transactions.ts`, `app.ts`, `app.spec.ts` -- `GET /api/accounts/:id`, `GET` and `POST /api/accounts/:id/transactions`, `PATCH` and `DELETE /api/transactions/:id`; spec covers the I/O matrix through `app.request`.
- [x] `packages/web/src/lib/query-keys.ts`, `hooks/useAccount.ts`, `hooks/useTransactions.ts` -- keys `accounts.detail(id)`, `transactions.byAccount(id, page)`; every mutation invalidates the account list, the account and its transactions.
- [x] `packages/web/src/components/ui/alert-dialog.tsx` -- vendored with `pnpm dlx shadcn add alert-dialog`, patched like the 1.1 components.
- [x] `packages/web/src/components/{AmountField,TransactionSheet,TransactionList,ConfirmDialog}.tsx`, `routes/comptes.$accountId.tsx`, `AccountGroups.tsx`, `AppSidebar.tsx`, `locales/fr.json` -- account header (name, type, `Money` in `amount-hero`), « Ajouter une opération », rows grouped under day headers, « Aucune opération. » empty state, skeleton rows, page in a validated `page` search param with Précédent / Suivant, the sheet and the delete confirmation. Every string in `fr.json`, including `errors.fields.not_after_opening_date` and `date_too_late`.
- [x] `packages/web/src/lib/amount-sign.ts` + spec -- splits a typed amount into toggle and magnitude and joins them back; the one pure web helper worth a test.

**Acceptance Criteria:**
- Given an open sheet with unsaved changes, when `Esc` is pressed, then « Abandonner les modifications ? » appears; with no change, the sheet closes directly and focus returns to the row or button that opened it.
- Given a saved transaction, when the sheet closes, then the account header, the `/comptes` group total and the sidebar show the new balance without a reload.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Implementation Notes

- `forwardBalances` takes `valuations` rather than a single anchor: a day holding a valuation carries exactly its amount, as in Sure's `Balance::ForwardCalculator`. The opening anchor is the only one today; Story 1.4's reconciliations fit the same input. It returns no row when `from` is past `until`.
- The recompute starts at the day after the last stored row on or before the affected date, not at the affected date itself. A transaction dated after the current end of `balances` (a future date, or today after a quiet week) would otherwise leave a gap of missing days. It deletes rows `>= from` or `> until`, so deleting or moving back the latest entry removes the tail it had extended.
- `rejectionFor` in `domain/statement.ts` is step 1 of AD-4 for one line: `BEFORE_OPENING_DATE` (on or before the opening date), `DATE_TOO_LATE` (more than 366 days after today) and `CURRENCY_MISMATCH` (AD-6). `ledger.updateTransaction` runs the same check and returns `{ status: "rejected", reason }`; `services/transactions.ts` maps both to the `date` field codes.
- The oxlint ban on `@archant/data/schema/transactions` means only the ledger reads that table too, so the ledger also exports the readers `findTransaction`, `listTransactions` and `openingDateOf`, next to `balanceOn`.
- The request schemas are factories per currency (`createTransactionSchema(currency)`), since `parseAmount` needs the account's currency. The routes validate a text-only shape (`transactionBodySchema`) so the typed client knows the body; the service then parses with the account's currency, so a blank label and a bad amount are still reported together.
- A non-`user` update skips locked fields and adds no lock. Ingest with another origin stores `locked_fields = []`.
- `routes/comptes.tsx` became `routes/comptes.index.tsx`: with a `comptes.tsx` route, TanStack Router nests `comptes.$accountId.tsx` under it and needs an `<Outlet>`.
- `AmountField` opens on the stored amount's sign (`initialNature`): an income being edited stays on Revenu. Dépense is the default for an empty field only.
- The sheet has no `SheetTrigger`, so Radix cannot return focus by itself. It remembers the focused element on open and focuses it on close, finding a row again by `data-transaction-id` when an edit moved it under another day.
- The account query does not retry a `NOT_FOUND` and does not toast it (`meta.notFoundInline`); the page shows « Compte introuvable ».
- `amount-hero` is a Tailwind `@utility` in `styles.css`, from DESIGN.md's typography token.
- `alert-dialog.tsx` was vendored with the shadcn CLI and needed no patch beyond `pnpm format`: it has no English screen-reader text.
- Verified: `pnpm data migrate:local` equivalent on a database built with `0000` only keeps its accounts and adds `transactions`. Browser pass with a throwaway Playwright script on a fresh database: create, edit, delete on a checking account and a card, discard prompt only when dirty, focus return, errors under the date, pagination at 51 rows, « Compte introuvable », light and dark, 1280 and 600 px.
- Post-review QA, throwaway Playwright script on a fresh database: on an account opened today the sheet defaults to tomorrow and saves; a card purchase of `30,00` dated today moves the header, `/comptes` group and sidebar from `490,30 €` to `520,30 €`; `Esc` with changes shows « Abandonner les modifications ? »; delete asks « Supprimer l'opération « Librairie » ? » and restores `490,30 €`. The t3 preview panel still cannot drive the page.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `TransactionSheet.tsx` `valuesOf` | A new transaction defaults to today; on an account opened today the first save fails with `not_after_opening_date` | medium | The create-account dialog defaults the opening date to today and `rejectionFor` refuses `date <= openingDate`: the default path of a new user fails. | patch |
| 2 | edge | `TransactionSheet.tsx` form `onKeyDown` | `⌘Enter` submits again while a save is pending | medium | The handler calls `submit()` without checking `isSubmitting`; only the button is disabled. A double press writes two rows. | patch |
| 3 | edge | `hooks/useTransactions.ts` | `keepPreviousData` shows account A's rows while account B loads | low | The placeholder ignores the key's account id; a click in that window opens a sheet on another account's transaction. Direct fix. | patch |
| 4 | blind, edge | `routes/comptes.$accountId.tsx` pagination | Past the last page, the list is empty with « Page 3 sur 2 » and no empty state | low | Deleting the only row of the last page leaves `page > pageCount`. Plausible for any account over 50 transactions. | patch |
| 5 | edge | `routes/comptes.$accountId.tsx` header | An account query error other than `NOT_FOUND` leaves the header skeleton forever | low | Only `NOT_FOUND` has a branch; the add button stays disabled with no retry, the same defect Story 1.1 fixed on `/comptes`. | patch |
| 6 | blind | `TransactionSheet.tsx` `SheetDescription` | The source line is hard-coded although each item carries `source` | low | Direct correction; otherwise Epic 2 sources would show « Saisie manuelle » without a type error. | patch |
| 7 | verification | `ledger.ts` `updateTransaction` | No test moves a transaction later; `minDate` could become `next.date` unnoticed | medium | Pre-verified gap: every tested move goes back in time. | patch |
| 8 | verification | `ledger.ts` `recomputeBalances` | No test replays an existing later transaction after an earlier insert or delete | medium | Pre-verified gap: dropping `groupBy` or passing only the new lines passes every test. | patch |
| 9 | blind | `app.spec.ts` | PATCH/DELETE on the opening anchor's id untested | low | `transactionRow` joins `transactions`, so it answers `NOT_FOUND`, but nothing pins it and deleting the anchor would corrupt the account. Test only. | patch |
| 10 | blind | `ledger.ts` `ingest` | Entries and transactions inserted in one statement, not chunked | low | Unreachable here: a manual ingest has one line. At 9 columns, about 3 600 lines exceed SQLite's 32 766 parameters, which Epic 2's 5 000-line import (NFR10) will reach. | defer |
| 11 | blind | `services/transactions.ts` `currencyOf` | `getAccount` computes a balance just to read the currency | low | Two extra reads per write for one household; no visible cost. Rejected. |  |
| 12 | blind | `services/transactions.ts` `updateTransaction` | Checks run outside the ledger's lock | low | An account's currency never changes, and a row deleted in between answers `NOT_FOUND`, a correct outcome. Rejected. |  |
| 13 | blind | `ledger.ts` `listTransactions` | `count()` omits the `transactions` join | false | The ledger writes an entry and its `transactions` row in one transaction and deletes both together; no entry of kind `transaction` lacks one. |  |
| 14 | blind | web | No component tests for `AmountField`, the sheet, `groupByDay` | low | AGENTS.md does not pad wiring with tests; the sign logic lives in `amount-sign.ts`, covered. Rejected. |  |
| 15 | blind | `amount-sign.ts` | A zero expense sends `-0` | false | `parseAmount` returns through `toMinorUnits`, which normalises `-0` (Story 1.1). |  |
| 16 | blind | `main.tsx` | `notFoundInline` meta is untyped | low | A typo only brings back a duplicate toast; typing the meta registry adds a declaration for one key. Rejected. |  |
| 17 | blind | `comptes.$accountId.tsx` | `openingDate` unused for client-side date bounds | low | The server answer lands under the date field with the same message; covered by #1 for the default. Rejected. |  |
| 18 | edge | `forward.ts` | Running balance can pass `MAX_SAFE_INTEGER` | false | Needs about 900 lines at the 10^13 cap on one account; it then fails loudly with a rollback, which is correct behaviour. |  |

## Design Notes

Story 1.3's first acceptance criterion, the recompute in the same database transaction, lands here: AD-2 forbids a ledger write that leaves `balances` stale, and "the balance reflects it immediately" reads from `balances` through `balanceOn`. Story 1.3 keeps the chart, the period picker and the « Voir les données » table.

The story's "refused before the opening date" becomes "on or before", following Sure (project owner, 2026-09-21: take the answer from Sure). AD-4 step 1 says "dated before the account's opening anchor"; with an end-of-day anchor the ledger compares `date <= anchorDate`, and Epic 2 imports reject opening-day lines the same way.

Recompute shape, one private ledger function:

```ts
// start = earliest affected date; previous = balanceOn(start - 1 day) or the anchor
const movements = await sumAmountsByDay(tx, accountId, start); // drizzle sum + groupBy
const rows = forwardBalances({ from: start, previous, movements, until, classification });
await tx.delete(balances).where(and(eq(balances.accountId, accountId), gte(balances.date, start)));
await insertInChunks(tx, rows);
```

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, coverage thresholds met, `git status` clean afterwards.
- `pnpm data migrate:local` -- applies `0001` on a database created by Story 1.1 without losing its accounts.

**Manual checks:**
- On a checking and a card account: add an expense and an income, edit one's date and amount, delete one; the header, `/comptes` totals and sidebar follow each step, in light and dark mode, at 1280 and 600 px.
