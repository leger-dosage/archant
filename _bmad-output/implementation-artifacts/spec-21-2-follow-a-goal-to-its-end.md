---
title: 'Story 21.2: Follow a goal to its end'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
baseline_commit: 'd487933c186853e662d639f21e36ad7834ea270d'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-21-1-save-toward-a-goal.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A goal can only be created, edited and deleted: the household cannot pause it, close it once reached, put it away and bring it back, nor see where it is heading, and the dashboard says nothing of goals. Since 21.1 the bottom navigation holds eight entries and cuts « Opérations », « Récurrent » and « Réglages » at 390 px.

**Approach:** Sure's lifecycle (`app/models/goal.rb` AASM events, `goals_controller.rb#perform_transition!`), its goal chart (`goal_projection_chart_controller.js`, `balance_series_values`) and its « Vos objectifs » card (`plans/_goals_card.html.erb`, `Goal.summary_for`), placed on Archant's dashboard because Archant has no Plan page. The bottom navigation keeps four destinations and a « Plus » menu. Story 21.2 of `epics.md` is the acceptance contract; this spec records what Sure and the code settled, every choice decided under the owner's delegation.

## Boundaries & Constraints

**Always:**
- Events, as Sure's: `pause` active→paused; `resume` paused→active; `complete` active|paused→completed, `one_off` only; `archive` active|paused|completed→archived; `restore` (Sure's `unarchive`) archived→active; `reopen` completed→active. `GOAL_EVENTS` and a pure `goalTransition(state, kind, event): GoalState | null` live in `packages/data/goals.ts`, so the page offers only what the server accepts. Any other pair answers `409 GOAL_STATE_INVALID`, nothing written.
- `goals` gains `completed_amount` and `completed_at` (epoch ms), both null or both set (check). `complete` stores the goal's share at that moment and the time; leaving a released state for `active` clears both; `archive` from completed keeps them. A goal with a completed amount reads it as `saved`, `percent` 100 and status `reached` when completed; others compute as in 21.1.
- `restore` and `reopen` refuse with `409 GOAL_ACCOUNT_TAKEN`, `params.accountId`, when another non-released goal now takes whole an account this goal takes whole, as Sure's `restore_must_not_recreate_whole_account_conflict`; checked in the same immediate transaction as the write.
- `POST /api/goals/:id/:event` (event from `GOAL_EVENTS`, else `VALIDATION_ERROR`) returns the goal; under `viewerReadOnly`. Editing and deleting stay allowed in every state, as Sure.
- Sort, as Sure's `active_display_sort` and index: active by status as 21.1, then paused, then completed, then archived, by name within each.
- `GET /api/goals/:id/history`: `{ currency, from, to, points: { date, saved }[] }`, one point per day from `max(today − 90, earliest opening date of its active linked accounts)` to today, each day's `saved` the goal's `backingShares` of each active linked account's balance that day under today's links, from `balancesBetween` (AD-8). The pure series function lives in `domain/goals.ts`.
- `GET /api/goals/summary` (declared before `/:id`): from `listGoals`, the non-released goals (active and paused) as Sure's Plan card: `count`, `saved` and `target` summed over those in the reporting currency, `leftOut` naming the others, `behind` counting active goals with status `behind` (Sure's `behind_pace?`), and the first five `goals` in list order. Pure in `domain/goals.ts`.
- Goal page: the chart for active and paused goals, as Sure's projection panel: the saved area over 90 days, a dashed target line at the target, and, with a future date and something remaining, a line from today's saved to the target on its date; a text summary above and the data as a table on demand. Paused, completed and archived goals show a banner, Sure's wording, with « Reprendre l'objectif », « Archiver l'objectif » or « Restaurer l'objectif »; a completed goal shows « Atteint le <date> · <montant> » and hides what remains and the monthly amount.
- Admin actions: « Modifier » and a « … » menu holding the allowed events (« Mettre en pause », « Reprendre », « Marquer comme terminé », « Archiver », « Restaurer », « Rouvrir ») then « Supprimer ». « Marquer comme terminé » and « Archiver » confirm, with Sure's text. A viewer sees neither menu nor banner button.
- `/goals`: cards show « En pause », « Terminé » or « Archivé » in place of the progress status; archived goals sit in a collapsed « Archivés » section below the grid.
- Dashboard: a « Objectifs » card after the balance sheet when a non-released goal exists: « N actifs », saved « sur <cible> tous objectifs confondus » with a bar, « N en retard » or « Tout est dans les temps », the left-out goals by name, up to five rows (name link, badge, bar, saved / target), « Tous les objectifs » → `/goals`.
- Bottom navigation below 1024 px: « Accueil », « Opérations », « Budgets », « Objectifs », then a « Plus » button opening a menu with « Comptes », « Récurrent », « Règles », « Réglages », marked current when the page is one of them. Sure's bar shows four to six entries and reaches the accounts list and settings from the top bar, as Archant's menu and avatar already do. The rail keeps all eight.
- Export: both columns in `EXPORTED_COLUMNS`, `completed_amount` (decimal) and `completed_at` on `Goal` lines.

**Never:** no reserve (21.3), no pledge, consumption, filter chips or « Clôturer » hint for a reached active goal; no goal in `all.ndjson`; no account or goal name in error params (AD-14).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Complete | active, share 450 | completed, `saved` 450 frozen, `percent` 100, account released |
| Archive completed | completed 450, balance moves | archived, still 450 |
| Reopen | completed | active, frozen amount cleared, shares live again |
| Restore blocked | archived A whole on X, B now whole on X | `409 GOAL_ACCOUNT_TAKEN` `accountId` X, A stays archived |
| Bad event | `resume` on active, `complete` on archived | `409 GOAL_STATE_INVALID` |
| Paused | paused goal on X whole | keeps X, a new whole link on X still refused |
| Series | balance 0 → 1 000 over 90 days, B fixed 300 | first 0, last 700 |
| Summary | EUR goals 200/1 000 and 300/500, USD goal | saved 500, target 1 500, USD goal in `leftOut` |
| Viewer | any event | `403 FORBIDDEN` |

</frozen-after-approval>

## Code Map

- `packages/data/goals.ts` (states, `RELEASED_GOAL_STATES`), `schema/goals.ts` (add columns and check), `drizzle/0047_*`, `migrate.spec.ts` `describe("goals")`; a new `goals.spec.ts` beside `money.spec.ts` for `goalTransition`.
- `packages/api/src/domain/goals.ts` `backingShares`, `goalProgress`, `compareGoals` (gains state ranks), new series and summary functions; `domain/balances/forward.ts` `DailyBalance`; `domain/dates.ts` `addDays`, `maxDate`.
- `packages/api/src/services/goals.ts` `listGoals` (factor the goals/links/pool load for the history), `assertFundable` (whole-link query to reuse for restore), `getGoal`; `services/ledger/balances.ts` `balancesBetween`, `openingDateOf`; `services/settings.ts` `getReportingCurrency`.
- `packages/api/src/lib/errors.ts` add `GOAL_STATE_INVALID`, `GOAL_ACCOUNT_TAKEN` (409); `routes/goals.ts`, `routes/goals.spec.ts` (`useSignedInApp`, clock 2026-09-21), `routes/middleware/roles.spec.ts` route list and count.
- `packages/api/src/services/ledger/export.ts` `EXPORTED_COLUMNS.goals`, `services/export.ts` `goalsNdjson`, `services/export.spec.ts`.
- App: `components/AppShell.tsx` `DESTINATIONS`, `MainNav`; `components/ui/dropdown-menu.tsx`; `components/AccountMenu.tsx` (menu pattern); `routes/_authed.goals.$goalId.tsx`, `_authed.goals.index.tsx`, `components/GoalCard.tsx` `GOAL_BADGES`, `StatusBadge.tsx` (add paused/completed/archived variants, `CirclePauseIcon` as `ruleDisabled`); `components/BalanceChart.tsx` (summary, table toggle, axis helpers to mirror in a `GoalChart.tsx`); `lib/chart-heights.ts`, `lib/chart-axis.ts`, `lib/balance-change.ts`; `routes/_authed.index.tsx`, `components/Section.tsx`, `LeftOutNotice.tsx`; `hooks/useGoals.ts`, `lib/query-keys.ts` (under `accounts`); `ConfirmDialog.tsx`; `lib/error-toast.ts`; `locales/fr.json`.
- E2E: `e2e/goals.spec.ts`, `fixtures.ts` `api.createGoal`, `e2e/viewer.spec.ts` goals step, `e2e/shell.spec.ts` phone tests, dashboard spec if one names the dashboard's sections.
- Docs: `EXPERIENCE.md` (Dashboard and Goals rows, Responsive rows), `docs/sure-parity.md` savings goals row, `docs/deployment.md` `goals.ndjson` sentence, `docs/security-model.md` if a route list moves.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/goals.spec.ts`, `goals.ts` -- transition table, test first.
- [x] `packages/data/schema/goals.ts`, migration, `migrate.spec.ts` -- columns and both-or-none check.
- [x] `packages/api/src/domain/goals.spec.ts`, `goals.ts` -- frozen progress, state sort, share series, summary; every branch.
- [x] `packages/api/src/lib/errors.ts`, `services/goals.ts`, `routes/goals.ts`, `routes/goals.spec.ts`, `roles.spec.ts` -- events, freeze, release, restore conflict, history, summary, viewer.
- [x] `services/ledger/export.ts`, `services/export.ts`, spec -- the two columns.
- [x] App: badges, `useGoals.ts` hooks, `GoalMenu.tsx`, `GoalStateBanner`, `GoalChart.tsx`, goal page, index « Archivés », `GoalsSection.tsx` on the dashboard, `fr.json`.
- [x] `AppShell.tsx` -- compact bottom navigation and « Plus ».
- [x] E2E: lifecycle from the menu with confirmations and banners, restore refused, chart summary and table, dashboard card, viewer sees no lifecycle control, phone navigation at 360 and 390 px with no truncated label and « Plus ».
- [x] Docs above.

**Acceptance Criteria:**
- Given Story 21.2 of `epics.md`, when the story ships, then each criterion holds as this spec settles it.
- Given a 360 px or 390 px wide screen, when any page opens, then every bottom-navigation label shows whole and each of the eight destinations is reachable.

## Implementation Notes

- The chart's first day is `paceStart(today, earliest opening)`: the same « 90 days ago, or the opening if later, never after today » rule as the pace. A goal without an active account goes back 90 days and draws zero.
- `listGoals` and `getGoalHistory` share `loadGoals`, which returns each link's competing links: the pool of goals holding their money, plus the goal's own link when it released its money. `assertFundable` and the restore check share `wholeTakenElsewhere`.
- `GoalSummary` gains `completedAt`; `saved` is the frozen amount whenever one is stored, so an archived goal completed before keeps it, as Sure's `current_balance`. `goalProgress` takes `completed`, which sets `percent` 100 and `reached`.
- `GOAL_ACCOUNT_TAKEN` carries the account id only; the page names the account from the goal's own links in the toast.
- The archive confirmation adapts Sure's « clôturez d'abord l'objectif » to « marquez d'abord l'objectif comme terminé », Archant's verb, and drops that sentence for a completed goal, whose amount is frozen already. The banner of a completed goal says « Objectif terminé à … » for the same reason.
- The dashboard card puts « N actifs » before « N en retard » on one line rather than beside the heading, so the region keeps the name « Objectifs ». The left-out goals reuse `LeftOutNotice`.
- The bottom navigation is a second `nav` named « Navigation principale », shown below 1024 px; the rail keeps `MainNav` with all eight. « Plus » is a Radix dropdown trigger carrying `aria-current="page"` on one of its four pages.
- `packages/data/vitest.config.ts` covers `goals.ts` to the branch beside `money.ts` and `months.ts`.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind, edge | Editing a completed or archived goal is refused `whole_balance_taken` once another goal takes its account whole | medium | `updateGoal` reinserts every link and `assertFundable` checks each; Sure's `whole_account_link_must_be_exclusive` only checks links new or changed, and the spec keeps editing allowed in every state | patch: skip the check for a whole link the goal already had |
| blind, edge | A refused event leaves the page on its stale state, the toast saying the state changed | low | `useGoalEvent` invalidates on success only; `GOAL_STATE_INVALID` reads « a changé d'état entre-temps » | patch: invalidate on settle |
| blind, edge, verification-gap | A paused or archived goal's page and chart still ask for a monthly amount; an archived goal once completed shows « Atteint le » beside « Reste » | medium | `Progress` gates on `state === "completed"` only, `GoalChart` draws the line to the target for any saving goal; Sure shows the frozen note for a completed goal only and no projection for a paused one | patch: monthly figure and line to the target for active goals only, « Atteint le » for completed goals only |
| verification-gap | No test fails if a card that is not active shows « par mois » | medium | Lifecycle e2e checks the archived card's badge only | patch: assertion |
| verification-gap | No test checks the dashboard card is absent without a goal holding its money | medium | The only card test mocks `count: 3` | patch: `count: 0` step |
| verification-gap | The archive dialog assertion passes with either text | medium | « Vous pourrez les restaurer plus tard. » is in both | patch: assert the completed text lacks « marquez d'abord » |
| blind | Nothing clicks « Rouvrir » in the interface | low | Lifecycle e2e covers pause, complete, archive, restore; API tests cover reopen | patch: one reopen step |
| blind | `DESIGN.md` still says the bottom navigation holds the rail's entries | low | Line 298 | patch |
| blind | A completed goal's API figures carry `remaining` and `monthlyNeeded` beside `percent` 100 | low | Every consumer gates on state; Sure's model keeps `remaining_amount` too | rejected |
| blind, edge | The card reads « 0 € sur 0 € » when every holding goal is in another currency | low | Needs a household whose every goal is in a currency other than its reporting one; the left-out notice names them | rejected |
| blind | « N actifs » counts paused goals | low | Sure's « %{count} actifs » counts `active_prepared_for`, paused included | rejected: Sure |
| blind, edge | `/goals` shows only the collapsed « Archivés » section when every goal is archived | low | The section says how many it holds and « Nouvel objectif » stays in the header | rejected |
| blind | No check ties the completion columns to the state | low | Only `transitionGoal` writes them, with the state, in one update | rejected |
| blind | A viewer reads banner text that invites an action | low | Sure's banners read the same for every member | rejected: Sure |
| blind, edge | `/history` of a completed or archived goal draws live shares | low | The page asks for it on active and paused goals only | rejected |
| blind | A far target date squeezes the 90 days | low | Sure's chart spans to the date the same way | rejected: Sure |
| blind | `sprint-status.yaml` and the spec disagree on the status | false | Step 5 syncs both before the pull request | rejected |
| edge | « Atteint le » formats the day in the browser's time zone | low | One household; the browser and `APP_TIMEZONE` agree but across a border near midnight | rejected |
| edge | « Supprimer » while an event is pending races it | low | Needs a click within the event's round trip | rejected |
| spec-review standards | `GoalChart.tsx` carries amounts as bare `number` | medium | AGENTS.md: « A bare `number` … that means money is a bug » | patched: `MinorUnits` throughout |
| spec-review standards | AD-16 names `money.ts` and `months.ts` only, while `goals.ts` joins the 100 % threshold | low | `docs/architecture.md` AD-16 | patched |
| spec-review standards | `goals.figures.reached` is unused | low | Only `reachedOn` is read | patched: removed |
| spec-review standards | The line-to-target condition is written twice in `GoalChart.tsx` | low | `pointsOf` and `Summary` | patched: `aheadOf` |
| spec-review standards | « Not active » tables repeat across the domain sort, badges and banners | low | Each answers a different question: rank, badge text, banner action | rejected |
| spec-review standards | `isAt` mirrors the router's active match for « Plus » | low | A trigger is no `Link`; the rule is the `Link`'s own `exact` flag | rejected |
| spec-review spec | `EXPERIENCE.md` attributes « Plus » to Sure | low | Sure's bar has no such menu | patched: departure recorded |
| spec-review spec | The viewer e2e checks the paused banner only | low | One branch, `onEvent={admin ? request : null}`, serves the three banners; the API refuses every event | rejected |
| spec-review spec | On `/accounts/:id` neither the bottom bar nor the rail marks an entry | low | The rail behaves so since Epic 14, the account's row being the current entry | rejected |

## Design Notes

The series computes each day's share under today's links rather than Sure's `current_balance / whole_total` ratio applied to the whole series: the last point then equals the saved amount shown beside it, and two goals on one account never draw the same euros.

Completing reads the goal's share before its immediate transaction, which rechecks the state: a balance moving between the two leaves a stale frozen amount, which one household's single writer makes harmless.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, `domain/goals.ts` covered to the branch
- `pnpm test:e2e` (under the `/tmp/archant-e2e.lock` lock) -- expected: green
