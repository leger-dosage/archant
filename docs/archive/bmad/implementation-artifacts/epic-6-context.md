# Epic 6 Context: Dashboard

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The dashboard at `/` becomes the home page: the user sees their net worth (assets minus liabilities) with its daily history over a chosen period, and the chosen month's income and expenses broken down by category, with a drill-down into the matching transactions. It is the payoff of Epics 1 to 5: balances, classification and transfer matching now feed numbers the household reads each month, so the dashboard must reuse their rules rather than restate them. Net worth stays partial until Epic 7 adds loans, investments and physical assets.

## Stories

- Story 6.1: Net worth and its history
- Story 6.2: Monthly income and expenses by category

## Requirements & Constraints

- Net worth is the sum of asset balances minus the sum of liability balances, over active accounts not excluded from reports. Both totals are shown alongside it, and they come from the daily balances.
- History periods: 1 month, 3 months, 6 months, 1 year, all. The chart shows daily net worth over the period, with the change in amount and in percentage.
- Totals are in one reporting currency (EUR by default). An account in any other currency is left out of totals, and a visible notice names it. No code path assumes EUR.
- Cash flow for a month: income and expense totals leave out excluded transactions, pending ones, internal moves, credit card payments, and accounts excluded from reports. The outflow side of a loan payment or investment contribution counts as an expense (Epic 7 produces those).
- Breakdown: each category shows its total and its share, sub-categories rolled up into their parent. Uncategorised transactions get their own line.
- Clicking a category line opens the transactions page filtered on that category and that month.
- Money is integer minor units plus a currency, never a float. Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- The dashboard lives in `services/reports.ts` with `domain/cash-flow.ts`. Routes call one service function each; only services touch the database; no raw SQL.
- Balances: every reader goes through `balanceOn(accountId, date)`, which returns the last `balances` row on or before the date. Net worth history must carry balances forward this way for each day, never read `WHERE date = day`, since accounts' last rows have different dates.
- Sign convention: stored balances are the asset's value and the amount owed on a liability (positive), so net worth is `sum(assets) - sum(liabilities)`. Classification comes from `ACCOUNT_TYPES` in `@archant/data/account-types`.
- Reporting currency comes from `settings.reporting_currency` (default `EUR`), read through one helper; totals skip and report accounts in other currencies. No exchange rates exist.
- Cash flow uses only `countsInCashFlow(tx)` and `direction(tx)` from `domain/cash-flow.ts`, through the one query builder in `services/reports.ts` that the transaction list's direction filter already uses. Direction comes from the amount's sign, not from the category's kind; a category total is the signed sum of its counted transactions, and the category kind only groups the display. This keeps the dashboard and the drill-down list in agreement (a refund in Courses reduces Courses in both).
- "Today" and month boundaries are `YYYY-MM-DD` strings computed in `APP_TIMEZONE` (default `Europe/Paris`); date arithmetic uses small helpers in `domain/`, no date library.
- API: `{ data }` / `{ error }` envelope, chained mounts in `app.ts`, request schemas in `packages/api/src/schemas/`, closed `AppError` union. Interface calls through `hc<AppType>()` and TanStack Query with keys from the `queryKeys` object; the period and month choices belong in URL search params validated by TanStack Router.
- Charts use recharts through shadcn `Chart`. `formatMoney` / `<Money>` render every amount.

## UX & Interaction Patterns

- Route `/`, sidebar entry « Tableau de bord », shortcut `g d`. Until this epic ships `/` redirects to `/comptes`; Story 6.1 replaces that redirect and adds the navigation entry.
- Net worth block (mockup): a bordered card under the page heading « Tableau de bord ». Top-left is the stat block: muted label « Patrimoine net », the value in `amount-hero` (30px, 600, tabular figures, never coloured), then the change in caption size, e.g. « +2,1 % sur 3 mois ». The change is coloured only by its sign, green when positive, and must read without colour. Top-right is the period segmented control « 1 M, 3 M, 6 M, 1 A, Tout » (mockup shows 3 M active). Below: a muted text summary « Patrimoine net : 84 230 €, +2,1 % sur 3 mois. », then the chart.
- The stat block spec also asks for the change in amount; the mockup only shows the percentage. The assets and liabilities totals required by Story 6.1 do not appear in the mockup's card. The spine wins over the mockup.
- Net worth chart: one line in `chart-1` indigo, no fill gradient, no grid except a faint baseline, about 200px tall. Hover or arrow keys move a cursor showing date and amount; a « Voir les données » toggle shows the same series as a table; `prefers-reduced-motion` removes animation.
- Other currency: a notice under net worth names the account left out of totals. No empty state is specific to the dashboard beyond « Aucun compte pour l'instant. » with one button « Ajouter un compte » when no account exists. Loading uses skeletons matching the layout, never a spinner over content.
- Flows block (mockup): a second bordered card titled « Ce mois-ci », with « Revenus » (green, plus sign) and « Dépenses » (foreground, true minus) totals, then category rows sorted by amount: colour dot, name, horizontal bar scaled to the largest category, amount right-aligned. Categories use their own colour. The share and the « Sans catégorie » line required by Story 6.2 are not drawn in the mockup; « Sans catégorie » uses the dashed outline dot. How the month is picked is not specified anywhere.
- Every visible string goes through `locales/fr.json`. Amounts never rely on colour alone. Every action is keyboard-reachable with visible focus.

## Cross-Story Dependencies

- Story 6.1 owns the dashboard route, the navigation entry, the reporting-currency helper and the net worth history. Story 6.2 adds the flows block to the same page and reuses the currency helper.
- Builds on Epic 1's daily `balances`, `balanceOn` and account exclusion, Epic 4's categories, colours and transaction filters (the drill-down reuses the category and period filters in the URL), and Epic 5's `domain/cash-flow.ts` and `services/reports.ts` query builder.
- Epic 7's loan, investment and physical asset accounts feed net worth and loan or investment payments feed expenses without changes to this epic's code.
