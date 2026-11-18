---
id: SPEC-34-11
companions:
  - implementation.md
sources:
  - ../../planning-artifacts/epics.md
---

# Story 34.11: Sure's investment sections on the reports page

## Why

Household members cannot review investment performance or cash funding on Reports. Story 34.7 supplies periods, layout preferences and printing; this story completes its investment sections against Sure revision `00dd977fb`.

## Capabilities

- **CAP-1**
  - **intent:** Review current investments alongside their performance over the selected report period.
  - **success:** An active, included investment or crypto account enables Performance des investissements with portfolio value, total and period returns, period trade contributions/withdrawals, five top holdings, gains by tax treatment with details, and investment account links.
- **CAP-2**
  - **intent:** Understand realized gains from sales in the report period.
  - **success:** Known-basis sales contribute their gains to the correct tax treatment; unknown gains remain unavailable individually and contribute zero to the group sum, as Sure. Use Sure’s historical snapshot and purchase-average fallback, explicitly chosen by the owner.
- **CAP-3**
  - **intent:** Distinguish investment cash funding from securities trading.
  - **success:** Eligible Contribution and Withdrawal transactions produce Contributions, Retraits and Flux net. Flux d’investissement appears only with investment accounts and a positive contribution or withdrawal total.
- **CAP-4**
  - **intent:** Arrange the two investment sections with the existing report sections.
  - **success:** investment_performance and investment_flows retain order and collapse state after reload; existing saved layouts keep their order; viewers read the sections without writing preferences.
- **CAP-5**
  - **intent:** Keep a printable investment report for the selected period.
  - **success:** Imprimer le rapport shows Sure’s Investissements metrics and top holdings in the existing print layout, regardless of screen collapse/order.

## Constraints

- Follow Sure `00dd977fb`, including policy A chosen by the owner for realized gains. Exact semantics and evidence are in implementation.md.
- Current value and unrealized gains refer to today; market return, realized gains and flows refer to the report period.
- Money uses integer MinorUnits with currency and BigInt intermediate arithmetic; percentages use decimal strings and explicit unknown values.
- Retain AD-6 currency exclusions and named notices, AD-21 roles, no network in tests, bilingual strings and existing styles.
- Reuse ledger reads, portfolio arithmetic, report periods and layout storage. No new dependency or database migration.

## Non-goals

- Exchange-rate conversion, tax liability calculation, trade editing, dashboard changes, new export columns or additional print sections absent from Sure.
- Reconstructing overwritten manual cost-basis locks or adding an audit history.

## Success signal

Vitest verifies period market return and realized gains with numeric fixtures. Playwright reads both sections over seeded trades and labeled cash funding, persists layout and opens the matching printed investments. The full repository verification gate passes.

## Assumptions

- Supported generic pension and retirement accounts use tax_deferred; detailed mappings are in implementation.md.
