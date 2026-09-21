---
title: 'Story 1.2: Record transactions by hand'
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
- [ ] `packages/data/schema/transactions.ts`, `types.ts`, `package.json`, `drizzle/0001_*`, `migrate.spec.ts`, `.oxlintrc.json` -- table, exports, generated migration, lint ban -- storage first.
- [ ] `packages/api/src/domain/balances/forward.spec.ts`, `forward.ts` -- tests first: no movement, several movements on one day, the anchor day carrying exactly the anchor, a gap day carrying the previous balance, a liability, a start date after the anchor from a given previous balance. 100% branches.
- [ ] `packages/api/src/domain/statement.ts` -- the narrowed statement types.
- [ ] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- tests first, then `ingest`, `updateTransaction(deps, entryId, patch, { origin })`, `deleteTransaction(deps, entryId, { origin })` and the shared recompute: the I/O matrix rows, locked fields, rollback leaving no row when the recompute fails, rows past the new end deleted after a delete. 100% branches.
- [ ] `packages/api/src/services/transactions.ts` -- `listAccountTransactions(deps, accountId, { page, pageSize })` returning `{ items, page, pageSize, total }`, `createTransaction`, `updateTransaction`, `deleteTransaction`; each item carries `source: "manual"`. Maps an ingest rejection to `VALIDATION_ERROR` on `date`.
- [ ] `packages/api/src/schemas/transactions.ts` -- create and update schemas shared with the web form, list query schema (`page` ≥ 1, `pageSize` 1–200, default 50).
- [ ] `packages/api/src/routes/accounts.ts`, `routes/transactions.ts`, `app.ts`, `app.spec.ts` -- `GET /api/accounts/:id`, `GET` and `POST /api/accounts/:id/transactions`, `PATCH` and `DELETE /api/transactions/:id`; spec covers the I/O matrix through `app.request`.
- [ ] `packages/web/src/lib/query-keys.ts`, `hooks/useAccount.ts`, `hooks/useTransactions.ts` -- keys `accounts.detail(id)`, `transactions.byAccount(id, page)`; every mutation invalidates the account list, the account and its transactions.
- [ ] `packages/web/src/components/ui/alert-dialog.tsx` -- vendored with `pnpm dlx shadcn add alert-dialog`, patched like the 1.1 components.
- [ ] `packages/web/src/components/{AmountField,TransactionSheet,TransactionList,ConfirmDialog}.tsx`, `routes/comptes.$accountId.tsx`, `AccountGroups.tsx`, `AppSidebar.tsx`, `locales/fr.json` -- account header (name, type, `Money` in `amount-hero`), « Ajouter une opération », rows grouped under day headers, « Aucune opération. » empty state, skeleton rows, page in a validated `page` search param with Précédent / Suivant, the sheet and the delete confirmation. Every string in `fr.json`, including `errors.fields.not_after_opening_date` and `date_too_late`.
- [ ] `packages/web/src/lib/amount-sign.ts` + spec -- splits a typed amount into toggle and magnitude and joins them back; the one pure web helper worth a test.

**Acceptance Criteria:**
- Given an open sheet with unsaved changes, when `Esc` is pressed, then « Abandonner les modifications ? » appears; with no change, the sheet closes directly and focus returns to the row or button that opened it.
- Given a saved transaction, when the sheet closes, then the account header, the `/comptes` group total and the sidebar show the new balance without a reload.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Implementation Notes

## Spec Change Log

## Review Triage Log

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
