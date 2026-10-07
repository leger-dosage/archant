---
title: 'Story 26.3: Ask an assistant about my savings goals'
type: 'feature'
created: '2026-10-07'
status: 'done'
baseline_commit: '840174989446cd79a3e1e5afcb9b4b39717317d2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-26-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An assistant connected through `/api/mcp` reads accounts, budgets and bills, but no savings goal: the owner cannot ask where a goal stands, nor describe one and have it set up, without opening « Objectifs ».

**Approach:** Add `get_goals` (`archant:read`), which Sure lacks, and Sure's `create_goal` (`archant:write`) in a new `mcp/goals.ts`, calling the services `/goals`, the dashboard card and « Nouvel objectif » call (AD-19, FR99). Story 26.3 of `epics.md` is the acceptance contract; this spec adds what reading the code and Sure settled.

## Boundaries & Constraints

**Always:**
- `get_goals`: no input. Returns `goals`, every goal in `listGoals`' order, each `id`, `name`, `kind`, `state`, `status`, `currency`, `targetAmount`, `targetMode`, `targetMonths`, `monthlyExpenses`, `targetDate`, `saved`, `remaining`, `percent`, `monthlyNeeded`, `notes`, and `accounts`, each `accountId`, `name`, `allocatedAmount` (decimal string, `null` for the whole balance), `share`; then `totals`, the dashboard card's `currency`, `count`, `saved`, `target`, `behind` and `leftOut` (`id`, `name`). Amounts are decimal strings in the goal's currency, totals in the reporting one. Description carries `BANK_TEXT`; `READ_ONLY`.
- One service call: a new `getGoalsOverview` in `services/goals.ts` reads `listGoals` once and sums it with `goalsSummary`, so the list and its totals come from one read; `getGoalsSummary` returns its `summary`.
- `create_goal`: `name`, `kind` (`one_off` by default, or `maintained`), exactly one of `targetAmount` (decimal string) or `targetMonths` (integer, a reserve only), optional `targetDate` and `notes`, and `accounts` by id, each with an optional `allocatedAmount` (decimal string; absent takes the whole balance). Built into `createGoal`'s body with a colour drawn at random and the dialog's default icon, `targetMode` derived from which target is given. Returns the goal as `get_goals` gives it, plus `url`, its page under `BETTER_AUTH_URL`'s origin, as Sure answers one. `CREATES`; `changedRows` 1.
- `@archant/data/goals` gains `sampleGoalColor`, a category swatch drawn at random as Sure's `COLORS.sample` in `GoalsController#new` and `create_goal`, and `DEFAULT_GOAL_ICON`; `GoalDialog.tsx` starts from both, and `mcp/goals.ts` uses both.
- Refusals are the service's: `VALIDATION_ERROR` with each field's path and code (`not_fundable`, `currency_mismatch`, `whole_balance_taken`, `duplicate_account`, `no_account`, `invalid_amount`, `invalid_months`, `no_expenses`, `not_reporting_currency`); the tool input itself refuses neither target (`target_required` on `targetAmount`), both (`one_target_only` on `targetMonths`), `targetMonths` with a one-off kind (`reserve_only` on `targetMonths`) and a date on a reserve (`reserve_has_no_date` on `targetDate`).
- `INSTRUCTIONS` gains: before `create_goal`, paraphrase the name, the target, the date and each account with the amount it holds for the goal, and wait for the owner's agreement; `get_accounts` gives the ids, and `get_goals` which accounts another goal already takes whole.
- Consent labels: read « Lire vos comptes, vos opérations, vos règles, vos budgets, vos factures et vos objectifs »; write « Créer et modifier vos règles, classer vos opérations, rapprocher vos virements, définir vos budgets, vos soldes et vos objectifs, gérer vos factures ».

**Never:** no tool edits, pauses, completes, archives, restores or deletes a goal; no goal history tool; no new route, screen or error code reaching the interface.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Read | two EUR goals, one USD, one completed | every goal in `/goals`' order, shares as decimal strings; totals in EUR count 3, the USD one in `leftOut` |
| Create | savings 1 500, target `"2000.00"`, a date | active one-off, `saved` `"1500.00"`, a category swatch, the dialog's icon, its `url`, one row recorded |
| Fixed amount | `allocatedAmount` `"300.00"` | the link holds 300, `share` `"300.00"` |
| Reserve | `kind` `maintained`, `targetMonths` 6, median 2 000 | `months_of_expenses`, target `"12000.00"`, no date |
| Currency | EUR then USD account | `VALIDATION_ERROR` `accounts.1.accountId` `currency_mismatch`, nothing written |
| Whole twice | an account another goal takes whole | `VALIDATION_ERROR` `accounts.0.allocatedAmount` `whole_balance_taken` |
| Targets | neither; both | `VALIDATION_ERROR` `targetAmount` `target_required`; `targetMonths` `one_target_only` |
| Reserve date | `maintained` with `targetDate` | `VALIDATION_ERROR` `targetDate` `reserve_has_no_date` |
| Months on one-off | `targetMonths` without `maintained` | `VALIDATION_ERROR` `targetMonths` `reserve_only` |
| Read token | `create_goal` | `403 insufficient_scope`, recorded, nothing written |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/goals.ts` -- `listGoals`, `getGoalsSummary`, `createGoal`, `GoalSummary`; add `getGoalsOverview`.
- `packages/api/src/domain/goals.ts:323` -- `goalsSummary`, `GoalStatus`.
- `packages/api/src/schemas/goals.ts` -- `GoalInput` (every field text), the dialog's codes.
- `packages/data/goals.ts` -- `GOAL_KINDS`, `GOAL_STATES`, `GOAL_TARGET_MODES`, `GOAL_TARGET_MONTHS_MAX`; add the two defaults.
- `packages/app/src/components/GoalDialog.tsx:79` -- `blank()`'s colour and icon.
- `packages/api/src/mcp/snapshots.ts`, `mcp/tool.ts` (`READ_ONLY`, `CREATES`, `BANK_TEXT`, `decimal`), `mcp/server.ts` (`TOOLS`, `INSTRUCTIONS`), `mcp/server.spec.ts` (`READ_TOOLS`, `WRITE_TOOLS`, hints, instructions).
- `packages/api/src/schemas/assistants.ts` -- `noToolInput`, `accountId`; add `createGoalInput`.
- `packages/api/src/mcp/snapshots.spec.ts` -- the pattern: `ownDatabase`, `assistants()`, `calls()`; `routes/goals.spec.ts` -- `spent`, `THREE_MONTHS`.
- `packages/app/src/locales/fr.json:2051`, `packages/app/e2e/assistants.spec.ts` (`READ_TOOLS`, both labels).
- Docs: `docs/deployment.md` « Connecting an assistant », `docs/security-model.md` « Assistants », `docs/sure-parity.md` « Savings goals » and « Assistant tools ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/mcp/goals.spec.ts` -- first: every matrix row through the MCP handler, each call recorded with its count.
- [x] `packages/data/goals.ts`, `GoalDialog.tsx` -- the two defaults.
- [x] `services/goals.ts` -- `getGoalsOverview`.
- [x] `schemas/assistants.ts`, `mcp/goals.ts`, `mcp/server.ts`, `mcp/server.spec.ts` -- input, two tools, `TOOLS`, `INSTRUCTIONS`, lists and hints.
- [x] `fr.json`, `e2e/assistants.spec.ts` -- labels, read tool list.
- [x] Docs in the Code Map; `epics.md` needs no edit, Epic 16's left-out list already names no goal.

**Acceptance Criteria:**
- Given Story 26.3 of `epics.md`, when the story ships, then each criterion holds with the decisions this spec records.
- Given a read token, when `tools/list` runs, then `get_goals` is listed read-only and `create_goal` is not.

## Implementation Notes

- Sure, read at `afdac0a8c` in the local clone, settles the write: `create_goal` keeps its name, its paraphrase-then-confirm instruction and its refusals (currency mismatch, an account claimed in full); it also keeps Sure's random colour and its URL in the answer. The departures are the epic's: ids, decimal strings, reserves, any fundable account as Sure's own form allows, and the goal itself beside the URL.
- `get_goals` adds `percent` and `monthlyExpenses` to the epic's list: the card shows the first, and the second explains a reserve's target in months.
- `changedRows` stays 1 for a goal and its links, as the epic says: it counts what the owner asked for, one goal.
- `get_goals` sits after `get_valuations`, `create_goal` after `record_valuation`, in `TOOLS` and both tool lists.

## Spec Change Log

- Review (blind, edge): a reserve's date was dropped silently and both targets answered `target_required`. Amended Boundaries and the matrix: `reserve_has_no_date` and `one_target_only` refuse them in the tool input. Avoids the owner agreeing to a date nothing keeps. KEEP: `target_required` for neither, `reserve_only`, every service code unchanged.

- Owner rule, no divergence from Sure: the dialog's fixed colour and the answer without a URL were not forced by money, language or security. Sure's `GoalsController#new` and `create_goal` both take `COLORS.sample`, and `create_goal` answers the goal's URL. Amended Boundaries, Never and the matrix: `sampleGoalColor` replaces `DEFAULT_GOAL_COLOR` in the dialog and the tool, and `create_goal` adds `url`. KEEP: the refusals `reserve_has_no_date` and `one_target_only`, which guard the paraphrase the owner agrees to, where Sure's model drops a reserve's date silently and Sure's tool has no reserve.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge, spec | `allocatedAmount: null` described as blocking the account even on a completed or archived goal | medium | `wholeTakenElsewhere` excludes `RELEASED_GOAL_STATES` | patch: output description and `INSTRUCTIONS` |
| blind, edge, spec | A reserve's `targetDate` dropped without a word | medium | `goalSchema` sets `targetDate: null` for `maintained` | patch: `reserve_has_no_date` |
| edge | Both targets answer `target_required` | low | Same refinement for both cases | patch: `one_target_only` |
| blind, edge | `changedRows` 1 undercounts the links | false | The epic's criterion says « recorded with one row changed »: one goal, as the owner asked | rejected |
| blind, standards, spec | `status` is `z.string()` | low | `GoalStatus` is a key type, no value list exists to enum on; the description lists the six | rejected |
| blind | Deployment doc says totals count goals in the reporting currency | low | `count` and `behind` count every held goal | patch |
| blind | Security model's misleading-label list omits goals | low | A whole-balance goal blocks others | patch |
| blind | `create_goal` lacks `BANK_TEXT` though it returns account names | low | Write tools returning names carry it | patch |
| blind | Second instruction line untested | low | `server.spec.ts` | patch |
| blind | Several service refusals untested through the tool | low | `not_fundable`, `no_account`, `not_reporting_currency` were not | patch: one test; the rest are covered in `routes/goals.spec.ts` with the same service |
| blind | `calls()[0]` reads one row | low | A second call went unchecked | patch |
| blind, spec | Totals compared to the route on two fields only | low | `saved`, `target` hard-coded | patch: the route's four figures asserted |
| blind | `get_goals` test seeds through `create_goal` | low | Both tools are tested; a failure names its test | rejected |
| blind | No test that a released goal frees its account | low | `routes/goals.spec.ts` « lets a released goal's accounts go » covers the service | rejected |
| blind | Spec and sprint status not yet final | false | Mid-workflow | rejected |
| standards | `reserve_only` on `targetMonths` where the dialog names `targetMode` | low | The tool has no `targetMode` field; the path names what the assistant sent | rejected |
| standards | `getGoalsSummary` delegates | low | Kept for the route and the dashboard; one read | rejected |
| standards | Comment on `monthlyExpenses` reads as a currency mismatch | low | Reworded | patch |
| verification-gap | none | — | — | — |

## Design Notes

Sure's `create_goal` takes depository accounts by name, `target_amount` as a JSON number and `earmarks` keyed by account name, picks a random colour, and answers a URL. Archant takes ids (Epic 16), decimal strings, an `allocatedAmount` per account as the dialog does, any active depository or investment account (`canBackGoal`), a reserve as well, picks a random colour as Sure, and answers the goal with its URL. The icon is the dialog's piggy bank, since `goals.icon` is required where Sure leaves it empty. Sure's soft failures listing the available accounts become `VALIDATION_ERROR` fields; `get_goals` tells which accounts are already taken whole, where Sure's error payload lists `claimed_in_full`.

The read label names goals as well: reading them is new to `archant:read`, and the consent page lists what each scope reads (Story 23.6 added « vos factures » the same way).

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green
- `pnpm test:e2e` -- expected: green, consent labels updated
