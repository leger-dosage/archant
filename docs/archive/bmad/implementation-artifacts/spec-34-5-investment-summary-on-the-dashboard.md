---
title: 'Story 34.5: Investment summary on the dashboard'
type: 'feature'
created: '2026-11-05'
status: 'done'
baseline_commit: '984048f789f76057358caf562cdf502a5331b440'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the dashboard has no investment widget. Sure (`00dd977fb`) shows `pages/dashboard/_investment_summary.html.erb`: « Investissements », the portfolio's value, « Rendement total », the five largest holdings and the dashboard period's « Activité », read from `InvestmentStatement`.

**Approach:** one report read, `getInvestmentSummary(deps, query: ChartQuery)` in `services/reports.ts`, built on the ledger's `currentHoldings` and on a pure domain module for Sure's roll-up, weights and trends; one React widget placed after « Sorties ».

## Boundaries & Constraints

**Always:** accounts are Sure's `investment_accounts`: active, not excluded from reports, `holdsSecurities(type)` (investment and crypto, PEA and every tax-advantaged one included), in the reporting currency; another currency is left out and named, as `reportedAccounts` does (AD-6). Value is the sum of those accounts' balances today (`balanceOn`, cash included). Holdings are `currentHoldings` of each account today: rolled up by security across accounts, each row kept only if its amount is above zero, ranked by value, five kept; weight = value ÷ max(portfolio value, holdings total), as `weight_denominator`. A holding's « Rendement » is its rows' combined gain over the book value's size, rows without a cost basis left out, « - » when none has one. « Rendement total » is the gain of every current holding with a cost basis (any sign), shown only when one exists, Sure's `Trend` colour (up green, down red, flat grey) and percent rounded to one decimal, « ＋∞ » / « -∞ » on a zero book value. « Activité » covers the dashboard period (`resolveChartRange`): « Apports » sums the amounts of buys (quantity above zero, fee included), « Retraits » of sales, « Transactions boursières » counts every trade row, dividends and interest included, as `InvestmentStatement::Totals`; the block shows only when one of the three is above zero; its label is Sure's `period.<key>.label`, « Période personnalisée » for a custom range. All amounts are integer minor units; percents are decimal strings as `PositionData`. Every string goes through `locales/fr.json` and `en.json`, Sure's `pages/{fr,en}.yml` text.

**Never:** no change to positions, holdings or trade services; no exchange rates; no new dependency; no logo (Archant stores none); no write control; no rearranging (Story 34.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No investment account | checking accounts only | no widget, as `investment_summary_available?` | an inactive or excluded PEA counts as none |
| Account never traded | PEA with cash only | title and value; no return, no table, no activity | N/A |
| Same security in two PEAs | 3 000 € and 2 000 € | one row of 5 000 €, gains combined | a row at or below zero dropped before the sum |
| Six securities | values 6 to 1 | five rows, largest first | N/A |
| Cash below zero | holdings 1 000 €, balance 900 € | weight over 1 000 € | N/A |
| Activity | buy 1 000 € + 5 € fee, sale 400 €, dividend 12 €, cash deposit 2 000 € in the period | Apports 1 005 €, Retraits 400 €, Transactions boursières 3 | deposit counted nowhere; trades outside the period ignored |
| No cost basis | every holding without one | no « Rendement total », each « Rendement » « - » | N/A |
| Another currency | USD brokerage account | left out of every figure, named in `LeftOutNotice` | N/A |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/holdings/portfolio.ts` (new) -- pure: `rollUp(rows)`, `topHoldings(rows, portfolioValue, limit)`, `returnOf(rows)` → `{ gain, percent }` with Sure's infinite case. Reuse `positionFigures`, `weightOf`, `percentOf` logic from `domain/holdings/positions.ts` (export what is needed, never copy).
- `packages/api/src/services/ledger/queries.ts` -- add `tradeTotals(deps, { accountIds, from, to })`: one Drizzle aggregate over `trades` ⋈ `entries` (`quantityAboveZero` / `quantityNotAboveZero` from `ledger/shared.ts`), BigInt-safe sums.
- `packages/api/src/services/reports.ts` -- `getInvestmentSummary`: `reportedAccounts` filtered by `holdsSecurities`; `available: false` when none, so the interface hides the widget; else `{ available, period, from, to, currency, value, totalReturn | null, holdings[], activity: { contributions, withdrawals, trades }, leftOut }`. Each holding: `security { id, name, ticker }`, `amount`, `weight`, `returnPercent | null`.
- `packages/api/src/routes/reports.ts` -- `GET /investment-summary` with `balanceQuerySchema`, as `/cash-flow`.
- `packages/app/src/hooks/useInvestmentSummary.ts` (new) -- key `queryKeys.accounts.investmentSummary(period)` under `accounts.all`, so trade, price and account writes refresh it; `keepPreviousData`.
- `packages/app/src/components/InvestmentSummarySection.tsx` (new) -- Sure's layout under Archant's style: `Money`, `ui/table` with « Holding », « Poids », « Valeur », « Rendement » (ticker, name truncated to 20, two-letter badge), activity block with `TrendingUp`, `TrendingDown`, `ArrowLeftRight`; Trend colours as `NetWorthSection`'s (`#27a644` / `#eb5757`). `inert` on placeholder data, as `CashFlowSankeySection`.
- `packages/app/src/routes/_authed.index.tsx` -- widget after `OutflowsDonut`, before `NetWorthSection`, Sure's builder order.
- `packages/app/src/locales/{fr,en}.json` -- `dashboard.investmentSummary.*`; `periods.<key>.label` and `periods.custom.label` from Sure's `config/locales/models/period/{fr,en}.yml`.
- `packages/app/e2e/dashboard.spec.ts` -- new tests; `fixtures.ts` `openAccount({ kind: "pea" })`, `recordTrade` reused.
- `docs/sure-parity.md` « Dashboard and reports » -- add an « Investment summary » row at Parity, naming the left-out currencies and the missing logo.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/holdings/portfolio.spec.ts` then `portfolio.ts` -- failing tests first: roll-up across accounts, a negative row dropped, five-holding cut, weight denominator with negative cash, combined return, no cost basis, infinite percent, flat colour key.
- [x] `packages/api/src/services/reports.spec.ts`, `routes/reports.spec.ts` -- totals over a period with a buy (fee included), a sale, a dividend and a cash contribution left out; trade outside the period; excluded, inactive and USD accounts; no investment account → `available: false`; custom range.
- [x] Ledger query, service and route as in the Code Map.
- [x] Hook, widget, route and locales as in the Code Map.
- [x] `packages/app/e2e/dashboard.spec.ts` -- a PEA with one unique security of 1 000 000 € bought in a past month used by this test alone, then sold in part, plus a dividend: with that month as custom range, « Activité Période personnalisée », Apports, Retraits, « Transactions boursières » 3; its row reads Valeur and Rendement; portfolio value and weight equal what `GET /api/reports/investment-summary` answers (shared database). The layout test lists « Investissements » after « Sorties ».
- [x] `docs/sure-parity.md`.

**Acceptance Criteria:**
- Given a household with a PEA, when the dashboard renders, then « Investissements » sits between « Sorties » and « Patrimoine net » and shows « Rendement total ».
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- Decision, Sure settles it: « Apports » are buys and « Retraits » sales (`Totals#aggregation_sql`), not cash deposits; the story's « a contribution » in tests is a cash deposit that counts nowhere.
- Decision, AD-6: Sure converts every currency; Archant leaves other currencies out and names them, as the other dashboard totals.
- Assumption: the widget follows the dashboard period picker; Sure passes `@period`.
- `positions.ts` gives `bookFigures` and exports `percentOf`, so `portfolio.ts` reuses them; `positionFigures` answers as before.
- `reportedAccounts` takes an optional `kept` predicate rather than a second account read.
- A percent is a decimal string, or `"Infinity"` / `"-Infinity"`, which `Number` reads back; a percent past a safe integer of millionths reads as infinite too.
- A security without a ticker, every one typed by hand, shows its name alone and « — » in the badge; Sure's securities always have one.
- A household whose only investment account is in another currency sees the widget, so the account is named.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `sprint-status.yaml` and the spec disagree | false | reject | Step 5 moves both to `done`; in-progress then in-review is the workflow's own order. |
| 2 | An error card shows for a household without a PEA | low | reject | Only when `/investment-summary` fails, where the other widgets fail too; hiding it would also hide the error from a household with a PEA. |
| 3 | A holding's colour re-derived from its percent, `totalReturn` from `trend` | low | patch | Two sources of truth for one Sure `Trend#color`; `returnTrend` now comes from the server. |
| 4 | A tiny gain shows « 0,0 % » in green | false | reject | Sure's colour reads `direction`, not the rounded percent: the same. |
| 5 | « -∞ » with an ASCII hyphen beside « −2,5 % » | low | reject | Patched, then reverted on the two-axis review: the frozen intent and Sure's `Trend#percent_formatted` both write « -∞ ». |
| 6 | Infinity when a percent overflows a safe integer | low | reject | Past nine billion percent; documented in `PortfolioReturn`. |
| 7 | No-ticker fallback undocumented in the parity row | low | patch | Every manual security has no ticker. |
| 8 | Parity cell ends without a full stop; « -∞ » not named | low | patch | `docs/sure-parity.md` « Cash flow » row. |
| 9 | « Rendement total » checked by its label alone | medium | patch | Gain, percent or colour could regress with CI green. |
| 10 | Three accessible names read « Investissements » | low | reject | Section, headline group and table; Sure names none, and `NetWorthSection` names its headline the same way. |
| 11 | A `null` weight shows « 0,0 % » | false | reject | `topHoldings` returns nothing unless the holdings' total is above zero, so the denominator is too. |
| 12 | `truncated` splits a surrogate pair | low | patch | Sure's `truncate` counts characters; slice code points. |
| 13 | « Cash below zero » tested in the domain only | low | reject | `portfolio.spec.ts` covers the row; the service passes the summed `balanceOn`, read in the diff. |
| 14 | An empty ticker renders an empty line | false | reject | `schemas/trades.ts` trims and requires one character; a missing ticker is `null`. |
| 15 | e2e compares against 0 % when the holding is missing | low | patch | `holding?.weight ?? "0"`; now asserted defined. |
| 16 | e2e value and weight race parallel writes | medium | patch | Shared database; comparisons retried with a reload and a fresh API read. |
| 17 | e2e posts trades with id `""` when the list is empty | low | reject | The next `recordTrade` fails loudly; the 2022 test uses the same pattern. |
| 18 | `investmentSummary` comment claims every price write invalidates `all` | low | patch | `useUpdatePrices` and the cost-basis hooks do not; the comment now says it refreshes once stale, as `netWorth`. |
| 19 | « Holding » left in English in `fr.json` | false | reject | Sure's `pages/fr.yml` says « Holding »; Sure's French is the reference where it has a key. |
| 20 | The percent union of `portfolio.ts` written again in `reports.ts` | low | patch | `percentText` now reads `PortfolioReturn["percent"]`. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean.
- `pnpm test` -- expected: green, the new domain, service and route specs included.
- `pnpm test:e2e` -- expected: green.

**Manual checks:**
- Screenshot the widget in French and English at 1440 px and 1600 px, with and without a cost basis.
