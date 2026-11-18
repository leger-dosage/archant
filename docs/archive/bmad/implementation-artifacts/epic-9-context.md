# Epic 9 Context: Recurring transactions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user sees their subscriptions and regular bills, and when the next one is due, without listing them by hand. Archant detects recurring transactions from the last three months of history, following Sure's detection (transactions repeating over three months, grouped by merchant or name and amount), and a dedicated page lists them by next expected date. The user can confirm a detected item, dismiss it, or add one by hand from a transaction. This is the last feature epic before Enable Banking synchronisation, so detection must work the same for file imports now and bank syncs later.

## Stories

- Story 9.1: Detect recurring transactions
- Story 9.2: Recurring transactions page

## Requirements & Constraints

- Detection reads the last three months of transactions, transfers excluded. Transactions are grouped by account, then merchant or, failing that, normalised label, then the same amount. A group becomes a recurring item when it has at least three transactions, the last within 45 days, on days of the month within 5 days of each other, as in Sure. Month-end days such as the 31st must be handled.
- A stored item carries its expected day of month, amount, last date and occurrence count. The page shows merchant or label, amount, account and next expected date, sorted by that date.
- Detection runs after an import and on demand.
- Lifecycle: a confirmed item is never marked inactive by detection, only by the user. A dismissed item is hidden and never detected again. An item added by hand from a transaction is kept by later detections. An item with no occurrence for more than two expected periods is marked inactive by detection.
- Money is integer minor units plus an ISO 4217 currency, never a float. No code path assumes EUR.
- Detection logic has every branch covered. Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. No test reaches the network.

## Technical Decisions

- Detection is a pure function in `domain/recurring.ts`: data in, data out, no Drizzle, Hono or `fetch` imports (oxlint enforces it). A service reads the transactions, calls it, and writes the results.
- Detection runs after the ingestion transaction commits, called by the service, not as a step of `ledger.ingest`. Its failure is logged and never fails the import request. Epic 10's sync must trigger it the same way.
- `recurring_transactions` hangs off `accounts`. It is not a ledger table: the recurring service writes it, but it must never write `entries`, `transactions` or `balances`, which only `services/ledger.ts` writes.
- Entry ids never change. When `ledger.absorb` merges a pending or duplicate entry into a survivor, it moves any recurring link onto the survivor with keys, taggings and transfers. A link from a recurring item to an entry must therefore survive absorption.
- "Transfers excluded" reuses the single cash-flow definition in `domain/cash-flow.ts` (`direction(tx)`), which already binds this epic; do not write a second transfer test.
- Label normalisation reuses `domain/normalize-label.ts`, which also serves fingerprints and merchants.
- Dates are `YYYY-MM-DD` text, handled by small helpers in `domain/`, no date library. "Today" is computed in `APP_TIMEZONE` (default `Europe/Paris`). Ids are text UUID v4. Enumerations such as an item's status are `text` columns with a check constraint built from a `const` array in `@archant/data`.
- API: `{ data }` / `{ error }` envelope, closed `AppError` union, request schemas in `packages/api/src/schemas/`, one service call per route, paginated lists as `{ items, page, pageSize, total }`.

## UX & Interaction Patterns

- Page `/recurrences`, reached from the sidebar and `g r`. The navigation entry appears with this epic, never before.
- Amounts render through the `<Money>` component in `fr-FR`; dates in French. Tables are real tables with header cells; rows are 36 px high.
- Empty, loading and error states follow the shared patterns: a short French sentence for empty, skeleton rows while loading, a destructive Sonner toast translated from `errors.<CODE>` on failure.
- Adding an item by hand starts from a transaction; the planning documents do not place that entry point. Dialogs and sheets stack one level deep at most; a confirmation dialog states counts, repeats the verb on its button, and starts focus on Annuler.
- Every visible string goes through `locales/fr.json`: vouvoiement, infinitive-verb buttons, no exclamation marks. Keyboard reach, visible focus, `Esc` returns focus, 24 px targets, WCAG 2.2 AA contrast.

## Cross-Story Dependencies

- Builds on Epic 2's import flow (the service that triggers detection after commit), Epic 4's merchants, and Epic 5's transfers, which detection excludes.
- Story 9.1 creates `recurring_transactions`, the domain detector and the post-commit trigger. Story 9.2 adds the page, the confirm, dismiss and manual-add actions, and the inactive transition; detection from 9.1 must then respect confirmed, dismissed and manual items.
- Epic 10's sync reuses the ingestion service, so it must call detection after commit too.
