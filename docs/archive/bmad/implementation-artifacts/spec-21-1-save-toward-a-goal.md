---
title: 'Story 21.1: Save toward a goal'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
baseline_commit: '30ba896f3b06696b6d7e5c3c10dcafc360a3abcd'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The household cannot set a savings target and see how far the accounts that hold the money have taken it, nor what to put aside each month to reach it on time.

**Approach:** Take Sure's goal model (`app/models/goal.rb`, `goal_account.rb`): a goal reads its linked accounts' current balances, each link taking the whole balance or a fixed amount, one pure function splitting a shared balance so two goals never count the same euros. Add the two tables, `domain/goals.ts`, `services/goals.ts`, `routes/goals.ts`, and the `/goals` and `/goals/:id` pages. Story 21.1 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled.

## Boundaries & Constraints

**Always:**
- `GOAL_STATES = ["active", "paused", "completed", "archived"]`, `GOAL_KINDS = ["one_off", "maintained"]`, `RELEASED_GOAL_STATES = ["completed", "archived"]` live in `packages/data/goals.ts`, Drizzle-free, beside `GOAL_NAME_MAX_LENGTH = 100` and `GOAL_NOTES_MAX_LENGTH = 1000`. Sure's values, so the export maps them as they are. This story only creates `active` `one_off` goals.
- `goals.color` and `goals.icon` are not null, taken from `CATEGORY_COLORS` and `CATEGORY_ICONS`, as Sure takes `Category::COLORS` and its icons; defaults first swatch and `piggy-bank`. `target_amount > 0` and `allocated_amount >= 0` (null is the whole balance) are checks. `goal_accounts` has the primary key `(goal_id, account_id)`, cascades from `goals` and from `accounts`, with an index on `account_id`: the ledger's `deleteAccount` deletes the account row, which takes the links, as it takes `recurring_transactions`.
- A goal's currency is its first linked account's on creation, as Sure's controller; every link must be an active `depository` or `investment` account in that currency; the currency never changes on edit. The target and fixed amounts parse in that currency with a schema factory shared with the dialog, as `budgetSchema`.
- Field codes: `accounts` `no_account` (none), `accounts.<i>.accountId` `not_fundable` (unknown, inactive, or another type), `currency_mismatch`, `duplicate_account`; `accounts.<i>.allocatedAmount` `whole_balance_taken` when another non-released goal already takes that account whole, checked inside the immediate write transaction; `targetAmount` `invalid_amount` / `not_positive`; `name` `too_long`; unknown goal `NOT_FOUND`.
- `backingShares` in `domain/goals.ts` is Sure's `backing_share_for`: balance ≤ 0 backs nothing; fixed amounts first; above the balance they are scaled by `balance / totalFixed`, floored in minor units with `BigInt` so the shares never sum above the balance; a whole-balance link takes `max(balance − fixed, 0)`. Only links of non-released goals share an account.
- `goalProgress` in `domain/goals.ts`: `saved`, `remaining = max(target − saved, 0)`, `percent` floored and capped at 99 until nothing remains, `monthlyNeeded = ceil(remaining × 30 / days)` with `days` to the target date, `remaining` when the date is today or past, `null` without a date; `pace = floor(Σ(balance today − balance on max(today − 90, opening date)) / 3)` over the linked accounts, whole accounts as Sure; `status` `reached` when nothing remains, else `no_target_date`, else `on_track` when `monthlyNeeded ≤ pace`, else `behind`. Every branch is tested.
- Balances are read through `balanceOn` and `openingDateOf` of `services/ledger/balances.ts` (AD-8); goals write no ledger table.
- Routes, under `viewerReadOnly` with no per-route check: `GET /api/goals`, `GET /api/goals/:id`, `POST /api/goals` (201), `PUT /api/goals/:id` (replaces fields and links), `DELETE /api/goals/:id`. Reads write nothing.
- The list sorts as Sure's `active_display_sort`: `behind`, `on_track`, `no_target_date`, `reached`, then by name in French collation.
- Export: every column of both tables in `EXPORTED_COLUMNS`; the archive gains `goals.ndjson`, `Goal` and `GoalAccount` lines in Sure's column names, amounts as decimals, beside `all.ndjson`, because Sure's exporter writes no goal and `SureImport::Preflight` refuses an unknown type, which AD-23 forbids in `all.ndjson`. This meets Story 21.2's export criterion now; `epics.md` and AD-23 say so.
- Interface: « Objectifs » in the rail after « Budgets » (`GoalIcon`); `/goals` cards with a progress ring (an SVG `ProgressRing`, `role="img"` and a sentence), saved / target, the status badge, the monthly amount and the date; « Nouvel objectif » opens `GoalDialog`: name, target, date, colour, icon, the active fundable accounts each with a checkbox and an amount field whose blank means the whole balance, notes. `/goals/:id` shows the same figures and each account's share, « X affectés sur Y » for a fixed amount. A viewer sees neither « Nouvel objectif », « Modifier » nor « Supprimer ». Goal queries live under `queryKeys.accounts.all`, so every write that moves a balance refreshes them.

**Never:** no pause, completion, archive, chart or dashboard card (21.2); no reserve or months of expenses (21.3); no pledge, consumption or contributions basis; no MCP tool; no live earmark hints in the dialog; no goal line in `all.ndjson`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Fixed then whole | balance 1 000, A fixed 300, B whole | A 300, B 700 |
| Over-earmarked | balance 500, A fixed 300, B fixed 700 | A 150, B 350 |
| Overdrawn | balance −50, any links | every share 0 |
| Whole twice | B whole on account X, new goal whole on X | `VALIDATION_ERROR` `whole_balance_taken`, nothing written |
| Wrong account | a loan, an inactive savings account, or a USD account for a EUR goal | `not_fundable` / `currency_mismatch` |
| No date | target 1 000, saved 200 | `no_target_date`, `monthlyNeeded` null |
| Due date passed | remaining 400 | `monthlyNeeded` 400 |
| Reached | saved ≥ target | `reached`, `percent` 100, `remaining` 0 |
| Account deleted | its goal linked to it and another | link gone, goal kept with the other |
| Viewer | `POST`, `PUT`, `DELETE` | `403 FORBIDDEN`, nothing written |

</frozen-after-approval>

## Code Map

- `packages/data/schema/budgets.ts`, `schema/invitations.ts`, `schema/check.ts` `inList` -- table, check and cascade patterns; `package.json` `exports` gains `./goals`, `./schema/goals`; `types.ts` gains `Goal`, `NewGoal`, `GoalAccount`, `NewGoalAccount`.
- `packages/data/migrate.spec.ts` `describe("budgets")` -- pattern for a `describe("goals")`; migration `pnpm data generate --name add_goals` (next is `0046`).
- `packages/data/category-presets.ts` -- `CATEGORY_COLORS`, `CATEGORY_ICONS`.
- `packages/api/src/schemas/budgets.ts` `amountIn`, `budgetSchema` -- the per-currency text-to-minor-units pattern for `schemas/goals.ts`.
- `packages/api/src/services/tags.ts`, `routes/tags.ts` -- CRUD shape; `services/budgets.ts` -- `validationError`, write in an `immediate` transaction then return the read model.
- `packages/api/src/services/ledger/balances.ts` `balanceOn`, `openingDateOf`; `services/accounts.ts` `listAccounts` -- per-account `balanceOn` on `today(deps.timeZone)`.
- `packages/api/src/app.ts` `createApi` -- mount `.route("/goals", goalsRoutes(deps))` in the chain.
- `packages/api/src/routes/middleware/roles.spec.ts` -- the walker covers new routes; add the three to its `arrayContaining` list and raise the count.
- `packages/api/src/services/ledger/accounts.spec.ts` -- `deleteAccount` removes the account's goal links.
- `packages/api/src/services/ledger/export.ts` `EXPORTED_COLUMNS`, readers; `services/export.ts` `partsOf`, `budgetLines`, `decimal`, `timestamp`; `services/export.spec.ts` archive entries.
- `packages/app/src/components/AppShell.tsx` `DESTINATIONS`; `components/Page.tsx` `Crumb`, `useCrumbs`; `lib/query-keys.ts`; `hooks/useBudget.ts` (query and mutation shape); `components/CategoryDialog.tsx` (dialog, colour and icon pickers, `applyFieldErrors`); `components/StatusBadge.tsx`; `components/TintedIcon.tsx`, `lib/tint.ts`; `hooks/useIsAdmin.ts`; `components/EmptyState.tsx`, `ConfirmDialog.tsx`, `DateField.tsx`, `Money.tsx`; `locales/fr.json`.
- `packages/app/e2e/fixtures.ts` `apiHelpers` (`openAccount`), `e2e/viewer.spec.ts` (`expectNone`), `e2e/shell.spec.ts` `DESTINATIONS`.
- Docs: `docs/architecture.md` AD-23; `docs/deployment.md` « Exporting your data »; `docs/security-model.md` (what a viewer reads, what the export holds); `docs/sure-parity.md` savings goals and export rows.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/goals.spec.ts`, `goals.ts` -- first the matrix's allocation and progress rows and every branch, then `backingShares` and `goalProgress`.
- [x] `packages/data/goals.ts`, `schema/goals.ts`, `types.ts`, `package.json`, `drizzle/0046_add_goals.sql`, `migrate.spec.ts` -- tables, checks, cascades, tested in SQL.
- [x] `packages/api/src/schemas/goals.ts`, `lib/errors.ts` (nothing new unless a code is missing), `services/goals.ts`, `routes/goals.ts`, `app.ts`, `routes/goals.spec.ts` -- CRUD, validation, shares, sort, viewer refused; `routes/middleware/roles.spec.ts`.
- [x] `packages/api/src/services/ledger/accounts.spec.ts` -- account deletion takes its links.
- [x] `packages/api/src/services/ledger/export.ts`, `services/export.ts`, specs -- columns, `goals.ndjson`.
- [x] `packages/app/src/...` -- query keys, `useGoals.ts`, `ProgressRing.tsx`, `GoalCard.tsx`, `GoalDialog.tsx`, `routes/_authed.goals.index.tsx`, `_authed.goals.$goalId.tsx`, rail, crumbs, badges, `fr.json`.
- [x] `packages/app/e2e/goals.spec.ts`, `fixtures.ts`, `viewer.spec.ts`, `shell.spec.ts` -- create from the dialog, card figures, detail shares, edit, delete, viewer sees no write control.
- [x] Docs and `epics.md` (21.1 gains the export criterion, 21.2 loses it).

**Acceptance Criteria:**
- Given Story 21.1 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given an export with goals, when the archive is read, then `goals.ndjson` holds one `Goal` line per goal and one `GoalAccount` line per link, and `all.ndjson` still passes Sure's preflight.

## Design Notes

A pace on whole accounts, not on the goal's share, is Sure's choice and keeps the function free of history allocation. Dividing by three even for an account opened less than 90 days ago understates its pace, as Sure's does.

A link to an account deactivated after it was linked backs nothing and moves no pace, and the goal's page names it « Compte désactivé, non compté »: Archant leaves a deactivated account out of every total, and the dialog no longer offers it, so saving an edit drops the link without changing what is saved. Sure keeps counting a disabled account.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/goals.ts` covered to the branch
- `pnpm test:e2e` -- expected: green

## Implementation Notes

- `FUNDABLE_ACCOUNT_TYPES` and `isFundableAccountType` live in `packages/data/goals.ts` beside the states, so the service and the dialog read one list.
- `goals.color` and `goals.icon` carry no database check, as `categories` carries none: the schema validates them, and a swatch added later rebuilds no table.
- The service parses the body inside the immediate transaction, since a new goal's currency is read from its first account there; every account check runs in the same transaction.
- `goals.ndjson` comes after `all.ndjson` in the archive; a `GoalAccount` line has no id or timestamps, the table having neither.
- The dialog keeps only the ticked accounts in `accounts`, in the list's order, so a server error path `accounts.<i>.*` lands on the right row; its resolver reads the currency of the first ticked account, the goal's own on edit.
- `errorAt` moved from `lib/rule-form.ts` to `lib/form-errors.ts`, generic, for the goal dialog; `useAccounts` takes a `select` for `useFundableAccounts`.
- After review: a new goal takes the currency of its first listed account that may back it, so an unknown first id is refused alone; `paceStart` never goes past today; each account share carries `active`; the dialog offers only the goal's currency on edit and, once an account is ticked, disables accounts in another currency.

## Spec Change Log

- Review, edge-case layer: the field codes `required` and `duplicate` put goal wording (« Choisissez au moins un compte. ») on codes the budget service also emits. Amended the frozen field codes to `no_account` and `duplicate_account`, under the owner's delegation of every decision for this run. Avoids a budget form one day showing a goal's message. KEEP: every other code and message.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | `epic-21-context.md` still puts goals in `all.ndjson`, 21.2 extending the export | low | Lines unchanged after the export moved to 21.1 | patched |
| blind | The pace reads whole accounts, so a capped fixed earmark can read « En bonne voie » and two goals count the same inflow | low | Sure's deliberate choice, written in the frozen intent and Design Notes | rejected: intent |
| blind, edge, verification-gap | A linked account deactivated later keeps counting, and an edit drops it silently | medium | `listGoals` read every link; `valuesOf` filters inactive accounts out | patched: an inactive account backs nothing and is named on the page; tested |
| blind, edge | A goal whose last account is deleted shows an empty « Comptes liés » | low | Cascade leaves zero links; the section rendered an empty list | patched: « Aucun compte lié » line |
| blind | The dialog offers accounts in every currency; an edit always refuses another one | low | `GoalDialog` listed every fundable account | patched: goal currency on edit, other currencies disabled once one is ticked |
| blind, edge | A fixed amount of 0 is accepted | low | Sure's check is `>= 0`; the spec follows it | rejected |
| blind | `goals.open` is unused | low | No component read it | patched: removed |
| blind | Card `<h3>` sits under the page's `<h1>` | low | No `<h2>` between them on `/goals` | patched: `<h2>` |
| blind | A prorated link shows its share, not the amount asked | low | Sure's breakdown shows the backing too | rejected |
| blind, verification-gap | Released and paused states, a `PUT` taking a held account whole and the currency fallback are untested | medium | No test set a state other than `active` | patched: three API tests |
| blind, edge | `[unknown, USD]` makes the goal EUR and reports a mismatch on the valid account | low | Currency came from `accounts[0]` | patched: first account that may back a goal |
| blind | `GoalAccount` lines carry only Archant's account id | low | Sure gives new ids on import | patched: `deployment.md` says to match it with the `Account` line |
| blind | `getGoal` computes every goal; three ledger reads per account | low | A household holds a few goals and accounts | rejected |
| blind | `percent` multiplies in floating point | false | `saved * 100` stays below 2^53 for any amount under `MAX_MINOR_UNITS` | rejected |
| blind | `amountIn` exported from the budget schema | low | A move, no behaviour change | rejected |
| blind | The review diff left out the spec | false | By design: only the edge-case layer reads it | rejected |
| edge | An account opened at a future date makes the pace negative | low | `paceStart` could return a day after today | patched: never after today; tested |
| edge | « Nouvel objectif » or « Modifier » does nothing while the account list loads or after it fails | low | The shell already reads that list; the dialog opens once it lands | rejected |
| edge | Shared field codes `required` and `duplicate` carry goal wording | low | Budget service emits both, through the assistant path today | patched: `no_account`, `duplicate_account` (Spec Change Log) |
| verification-gap | No test that a reached goal asks for no monthly amount | medium | Only the interface hides `monthlyNeeded: 0` | patched: end-to-end assertion |
| verification-gap | The page of a deleted goal is untested | medium | No end-to-end visit of an unknown id | patched: end-to-end visit after deletion |
| verification-gap | An edit dropping a deactivated account is untested | low | Resolved by the inactive-account change, which makes the drop change nothing | patched with the medium entry above |
