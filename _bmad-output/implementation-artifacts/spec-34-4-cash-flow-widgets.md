---
title: 'Story 34.4: Cash flow widgets'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '162b4f6fa3b837c762138b51cd55817de289342f'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the dashboard shows Archant's own `CashFlowSection`: one calendar month moved by arrows (`?month=`), a summary strip, and a donut toggled between expenses and income. Sure (`00dd977fb`, `pages_controller.rb#dashboard`) shows four widgets instead: `cashflow_sankey` and `outflows_donut` over the dashboard period, `money_flow` (six monthly bars, its own month and account filter) and `spending_trend` (its own month against the previous one).

**Approach:** three report reads in `services/reports.ts` built on the existing net and gross views (`domain/cash-flow.ts`), the Sankey graph built by a pure domain function, and four React widgets drawn with Recharts, already a dependency (`Sankey`, `Pie`, `BarChart`, `LineChart`). `CashFlowSection`, `useCashFlow` and the `month` search param go.

## Boundaries & Constraints

**Always:** amounts are integer minor units in the reporting currency over `cashFlowAccounts`' accounts, as Story 27.6 and 27.7 count them (`countsInCashFlow`); the API keeps AD-5 signs and the widgets display Sure's unsigned figures. Sankey and donut read the dashboard period (`useChartPeriod`, `resolveChartRange`, `all_time` from `oldestEntryDate`); money flow and spending trend ignore it and read their own month. A month param that is missing, unparsable or after this month (`today(deps.timeZone)`) is this month, as Sure's `money_flow_month_param`; no lower bound. Every visible string goes through `locales/fr.json` and `locales/en.json`, Sure's `config/locales/views/pages/{fr,en}.yml` text where it has one. A control that writes shows only for an administrator.

**Never:** no change to `getCashFlowWithRows`, budgets or MCP tools; no new dependency; no rearranging, resizing, collapsing or hiding (Story 34.6); no investment widget (Story 34.5); no stored figure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Surplus | net income 3 000 €, net expenses 2 000 € | income nodes → « Flux de trésorerie » → expense nodes and « Excédent » 1 000 € (33,3 %) | N/A |
| Deficit | net income 1 000 €, net expenses 1 500 € | no « Excédent » node and no « Déficit » node, as Sure | N/A |
| Sub-categories | « Courses » parent nets −300 €, child « Bio » −120 € | `expense_<parent>` → `expense_sub_<child>` 120 €, share 40 % | child of opposite sign: standalone node on its own side, linked straight to the centre |
| No counted row | period with nothing | « Aucune donnée de flux de trésorerie pour cette période », its description, « Ajouter une transaction » for an administrator | viewer: no button |
| Donut | three net expense lines | « Total des sorties » and total; « Catégories · 3 », « Valeur », « Poids » rows by amount, each linking `/transactions?category=<id|none>&from&to` of the period | no net expense: widget hidden, as Sure's `visible` |
| Money flow | `moneyFlowMonth=2026-11`, today 2026-11-04 | bars June–November, November partial and highlighted; « Du 1 novembre 2026 au 4 novembre 2026 »; « Balance des opérations » = gross income − gross expenses | `2027-03` or `abc` → this month |
| Account filter | two of five eligible accounts ticked, « Appliquer » | URL `moneyFlowAccountIds`, trigger « Filtrer les comptes (2) », rows link with `account` | unknown id dropped; none left → all |
| Spending trend | `spendingMonth=2026-03` | cumulative daily expense of March against all of February; axis 31 days; delta vs. February to day 28 | no spending in either → « Aucune dépense pour ce mois-ci » |
| Current month | today 2026-11-04 | current line stops at day 4; previous total at day 4; « (1-4) » | N/A |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/cash-flow-sankey.ts` (new) -- `cashFlowSankey(net, gross)` → `{ nodes: { id, name: null | string, kind, categoryId, color, amount, share }[], links: { source, target, amount, share, color }[] }`, Sure's `build_cashflow_sankey_data` and `process_net_category_nodes`: node ids `cash_flow_node`, `surplus_node`, `income_<id|uncategorised>`, `expense_…`, `income_sub_<id>`; sub-categories netted from `gross.subcategories` (expense minus income), zero dropped, a child of a zero-netted parent dropped; colour `#737373` when absent. Names of the centre and surplus are left to the interface (`kind`).
- `packages/api/src/domain/cash-flow.ts` -- reuse `grossCashFlow`, `netCashFlow`, `SubcategoryLines`; no change.
- `packages/api/src/services/reports.ts` -- replace `getCashFlow(month)` by `getDashboardCashFlow(deps, query: ChartQuery)` (period range, `CashFlow` minus `month` plus `period` and `sankey`); add `getMoneyFlow(deps, { month, accountIds })` from `cashFlowByDay` over the six months, accounts filtered to `cashFlowAccounts` (returned as `{ id, name }` by name for the filter); add `getSpendingTrend(deps, month)` from `cashFlowByDay`, expense side only (`sideOf`), cumulative per day, Sure's `fold_extra_days` and `comparison_days`.
- `packages/api/src/schemas/reports.ts`, `routes/reports.ts` -- `/cash-flow` takes `balanceQuerySchema`; `GET /money-flow?month&accountIds` and `GET /spending-trend?month`, month `monthSchema.optional().catch(undefined)`.
- `packages/api/src/domain/dates.ts` -- `monthRange`, `shiftMonth` from `@archant/data/months`, `addDays`, `minDate` reused.
- `packages/app/src/components/CashFlowSection.tsx`, `hooks/useCashFlow.ts` -- deleted; `CashFlowChart.tsx` stays for `BudgetDonut`.
- `packages/app/src/components/CashFlowSankey.tsx` (new, lazy) -- Recharts `Sankey` with `sort={false}`, `nodeWidth={15}`, custom `node` and `link`: gradient links at 10 % opacity, label right of a left-half node else left, name then value, Sure's overlap hiding per column, hover dimming others to 0.4, tooltip « Source → Cible » / value (share); label click on `income_`/`expense_` navigates to `/transactions` (category, period); node click with children zooms to its descendants, « Retour à la trésorerie totale »; « Développer » opens a `ui/dialog` with a taller chart.
- `packages/app/src/components/OutflowsDonut.tsx` (new) -- reuse `CashFlowChart`'s ring; centre « Total des sorties », on hover the segment's name, amount (`formatMoney`) and share; rows with `TintedIcon`, hovering a row highlights its segment.
- `packages/app/src/components/MoneyFlowSection.tsx`, `SpendingTrendSection.tsx` (new) -- month `DropdownMenu` (« Sélectionner un mois », this month and the eleven before, Sure's `month_picker_months`), `period_scope_hint` tooltip; money flow `Popover` with search, one `Checkbox` per account, « Appliquer »; income/expense rows link to `/transactions?direction=income|expense&status=confirmed&from&to[&account]`.
- `packages/app/src/lib/money-flow.ts` (new) or the hooks -- `useMoneyFlow`, `useSpendingTrend`, `useDashboardCashFlow`; keys under `queryKeys.transactions` (`cashFlow(period)`, `moneyFlow(month, ids)`, `spendingTrend(month)`) so existing invalidations refresh them.
- `packages/app/src/routes/_authed.index.tsx` -- search drops `month`, adds `moneyFlowMonth`, `moneyFlowAccountIds`, `spendingMonth`, each pick keeping the other params; grid order Sure's default: Sankey (`2xl:col-span-2`), « Sorties », `NetWorthSection`, `BalanceSheetSection`, money flow, spending trend, then `GoalsSection`.
- `packages/app/src/routes/_authed.transactions.tsx#accountChoiceOf` -- moved to `lib/` so the Sankey's empty state opens `TransactionSheet` for an administrator.
- `packages/app/src/locales/{fr,en}.json` -- `dashboard.cashFlow.*` replaced by `dashboard.cashflowSankey.*`, `outflowsDonut.*`, `moneyFlow.*`, `spendingTrend.*`.
- `packages/app/e2e/dashboard.spec.ts` (l.721–1150, 1153, 1228), `transfers.spec.ts` (l.423, 553) -- cash flow tests read `?month=`, « Flux de … » regions and the summary strip: rewritten.
- `docs/sure-parity.md` l.242 -- Cash flow row to Parity; `DESIGN.md` l.321 « the month's flow on the dashboard ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/cash-flow-sankey.spec.ts` then `cash-flow-sankey.ts` -- failing tests first: surplus node and share, deficit (no surplus, no deficit node), sub-categories of both signs, zero-netted parent, uncategorised node id, empty input.
- [x] `packages/api/src/services/reports.spec.ts`, `routes/reports.spec.ts` -- cash flow over a key and a custom range, the donut's weights summing to the net expense total; money flow six months, partial current month, future and unparsable month, account filter with an unknown id, ineligible PEA left out; spending trend cumulative series, fold of a 31-day previous month into 30, comparison day in the current month, refunds not reducing spending.
- [x] API services, schemas and routes as in the Code Map; delete `getCashFlow`.
- [x] App widgets, hooks, route and locales as in the Code Map; delete `CashFlowSection.tsx`, `useCashFlow.ts`; Vitest for any pure helper (month list, fold label).
- [x] `packages/app/e2e/dashboard.spec.ts` -- rewrite the cash flow tests onto « Sorties » and « Entrées / sorties d'argent » (custom period in the URL, `moneyFlowMonth`); new: a donut category leads to its transactions of the period; Sankey empty state; month picker moves money flow; spending trend headline; layout test for the new order.
- [x] `packages/app/e2e/transfers.spec.ts` -- the two dashboard checks read « Entrées / sorties d'argent ».
- [x] `docs/sure-parity.md`, `DESIGN.md`.

**Acceptance Criteria:**
- Given the dashboard with accounts, when it renders, then « Flux de trésorerie », « Sorties », « Patrimoine net », « Bilan », « Entrées / sorties d'argent » and « Dépenses » appear in that order and no month arrows remain.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- Decision, Sure settles it: no « Déficit » node; Sure's `build_cashflow_sankey_data` adds `surplus_node` only when the net is positive. The story's « or Déficit » is not built; the deficit test asserts neither node.
- Decision, French text: Sure hard-codes « Cash Flow » and « Surplus »; Archant reads « Flux de trésorerie » / « Cash Flow » and « Excédent » / « Surplus ». The donut's hover amount uses `formatMoney` where Sure hard-codes an English delimiter.
- Decision: a month pick or the account filter keeps the other search params; Sure's links rebuild `root_path` and lose the period, a Turbo frame side effect.
- Decision: an opposite-sign sub-category's share is over the side it is drawn on; Sure divides by its parent's side total.
- Assumption: month params are `YYYY-MM`, as `monthSchema`, where Sure takes a day.
- `cashFlowSankey` takes `(net, subcategories, categories)`: a sub-category's own colour is not in `SubcategoryLines`.
- Sankey amounts are flow sizes, never negative; the spending trend keeps AD-5 signs and the interface computes the delta as Sure.
- The Sankey's value line is 12 px, DESIGN.md's floor, where Sure's is 0.65rem.
- `conversions.spec.ts` and `serving.spec.ts` read `?month=` and were rewritten too.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `OutflowsDonut` keeps live links on placeholder data after a period change | medium | patch | `_authed.index.tsx` renders it from `cashFlow.data` without `inert`, where `CashFlowSankeySection` sets it. |
| 2 | Zoom and hover survive a period change | low | patch | `zoomRoot` and `hovered` are state of `CashFlowSankey`, never reset when `data` changes; a stale zoom-out button or wrong dimming follows. |
| 3 | Overlap hiding can read no laid-out node when `ResponsiveContainer` draws in its own later render | low | patch | The parent's `useLayoutEffect` does not run again for a render inside `ResponsiveContainer`. |
| 4 | Month picker trigger's `aria-label` hides the month shown | low | patch | « Sélectionner un mois » replaces « Novembre 2026 »; `PeriodPicker` names its value (« Période : 30J »). |
| 5 | `docs/sure-parity.md` omits the departures this story keeps | low | patch | The share of an opposite-sign sub-category, the 12 px value line and the donut's hover amount are not listed. |
| 6 | One account picked reaches the API as a string; no test covers it | medium | patch | Hono gives a lone key as a string; the route specs' single-key cases expect `null` either way. |
| 7 | Account filter, money flow rows, Sankey label, zoom and back untested end to end | medium | patch | No e2e clicks them; the matrix's « Account filter » row has no UI test. |
| 8 | Viewer's empty state has no test that « Ajouter une transaction » is absent | medium | patch | Matrix row « No counted row: viewer no button »; `viewer.spec.ts` checks the default period only. |
| 9 | Opposite-sign sub-category drawn twice, centre's links unbalanced | false | reject | Sure's `process_net_category_nodes` does the same: its parent is netted, its standalone node linked to the centre. |
| 10 | Same-side sub-categories can outweigh their parent | false | reject | Sure's, from the same nets; d3 and Recharts size the node from its links. |
| 11 | Sankey not reachable by keyboard | low | reject | Sure's Sankey is mouse-only; Story 34.3 kept the mouse-only brush for the same reason; « Sorties » rows open each expense category. |
| 12 | Picker's « this month » reads the browser's zone, the server `APP_TIMEZONE` | low | reject | As Story 34.3 #20: the interface already reads the browser's month; differs only around midnight at a month's end. |
| 13 | Expanded dialog height read once | low | reject | Resizing with the dialog open only leaves a shorter or taller chart until it reopens. |
| 14 | Labels may sit on the wrong side on first render | maybe-false | reject | Would need a render with a detached container; `ResponsiveContainer` draws only once measured, after the ref is set. Only low if true. |
| 15 | `month` years near 0000 break `shiftMonth` | low | reject | Hand-edited URL only; `monthSchema` predates the story. |
| 16 | Spec's Code Map signature and status disagree with code | false | reject | Fix edits the spec; recorded in Implementation Notes; status and sprint status both move to `done` at the end. |
| 17 | Old `?month=` links lose their month silently | low | reject | Intended by the spec (`month` goes); said in the pull request. |
| 18 | Locales: « Du » and « du », « Cashflow » and « Cash Flow » | false | reject | Sure's own `pages/fr.yml` and `en.yml` text. |
| 19 | Income list and savings figure gone | false | reject | The spec replaces `CashFlowSection` with Sure's widgets. |
| 20 | Donut segment does not open its transactions | medium | patch | Sure's donut sets `enable-click-value`; only the rows linked. |
| 21 | « Sans catégorie » coloured differently in the donut and the Sankey | low | patch | `var(--muted-foreground)` against Sure's `#737373` in both. |
| 22 | No short date range on a phone in « Dépenses » | low | patch | Sure's `date_range_short` below `sm`. |
| 23 | Money flow month labels never shorten | low | patch | Sure's bar chart falls back to `%b`, then every other tick. |
| 24 | Money as bare `number` in the Sankey builder and the spending series | low | patch | AGENTS.md « Money is never a float ». |
| 25 | A category without an icon looks uncategorised in the donut | false | reject | `CashFlowCategory.icon` is never null; only « Sans catégorie » has none. |
| 26 | Repeated error and placeholder blocks, helpers in `dashboard-months.ts`, `CENTRE_ID` copied | low | reject | Each block matches the existing sections' pattern; the id is Sure's fixed key, tested on both sides. |
| 27 | Donut has no skeleton while loading | low | reject | Sure hides the widget until it has categories; the Sankey above holds the space. |
| 28 | Visual QA: « Dépenses » drew no money axis nor grid and clipped day 1 | medium | patch | Sure's `spending-chart` draws four dashed lines, a compact money axis on the right and anchors day 1 at its start; fixed and checked in the browser. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean; knip finds no leftover `CashFlowSection`, `useCashFlow`, `getCashFlow` or locale key.
- `pnpm test` -- expected: green, the new domain, service and route specs included.
- `pnpm test:e2e` -- expected: green.

**Manual checks:**
- Screenshot each widget in French and English, the Sankey zoomed and expanded, the account filter open, at 1440 px and 1600 px.
