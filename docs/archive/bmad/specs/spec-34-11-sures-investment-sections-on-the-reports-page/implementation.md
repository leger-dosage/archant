# Implementation and verification

## Status and evidence

Implemented, 2026-11-06, baseline `9d00a40e45b378353246eeb4b46a0d2c334e6b94`. The owner chose policy A and approved implementation through /apply. Implementation and reviews are complete. Focused checks and review corrections pass; the final repository gate runs before pull request publication. No Linear or GitHub issue is identified by the story.

The source is Story 34.11 in `../../planning-artifacts/epics.md`, lines 550-574. `../../implementation-artifacts/epic-34-context.md` establishes the prerequisite and reference revision. All source acceptance behaviors are retained below. The wrapper content dropped from the source is only “Requirements: none new” and Given/When/Then ceremony.

Baseline findings at the recorded revision, before this implementation:

- `packages/api/src/services/reports-page.ts#getReportsPage` supplies `/api/reports/page` to both screen and print, with no investment data.
- `packages/api/src/services/reports.ts#getInvestmentSummary` already provides current account value, total unrealized return, five rolled-up holdings and period trade totals. Its account filter includes active investment/crypto accounts included in reports, with other currencies named and left out.
- `packages/api/src/services/ledger/queries.ts#tradeTotals` counts purchases including fees as contributions and sales net of fees as withdrawals. Cash deposits do not count. Do not reuse this for labeled cash flows.
- `packages/data/schema/balances.ts` stores balance and cash, not `net_market_flows`. `domain/holdings/forward.ts#forwardHoldings` already stores each day’s position value and calculated cost basis.
- `packages/data/reports-sections.ts` contains three section keys; `reports-layout.ts#resolveReportsLayout` appends missing keys in base order. `users.reports_layout` already stores arbitrary keys. No schema migration is needed.
- `packages/data/account-types.ts#isTaxAdvantaged` is Boolean, insufficient for four separate tax groups.
- `packages/app/e2e/reports-layout.spec.ts` mutates layout after the chromium project and restores defaults. New layout assertions must stay there.

Sure evidence, read using `git -C /Users/guillaume/github/sure show 00dd977fb:<path>`, not the checkout HEAD:

- `app/controllers/reports_controller.rb#build_investment_metrics`, `#build_gains_by_tax_treatment`, `#build_reports_sections`.
- `app/models/investment_statement.rb#period_return_trend`, `#top_holdings`, `#unrealized_gains_trend`.
- `app/models/balance/base_calculator.rb#market_value_change_on_date` and `#flows_for_date`.
- `app/models/trade.rb#basis_holding`, `#calculate_realized_gain_loss`; `app/models/holding.rb#avg_cost`, `#calculate_avg_cost`.
- `app/models/investment_flow_statement.rb#period_totals`; `app/models/investment.rb#SUBTYPES`.
- `app/views/reports/_investment_performance.html.erb`, `_investment_flows.html.erb`, `print.html.erb`; `app/models/user.rb#default_reports_section_order`; the corresponding French and English reports locale files must be read during implementation before copying visible labels.

## Approved historical-basis policy

The owner chose **A, strict Sure parity**, in chat. Use the latest holding snapshot dated on or before the disposal day, including a zero-quantity snapshot. A positive stored cost basis is used directly; zero is used directly only when manually locked. Otherwise average every positive purchase through the selected snapshot day, including the entire day and purchases from closed positions. Ignore sales and purchase fees in this fallback. Do not reconstruct the average immediately before the disposal.

A later same-day purchase or a prior closed position can affect the gain. These are accepted Sure semantics and require regression fixtures, not a pre-sale tracker extraction. No basis snapshot, or no purchases for the fallback, leaves the gain unknown. An exact zero derived from free purchases is known. Use an exact rational average until the final currency rounding, avoiding early rounding of the fallback to millionths.

Archant stores no activity label on trades. Sure’s internal-movement exclusion cannot apply to nonexistent labels here; no new field or transfer feature is part of this story. Available historical manual locks apply only to their recorded date/position interval, never backward before locked_on. Overwritten locks cannot be reconstructed.

## Financial contract

### Current investment figures, CAP-1

Reuse the selection and arithmetic of getInvestmentSummary with explicit `{from,to}` report bounds, not a dashboard period key. Factor a shared service read rather than create a second implementation. Current portfolio value includes cash. Current total return includes only positions with a known basis. Top holdings roll up positive position rows by security and keep five, weighed against max of portfolio value and positive holdings total. Preserve decimal percentages, infinite cases and trend colors. Return account id, name, subtype and current balance for the linked account cards.

Keep `leftOut` named-currency notices for every aggregate. An eligible foreign-only investment household must see why its figures are excluded, not silently disappear. Do not feed report investment accounts through cashFlowAccounts, which excludes tax-advantaged ones.

### Period return, CAP-1

Derive Sure’s sum of market flows without changing persisted balances. With holdings value H and signed Archant trade cash amounts E for nonzero-quantity trades, use:

`gain = H(to) - H(from - 1 day) + sum(E in [from,to])`

Sure subtracts net buy/sell non-cash flows, which is the same identity after translating its entry signs to AD-5. Fees remain inside E, as Sure’s entry-based flow calculation does. Dividend and interest trades have quantity zero and never enter this sum. Cash funding and valuation adjustments do not enter it either.

Starting capital is the sum of each eligible account’s latest balance strictly before `from`, not its first balance within the period. Missing prior rows contribute zero. A zero total starting capital yields an unavailable period return, as Sure. Otherwise return gain and gain divided by the absolute starting capital as a decimal percentage with the existing Trend semantics.

Use actual holdings on the boundary date, including zero snapshots after full sale; never `lastHeldHoldings`, which resurrects sold-out rows. Do not fabricate dates beyond each account’s materialized range. For a future report, clamp reads to the materialized last date and use unchanged carry-forward values for an empty future interval. No scan of every daily holding is required because the market-flow sum telescopes to two boundary reads plus a trade aggregate.

### Realized gains and tax groups, CAP-1 / CAP-2

Realized gain is gross sale value `abs(quantity) * trade price` less the known cost basis for that quantity. Sale fees are not subtracted again, matching Trade#calculate_realized_gain_loss. Purchase fees enter Archant’s stored calculated basis, but the approved historical-purchases fallback excludes them. Use `domain/trades.ts#tradeValue`, `#marketValue` and decimal/BigInt helpers. Apply the stored-zero versus fallback-zero distinction above. Sales outside the period and income trades never contribute.

Apply approved policy A above. Do not extract or change the forward holdings tracker. Honor only available historical lock intervals. Test partial and full sales, same-day buy/sell, a fully sold and rebought position, unknown basis, locked zero, free purchases, both fee paths and lock boundaries.

Group current unrealized gains plus period realized gains in Sure order taxable, tax_deferred, tax_exempt, tax_advantaged. Show a group when it has holdings or sales, even when gain is zero. Unknown individual gains display no-data and add zero to group sums. Include total gain, unrealized and realized subtotals, counts, expandable first five holding/sale details with remaining counts and Sure’s positive-taxable-gain note. Those details use the same amounts as group totals.

Add a pure account-treatment helper in `packages/data/account-types.ts`, reusing it from isTaxAdvantaged to prevent contradictory classifications. Crypto reads its stored taxTreatment, default taxable. Investment pea/assurance_vie map to tax_advantaged; pillar_3a/riester/pension/retirement to tax_deferred; brokerage/other/null to taxable. Do not extend the crypto form’s three-item TAX_TREATMENTS just to add the investment-only fourth group.

### Cash funding, CAP-3

Add a dedicated aggregate in ledger/queries.ts over transactions joined to entries and transfers. Eligibility matches Sure’s visible, booked transactions, not excluded, not split parents, not one_time; no transfer or investment_contribution only. Other transfer kinds do not count. Account inclusion follows the included active accounts in reporting currency, including tax-advantaged accounts, not only investment accounts, because rules can label a checking transaction too. Filter by Contribution or Withdrawal label and inclusive period bounds. For each label take the absolute value of its signed sum, not the sum of absolute values. Net flow is contributions minus withdrawals. Omit pending rows and retain named foreign exclusions.

Flux d’investissement is visible only when an eligible investment account exists and at least one of the two funding totals is positive. Buying or selling securities alone must not enable it.

## Integration, CAP-4 / CAP-5

Extend the existing ReportsPage response with `investments` and `investmentFlows`. Keep GET /api/reports/page and useReportsPage; no extra endpoint or independent period state. Existing route tests check authentication and viewer reads. No service/provider writes occur during a read.

Add keys to REPORTS_SECTIONS in Sure base order net_worth, trends_insights, investment_performance, investment_flows, transactions_breakdown. Preserve DEFAULT_REPORTS_ORDER as trends_insights then transactions_breakdown; resolveReportsLayout appends the others. Default visible order is trends, breakdown, net worth, investment performance, investment flows. Extend resolved collapse defaults and tests. Preserve stored keys even when a section is temporarily invisible. Administrators retain reorder/collapse controls; viewers get the existing default read-only layout and never mount administrator preference reads.

Add `InvestmentPerformance.tsx` and `InvestmentFlows.tsx` under `packages/app/src/components/reports/`, using ReportsSection, Money, existing tables, badges, disclosure, return formatting and account links. Use Archant’s style and Sure’s layout. Long names and tables must work on narrow screens. Every visible string goes through locales/fr.json and en.json. Use report-specific labels rather than reusing the dashboard’s “Apports” indiscriminately.

Extend ReportPrint.tsx with Sure’s fixed Investissements block, after trends and before spending. It includes portfolio value, available total/period returns, period trade contributions/withdrawals and the five top holdings. Preserve Sure’s portfolio sparkline from cumulative report trend values when available, one-decimal percentages, 25-character names and existing print styles. Sure does not print the cash-flow cards or tax/account details; do not add them. Screen collapse/order never suppresses printed investments.

## Tasks and acceptance coverage

1. [x] Add failing numeric fixtures to `domain/holdings/portfolio.spec.ts`, `services/reports-page.spec.ts`, `services/ledger/queries.spec.ts` and account-types.spec.ts for CAP-1/2/3. Assert policy A full-sale, same-day and rebuy outcomes explicitly.
2. [x] Implement indexed boundary and aggregate reads in `services/ledger/holdings.ts`, `ledger/balances.ts` and `ledger/queries.ts` as appropriate. Keep database access behind ledger readers. Read all disposals with their bases in batches, not one query per sale. Use a focused pure fallback calculator, leaving forwardHoldings unchanged. Assemble shared current figures and period figures in a focused `services/report-investments.ts` consumed by getReportsPage and the shared dashboard reader where needed.
3. [x] Extend `services/reports-page.ts` and `routes/reports.spec.ts` with the response and CAP-1/2/3 integration fixtures. A household with cash-only investment accounts sees empty holdings and explicit unavailable returns. Inactive, excluded and foreign accounts never leak into counted totals.
4. [x] Add layout regression cases in `packages/data/reports-layout.spec.ts`, then extend reports-sections.ts and reports-layout.ts. Check `schemas/reports.ts` derives the accepted keys and route/service preference tests accept both new keys. Cover old stored orders, hidden section reappearance and both collapse flags for CAP-4.
5. [x] Build both report components and integrate `_authed.reports.tsx` with conditional visibility. Extend ReportPrint.tsx, its styles only if needed, and both locale files for CAP-1/3/4/5.
6. [x] Extend `packages/app/e2e/reports.spec.ts` with seeded purchase, partial sale, a typed price and labeled cash Contribution/Withdrawal. Use a unique account/security and isolated past custom period. Assert numeric period/realized gain, both section headings, a changed period and matching print metrics. Stub window.print as existing tests do. Compare scoped fixtures or freshly fetched totals to avoid shared-database races.
7. [x] Extend `packages/app/e2e/reports-layout.spec.ts` for both new keys and persistence, with seeded eligible accounts and flows. Restore layout afterward; update three-section assumptions. Verify the viewer reads values without preference writes and that hidden sections retain saved settings. Cover CAP-4 without moving these tests into chromium.
8. [x] Extend `services/history-volume.spec.ts` with report investment boundary/sales reads and query-plan assertions on its existing 100,000-entry fixture; avoid per-sale queries and full daily-history materialization. Run the volume project separately without coverage.
9. [x] Update the investment sections portion of `docs/sure-parity.md`, retaining the existing 34.7 claims and recording basis-policy and currency differences. Update `docs/architecture.md` AD-22 if extracting shared basis arithmetic changes its contract; no speculative new architecture decision or schema migration. Finish the story/sprint status through bmad-build only after implementation and review, not in this planning run.

Source acceptance mapping: performance fields and tax/account details → CAP-1/2, tasks 1-3/5/6; labeled cash flows → CAP-3, tasks 1-3/5/6; ordering/collapse/print → CAP-4/5, tasks 4-7; Vitest period return/realized gain and Playwright seeded trade → tasks 1/3/6. Each task supports these behaviors, their existing performance contract or required parity documentation.

## Verification commands

During implementation run focused Vitest files first, then `pnpm --filter @archant/api exec vitest run --project volume`. The required final gate is `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm lint:code`, `pnpm lint:format`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e` in that order. Do not modify tracked files after it. Browser automation is Playwright; no device or production access is required. End-to-end servers must stop when tests finish.

The owner approved this plan through /apply. Implementation now includes the five capabilities and focused tests, with passing results recorded in the build specification. Both coherence and preservation passes remain satisfied; no financial-policy question remains. Before/after visual comparison is unavailable because only treatment captures were taken. Browser assertions verify current behavior.

## Implementation verification record

Shared readInvestmentFigures preserves the dashboard contract. report-investments.ts combines indexed boundary reads, grouped historical sales and labeled cash funding. historical-basis.ts rounds the exact realized difference once to the currency minor unit. The report, print, layout, role and locale integrations are implemented. Final gate results and review triage belong to the build specification under ../../implementation-artifacts/.
