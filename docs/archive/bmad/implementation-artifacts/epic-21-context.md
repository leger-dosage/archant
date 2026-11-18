# Epic 21 Context: Savings goals

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The owner sets a target, such as a holiday or an emergency fund, and sees it fill from the accounts that hold the money: how much is saved, what remains, what to put aside each month, and whether the goal is on track. Archant takes Sure's goal model, which reads linked accounts' balances rather than transactions, and adds a lifecycle, a projection, a dashboard card and reserves sized in months of expenses. It departs from Sure deliberately: no pledges, no spending a goal and no withdrawal detector, since those would write goal stamps on the ledger's rows; progress reads balances only, with no « contributions » basis until holdings exist; the pace is the change of the linked balances over 90 days divided by three, so a savings account tracked by snapshots does not read zero; and nothing runs as a job, a reserve's target being computed when read.

## Stories

- Story 21.1: Save toward a goal
- Story 21.2: Follow a goal to its end
- Story 21.3: Keep a reserve

## Requirements & Constraints

- A goal has a name, a positive target, an optional date, and at least one linked active depository or investment account in its own currency. Each link takes the whole balance or a fixed amount; two whole-balance links on one account are refused.
- Several goals sharing an account never count the same money twice: fixed amounts are taken first, a whole-balance link takes what is left, fixed amounts above the balance are scaled down in proportion, and a balance at or below zero backs nothing.
- A goal shows saved against target, what remains, the monthly amount needed by its date rounded up to the cent, and a status « Atteint », « Sans échéance », « En bonne voie » or « En retard » from the 90-day pace.
- Lifecycle follows Sure: pause, resume, complete, archive, restore, reopen. Completing freezes the amount saved and its date; archived and completed goals release their accounts, a paused goal keeps them; restoring is refused when another goal has meanwhile taken a whole account the goal used.
- A reserve has no date, cannot be completed, and its target is either a fixed amount or a number of months of expenses, the median monthly expenses times that number. Its status is « Constituée » when covered, otherwise « Entamée », and an entamée reserve sorts first.
- Money is integer minor units with an ISO 4217 code, never a float. A goal is in its accounts' currency; totals across goals use the reporting currency and name the goals left out.
- No queue, no scheduled job: everything derived is computed when read.
- Every visible string goes through i18next in French. Pages are usable with the keyboard alone and meet WCAG 2.2 AA contrast.
- The goal function's branches are all covered. Every acceptance criterion has a test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- Tables: `goals (id, name, target_amount, currency, target_date, color, icon, notes, state, kind, created_at, updated_at)` and `goal_accounts (goal_id, account_id, allocated_amount)`. `state` and `kind` are `text` columns with check constraints built from `const` arrays in `@archant/data`, which are also the TypeScript unions. Ids are UUID v4 text, dates `YYYY-MM-DD` text, timestamps epoch milliseconds.
- `goal_accounts` rows go with their goal, and with their account when the ledger deletes it: only the ledger deletes an account, so its delete path must remove the links (AD-2). Goals never write `entries`, `transactions`, `balances` or any other ledger table.
- Layering (AD-1): `domain/goals.ts` holds the pure allocation, pace, monthly-need and status functions, with no Drizzle or Hono; `services/goals.ts` reads and writes; each route calls one service function and parses input with Zod.
- Balances are read through `balanceOn(accountId, date)`, never recomputed; the 90-day pace and the goal chart read the linked accounts' balances on past days (AD-8).
- Money is `{ amount: MinorUnits; currency }` from `@archant/data/money`, rendered by `<Money>`. Totals read the reporting currency through the one helper and skip, and report, other currencies (AD-6).
- A reserve's « months of expenses » uses the median of monthly expenses as counted by `countsInCashFlow` and `direction` from `domain/cash-flow.ts`, through the report query builder (AD-9).
- The export carries goals and their links from Story 21.1, in `goals.ndjson` beside `all.ndjson`, never in it, since Sure's preflight refuses a type it does not know; every new column goes in `EXPORTED_COLUMNS` or `LEFT_OUT`, or the export spec fails (AD-23).
- Every write is a mutating method, so `viewerReadOnly` refuses it from a viewer with no per-route check; no `GET` writes. Viewers read goals (AD-21).
- Errors are `AppError` codes in SCREAMING_SNAKE_CASE with English messages, inside the `{ data }` / `{ error }` envelope.

## UX & Interaction Patterns

- The rail gains « Objectifs », leading to `/goals`: goals as cards with a progress ring, and « Nouvel objectif » opening a dialog. Choosing « Réserve » in that dialog makes the goal a reserve.
- `/goals/:id` shows a goal with each account's share, and from Story 21.2 a chart of its share of the linked balances over 90 days with the line to its target by its date.
- The dashboard gains a card, as Sure's « Plan » card: total saved against total target of active goals in the reporting currency, how many are behind, and up to five goals.
- Cards follow `DESIGN.md`: no shadow, `{colors.container}` on the background, `{rounded.xl}`, title in `{typography.card-title}`. Colour comes through tinted icons and chart segments; destructive red is not for a late goal.
- A viewer sees no control that writes.

## Cross-Story Dependencies

- Story 21.1 comes first; 21.2 and 21.3 follow in either order.
- 21.1 extends the export of Epic 18; 21.2 extends the dashboard of Epic 6.
- 21.3 reads monthly expenses through the cash flow classification Epics 6 and 17 already use.
- Epic 22 later brings holdings; until then an investment account's progress is its balance.
