---
title: 'Story 21.3: Keep a reserve'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
baseline_commit: 'a2cfdc794fce287605e519b6bab4c4ef6254b591'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-2-follow-a-goal-to-its-end.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every goal saves toward a target by a date and can be closed. An emergency fund is neither: it is a balance kept full, sized on what the household spends, and the household has to retype its target whenever spending moves.

**Approach:** Sure's maintained goal (`app/models/goal.rb`: `kind` `maintained`, `TARGET_MODES = %w[fixed months_of_expenses]`, `target_months`, statuses `funded` and `depleted`, `complete` guarded by `one_off?`) on 21.1's tables and 21.2's lifecycle. The target in months is AD-9's median monthly expenses times the months, computed when read, where Sure stores it and refreshes it by a monthly job (NFR9). Story 21.3 of `epics.md` is the acceptance contract; every choice below was decided under the owner's delegation.

## Boundaries & Constraints

**Always:**
- `GOAL_TARGET_MODES = ["fixed", "months_of_expenses"]` and `GOAL_TARGET_MONTHS_MAX = 120` in `packages/data/goals.ts`. `goals` gains `target_mode` (not null, default `fixed`) and `target_months` (integer, null), Sure's names. Checks: mode in list; `target_months` set exactly in months mode, between 1 and 120; months mode only on a `maintained` goal; a `maintained` goal has no `target_date`.
- Monthly expenses: `suggestions(getCashFlowHistory(deps, current), current, current).spending`, the budget's suggested spending (Story 17.1): the median over every complete month before the current one, in `APP_TIMEZONE`, that has an expense line; the current month never counts, months without expense are left out, as Sure's `IncomeStatement` median. Reporting currency only (AD-6). Read only when a months-mode goal exists.
- A months-mode reserve's target, when read, is `target_months × median` when the goal is in the reporting currency and a median exists; otherwise the stored `target_amount` stands, as Sure's « a stale floor beats a wrong one ». Saving one stores that product as `target_amount`, and refuses `targetMonths` `no_expenses` when no median exists and `not_reporting_currency` when its accounts are in another currency, except an edit that keeps a reserve's mode and months, which keeps the stored target then.
- Form fields: `kind` (default `one_off`), `targetMode` (default `fixed`), `targetMonths` (text). `targetAmount` is required in fixed mode only; `targetMonths` in months mode only, an integer 1–120, else `invalid_months`; months mode on a `one_off` goal is `targetMode` `reserve_only`; a reserve's date is dropped. Changing the kind of a completed or archived goal is `kind` `kind_locked`, as Sure's `kind_locked_while_released`.
- `goalProgress` takes the kind: a reserve's status is `funded` when nothing remains, else `depleted`; it has no date, so no monthly amount. Sort ranks, Sure's `ACTIVE_DISPLAY_STATUS_RANK`: `behind` and `depleted` 0, `on_track` 1, `no_target_date` 2, `reached` and `funded` 3. The dashboard summary counts reserves in saved and target, never in `behind`.
- Responses gain `targetMode`, `targetMonths` and `monthlyExpenses` (the median the target multiplies, `null` otherwise); `targetAmount` is the target as read.
- Interface: the dialog starts with « Objectif ponctuel » / « Réserve », Sure's hints; « Réserve » hides the date and offers « Un montant fixe » / « Un nombre de mois de dépenses », the latter a « Mois de dépenses » field in place of the amount. Badges « Constituée » (neutral) and « Entamée » (warning). Card and page show « N mois de dépenses » for a months reserve; the page names the median, or says the last computed target stands, and calls what remains « À recompléter ». « Marquer comme terminé » is never offered to a reserve (21.2 already).
- Export: `target_mode` and `target_months` in `EXPORTED_COLUMNS` and on `Goal` lines.

**Never:** no job and no write on read; no currency conversion; no monthly-expenses endpoint or preview in the dialog; no pledge or consumption.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Months target | expenses 2 000, 1 000, 3 000 in three earlier months, 6 months | target 12 000 (median 2 000), `monthlyExpenses` 2 000 |
| Current month | a 9 000 expense this month only | `no_expenses` on save |
| Funded | share 1 000, fixed target 800 | `funded`, « Constituée » |
| Depleted | share 300, target 800 | `depleted`, sorts with `behind`, before `on_track` |
| Median gone | expenses excluded after save | stored target stands, `monthlyExpenses` null |
| Complete | reserve | `409 GOAL_STATE_INVALID` |
| One-off in months | `kind` one_off, months mode | `targetMode` `reserve_only` |
| Kind of archived goal | one_off → maintained | `kind` `kind_locked` |

</frozen-after-approval>

## Code Map

- `packages/data/goals.ts`, `schema/goals.ts`, `drizzle/0048_*` (hand-edit the rebuild's `INSERT` as 0047's note says), `migrate.spec.ts` `describe("goals")`, `goals.spec.ts`.
- `packages/api/src/domain/goals.ts` `goalProgress`, `statusOf`, `GOAL_STATUSES`, `rankOf`, `compareGoals`, `goalsSummary`; spec beside it covers every branch.
- `packages/api/src/domain/budgets/actuals.ts` `suggestions` (reuse, do not copy); `services/reports.ts` `getCashFlowHistory`; `services/budgets.ts` `budgetMonths` (current month from `today(deps.timeZone)`).
- `packages/api/src/schemas/goals.ts` `goalBodySchema`, `goalSchema` (object-level check for the mode-dependent fields; zod 4 runs it beside field errors); `services/goals.ts` `listGoals`, `createGoal`, `updateGoal`, `GoalSummary`; `routes/goals.spec.ts`.
- `packages/api/src/services/ledger/export.ts` `EXPORTED_COLUMNS.goals`; `services/export.ts` `goalsNdjson`; `services/export.spec.ts`.
- App: `components/GoalDialog.tsx` (radio cards as `DuplicateDialog.tsx`), `GoalCard.tsx` `GOAL_BADGES`, `StatusBadge.tsx`, `routes/_authed.goals.$goalId.tsx` `Progress`, `locales/fr.json` (`goals.*`, `errors.fields.*`).
- E2E: `e2e/goals.spec.ts`, `fixtures.ts` `createGoal` (one worker, so the shared database's median is stable within a test).
- Docs: `EXPERIENCE.md` Goals rows, `docs/sure-parity.md` savings goals row, `docs/deployment.md` `goals.ndjson` sentence if it lists columns.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/goals.spec.ts`, `goals.ts`, `schema/goals.ts`, migration, `migrate.spec.ts` -- modes, months, checks tested in SQL.
- [x] `packages/api/src/domain/goals.spec.ts`, `goals.ts` -- reserve status, ranks, months target; test first.
- [x] `packages/api/src/schemas/goals.ts`, `services/goals.ts`, `routes/goals.spec.ts` -- fields and codes, median window, stored floor, kind lock, complete refused, sort, summary.
- [x] Export columns and spec.
- [x] App: dialog, badges, card, page, `fr.json`.
- [x] E2E: create a months reserve from the dialog (target equals months × the budget's suggested spending), a fixed reserve « Constituée », an « Entamée » one sorted before it, no « Marquer comme terminé » in its menu, no date field.
- [x] Docs above; `sprint-status.yaml` story and `epic-21` to `done`.

**Acceptance Criteria:**
- Given Story 21.3 of `epics.md`, when the story ships, then each criterion holds as this spec settles it.

## Implementation Notes

- `goalSchema` reads `targetAmount` and `targetMonths` as trimmed text and parses the one the mode uses in `targetOf`, from an object-level `superRefine` with `when`: zod 4 skips an object refinement after a field's transform or pipe fails, so without `when` the months error would wait for the name to be fixed. Its output carries `target`, `{ mode: "fixed", amount }` or `{ mode: "months_of_expenses", months }`, and drops a reserve's date.
- The dialog's resolver and submit go through `sent`: a reserve sends no date, a one-off goal sends `fixed`, so a hidden field never fails the form. The kind and the target mode are radio cards named by their label alone, the hint as their description.
- `monthsOfExpenses` treats a median at or below zero as none: a target of zero breaks the `target_amount > 0` check on save and divides by zero on read, as Sure's `months_of_expenses_amount` refuses a non-positive figure.
- Migration 0048 also clears the date of a reserve that would carry one, so the rebuild never fails on `goals_reserve_date_check`; no form could make a reserve before this story.
- `kind_locked` is checked before the accounts and the target, on the stored state, as Sure's reads `state_in_database`.

## Spec Change Log

- Review, blind, edge-case and verification-gap layers: `updateGoal` recomputed every months reserve's target on save, so once the median was gone (its expenses excluded, the reporting currency changed) renaming the reserve or editing its notes was refused `no_expenses`, while its page says the last target stands. Amended the frozen save rule: an edit that keeps the reserve's mode and months keeps the stored target when no product can be computed, under the owner's delegation of every decision for this run, as Sure's `apply_months_of_expenses_target` keeps the previous target when its median is nil. Avoids a reserve that cannot be edited at all. KEEP: the refusal on create and on a change of months or mode; the read never writes.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge, verification-gap | An edit of a months reserve whose median is gone is refused `no_expenses`, even a rename | medium | `updateGoal` calls `storedTarget` on every save; Sure keeps the previous target when its median is nil | frozen rule amended (Spec Change Log), then patch: keep the stored target when mode and months are unchanged |
| blind | `goalBodySchema` requires `targetAmount` even in months mode | low | `targetAmount: z.string()` in the body schema; the spec makes it required in fixed mode only | patch: optional, blank by default |
| blind | Cash-flow writes that move no balance leave a months reserve's target stale | low | Goals sit under `accounts.all`; `useInvalidateBulk({ balances: false })` invalidates only `transactions.all`, while the median follows cash flow | patch: a bulk write also invalidates `goals`; the query key's comment says so |
| blind | `STATE_RANKS` hard-codes ranks above `STATUS_RANKS`' maximum | low | `{ paused: 4, ... }` breaks silently if a status gets rank 4 | patch: derive them from the maximum |
| blind, verification-gap | The export test cannot tell the stored target from the target as read | medium | The median does not move between save and export | patch: an expense after the save, `target_amount` still the stored one |
| blind, verification-gap | Nothing walks a months reserve back to a one-off goal, through `sent()` | medium | No e2e or API test switches back; a `sent()` regression would block the form with an invisible error | patch: e2e round trip |
| verification-gap | The kind lock is never shown to spare a paused goal | low | Tests cover active, archived and completed only | patch: API test |
| edge | The stale-target sentence blames missing expenses when the goal is in another currency | low | `monthlyExpenses` is null in both cases | patch: one wording for both |
| edge | The e2e test does not say why it needs a median above zero | low | `not.toBeNull()` passes on 0, which the server refuses | patch: `toBeGreaterThan(0)` |
| edge | A `PUT` that leaves out `kind` turns a reserve into a one-off goal | low | `PUT` replaces every field, as 21.1 settles; the dialog always sends the kind | rejected |
| edge | `targetMonths: null` fails the body | low | No client sends it; the field is text like every other | rejected |
| blind | The kind radios stay enabled on a completed or archived goal | low | The server answers `kind_locked` under the fieldset; editing a released goal's kind is rare | rejected |
| blind | `listGoals` reads the whole cash-flow history when a months reserve exists | low | The budget page runs the same `getCashFlowHistory` on every open; one grouped query | rejected |
| blind | The stale-target sentence has no interface test | low | Needs every expense of the shared e2e database excluded; the API test covers `monthlyExpenses: null` | rejected |
| blind | `sprint-status.yaml` says done before the review | false | Step 5 syncs both before the pull request | rejected |
| blind, edge | `packages/data/goals.spec.ts` is listed but unchanged | low | The constants hold no logic; `migrate.spec.ts` tests them in SQL | rejected |
| blind | Service field errors do not all come at once | low | `assertFundable` already runs after the schema since 21.1 | rejected |
| blind | The e2e sort check only orders « Entamée » before « Constituée » | low | `routes/goals.spec.ts` asserts every rank | rejected |
| spec-review spec | `EXPERIENCE.md` reads as if both reserve badges take the warning tint | low | « Constituée » is neutral in `StatusBadge.tsx` and in this spec | patched |
| spec-review spec | The dialog asks the name before the kind, where this spec has it start with the kind | low | Sure's form puts the kind radios first | patched: kind first |
| spec-review spec | A reserve's page still shows « Rythme sur 90 jours » | low | Neutral information; the spec says nothing against it | rejected |
| spec-review standards | `kind_locked` builds its `AppError` by hand beside `targetMonthsError` | low | Two copies of one field-error shape in `services/goals.ts` | patched: one `fieldError` |
| spec-review standards | `storedTarget` reads the reporting currency twice | low | Two `getReportingCurrency()` calls | patched |
| spec-review standards | `monthsOf` returns a sentence, not months | low | `_authed.goals.$goalId.tsx` | patched: `reserveTargetNote` |
| spec-review standards | `RadioCard` repeats `DuplicateDialog`'s radio card | low | Extracting it edits a file this story does not touch | rejected |
| spec-review standards | `targetAsRead` and `storedTarget` both test months mode and the reporting currency | low | One reads with a fallback, the other writes or refuses; neither can call the other | rejected |
| spec-review standards | `targetOf` runs in the refinement and in the transform | low | The refinement must run beside other fields' errors, the transform only on success | rejected |
| spec-review standards | `kind === "maintained"` recurs in six places | low | Each is a one-line test of a two-value union | rejected |
| spec-review standards | The bulk invalidation's comment cites a category change, which AD-9 says moves no expense | false | `actualsOf` nets refunds per category, so moving a refund changes the spending median | rejected |
| spec-review standards | `median ?? 0` recurs in the e2e test | low | Test-only, typed by the schema it parses | rejected |

## Design Notes

The stored `target_amount` of a months reserve is what Sure's job would have left: the last product computed, here at save. It keeps the column not null and gives a target when the median disappears (its transactions excluded, the reporting currency changed), so the read never fails and never writes.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/goals.ts` covered to the branch
- `pnpm test:e2e` (under the `/tmp/archant-e2e.lock` lock) -- expected: green
