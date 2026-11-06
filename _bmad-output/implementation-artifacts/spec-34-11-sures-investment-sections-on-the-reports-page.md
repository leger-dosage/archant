---
title: "Story 34.11: Sure's investment sections on the reports page"
type: feature
created: '2026-11-06'
status: done
baseline_commit: '9d00a40e45b378353246eeb4b46a0d2c334e6b94'
route: dispatch
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-34-11-sures-investment-sections-on-the-reports-page/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-34-11-sures-investment-sections-on-the-reports-page/implementation.md'
---

<frozen-after-approval reason="human-owned intent, change only after renegotiation">

## Intent

**Problem:** Reports lacks Sure’s investment performance, cash funding and printed investments. Household members cannot review these beside their financial report.

**Approach:** Extend the existing report read, sortable sections and print layout. Follow Sure `00dd977fb` and reuse the dashboard’s current investment arithmetic.

**Owner decision:** A, strict Sure historical-basis parity. Read the latest holding snapshot on or before each sale day. Use positive stored basis or manually locked zero; otherwise average every positive purchase through that snapshot day, ignoring sales and purchase fees. Closed positions and later same-day purchases remain included. Never substitute a pre-sale tracker. No snapshot or no purchase leaves the gain unknown; a free-purchase average of zero is known.

## Boundaries & Constraints

**Always:** Performance includes today’s portfolio value and unrealized return, period market return, period purchases/sales, five rolled-up top holdings, gains by tax treatment with Sure’s disclosures and linked investment account cards. Realized proceeds are gross, without deducting sale fees. Snapshot basis includes purchase fees; fallback basis excludes them. Only available historical manual-lock intervals apply.

Period market gain equals holdings value at period end minus holdings value before period start plus signed cash amounts of nonzero-quantity trades. Its denominator is the total balance strictly before period start; a zero denominator makes return unavailable. Cash funding and dividends never become market gain.

Cash flows separately aggregate labeled Contribution/Withdrawal transactions over inclusive period bounds, using the absolute signed sum for each label. Include booked, visible, non-one-time rows with no transfer or an investment_contribution transfer. Hide Flux d’investissement without investments or positive funding totals.

Preserve reporting-currency exclusions with named notices, administrator-only layout writes, viewer reads, French/English strings and integer currency amounts. Use BigInt intermediates; keep fallback averages exact until final minor-unit rounding. Store investment_performance and investment_flows in existing layout preferences. Print Sure’s fixed Investissements metrics and top holdings, independent of screen order/collapse.

**Never:** No migration, dependency, provider request, exchange conversion, trade editing, dashboard behavior change, tax calculation, new export columns or invented trade activity-label field. Do not print tax/account details or cash-flow cards absent from Sure.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| No investments | Checking only | Both sections absent | None |
| Cash only | Included investment account, no trades | Value, unavailable returns, no holdings | None |
| Full sale/rebuy | Snapshot basis cleared | Historical purchase fallback, including closed positions | Unknown without snapshot/purchases |
| Same day | Sale then later purchase | End-of-day snapshot/fallback, not pre-sale average | None |
| Two flow types | Purchase plus cash contribution | Purchase in performance; labeled cash in flows | None |
| Old preferences | Three saved section keys | Keep saved order, append new keys in Sure base order | Unknown keys ignored |
| Viewer | Read and attempted layout write | Read default sections; write refused | 403 FORBIDDEN |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/reports.ts#getInvestmentSummary` supplies current figures; factor shared explicit-range reads without changing the dashboard response.
- `packages/api/src/services/report-investments.ts` assembles report investment metrics for `reports-page.ts#getReportsPage` and its existing route/hook.
- `packages/api/src/services/ledger/{holdings,balances,queries}.ts` owns indexed boundary, sale-basis and funding reads. Never use lastHeldHoldings for current/boundary values because it revives sold-out positions.
- `packages/api/src/domain/holdings/portfolio.ts` supplies return/roll-up arithmetic. Add co-located pure fallback arithmetic without changing forwardHoldings.
- `packages/data/account-types.ts` adds four-group tax classification without expanding crypto’s three-choice form; mappings and detailed predicates are in implementation.md.
- `packages/data/reports-{sections,layout}.ts` owns keys, default order and collapse merging; no storage migration.
- `packages/app/src/components/reports/{InvestmentPerformance,InvestmentFlows,ReportPrint}.tsx`, `_authed.reports.tsx` and `locales/{fr,en}.json` implement the presentation.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/reports-page.spec.ts`, `services/ledger/queries.spec.ts`, `domain/holdings/portfolio.spec.ts`, `packages/data/account-types.spec.ts` first add failing numeric fixtures, including every financial matrix case and both fee paths.
- [x] Ledger readers and `services/report-investments.ts` add batched indexed calculations; share current figures with reports.ts without copying the dashboard algorithm.
- [x] `services/reports-page.ts` and `routes/reports.spec.ts` add the response and authenticated administrator/viewer integration coverage.
- [x] `packages/data/reports-layout.spec.ts` then layout modules add both keys, stale-order and hidden/reappearing-section cases; verify schemas accept them.
- [x] App route, new report components, print and locales add all fields with existing Money, tables, disclosure, return formatting and account links.
- [x] `packages/app/e2e/reports.spec.ts` seeds a trade, partial sale, price and labeled cash funding; checks numeric values, period changes and printed investments.
- [x] `packages/app/e2e/reports-layout.spec.ts` verifies both sections’ order/collapse persistence and restores defaults. Keep layout writes out of chromium tests.
- [x] `packages/api/src/services/history-volume.spec.ts` verifies report investment reads over its existing large fixture with query plans, without per-sale queries or daily-history materialization.
- [x] `docs/sure-parity.md` records completed investment sections and admitted currency/model limitations. Complete this story and sprint tracking only after implementation, verification and review.

**Acceptance Criteria:**
- Given active included investments, when Reports renders, then all performance fields and tax/account details follow Sure and policy A.
- Given eligible cash funding, when its period renders, then both investment sections show their distinct figures.
- Given reordered or collapsed sections, when reloaded or printed, then saved screen preferences persist and the independent print block remains complete.
- Given the finished story, when pnpm test and pnpm test:e2e run, then numeric period-return/realized-gain tests and the seeded browser journey pass.

## Implementation Notes

- Shared current figures live in readInvestmentFigures; the dashboard response and its period selection remain unchanged.
- Historical sale basis follows approved policy A. Exact gain subtraction precedes one minor-unit rounding; zero- and three-decimal currencies are covered.
- Period availability reads actual boundary position presence, so later liquidation cannot suppress a historical return. Funding reads all eligible accounts, including labeled checking-account transactions.
- The screen and fixed print block share the report response, and print names excluded foreign accounts. Return percentage formatting is shared with the dashboard in lib/trade-format.ts.
- All accepted review findings are patched. Findings rejected as negligible or already covered are recorded below; no unresolved functional finding remains. The independent Spec axis reports no deviation. The Standards axis's documentation and duplication findings are patched.
- Focused numeric, route, data, volume and browser tests passed. The final repository gate runs after artifact finalization, before the first commit and publication.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|-------|---------|---------|----------|-------|
| 1 | blind | Historical return hidden after later liquidation | medium | periodReturn tests current positions instead of boundary holdings; an older no-trade price-change period loses its return | patch |
| 2 | blind | Print omits named foreign exclusions | medium | ReportPrintInvestments does not render investments.leftOut, so an excluded-only portfolio prints zero without its notice | patch |
| 3 | blind | Full fiscal details exceed the five rendered rows | low | Response contains all rows; the household-volume service passes its bound and no measured response regression exists; splitting counts/details adds contract complexity | reject |
| 4 | blind | Per-sale linear lookup of locks | low | historical.locks.find runs for each disposal; a map by account/security is a direct replacement without changing semantics | patch |
| 5 | blind | SQLite integer SUM can overflow before BigInt conversion | low | Requires intermediate totals beyond SQLite signed 64-bit range, over 1000 maximum allowed single amounts; existing ledger aggregates use the same bound and reject unrepresentable values | reject |
| 6 | blind | No multi-treatment report fixture | medium | Only taxable report amounts are asserted; standalone classification tests do not exercise service grouping | patch |
| 7 | blind | Historical gain tests only cover EUR | low | minorUnitsPerMajor is called, but zero- and three-decimal currency rounding needs direct numeric assertions | patch |
| 8 | blind | No response serialization volume assertion | low | Existing volume fixture bounds service reads; no oversized response failure is demonstrated and adding a new size contract is not a trivial correction | reject |
| 9 | blind | Browser hide/reappear case covers flows only | low | Pure reports-layout.spec.ts already tests both keys together; both use identical stored-key merge and React mapping; no separate performance-key branch resets preferences | reject |
| 10 | blind | Manual security name cannot be read in full | low | The no-ticker row truncates its only name without a title attribute; adding the existing name as title is direct | patch |
| 11 | blind | Companion still describes planning approval pending | low | The planning state is stale after /apply approval; update lifecycle notes without rewriting the recorded baseline | patch |
| 12 | edge | Historical return hidden after later liquidation | medium | Same verified expression as finding 1, independently found | patch |
| 13 | edge | Oversized historical locked basis throws RangeError | low | A free quantity increase can exceed the representable money limit; toMinorUnits deliberately refuses such results. Returning null would introduce invented unknown-gain semantics at an extreme bound | reject |
| 14 | verification | Multi-treatment report regression gap | medium | Replacing the group filter with taxable-only grouping survives the existing report tests; classification unit tests exercise a different path | patch |
| 15 | verification | Checking-account labeled funding not covered at report layer | medium | Existing report fixtures label only investment accounts; restricting funding reads to investment accounts would remain undetected | patch |
| 16 | thermo | Realized gain rounds proceeds and basis independently | medium | Local reproduction: 0.004 EUR proceeds minus 0.006 EUR basis returns -1 cent, while the exact gain rounds to zero; the contract requires final minor-unit rounding | patch |
| 17 | thermo | Money sum helper accepts a bare number | low | report-investments.ts sum is used exclusively for MinorUnits gains, but its signature allows arbitrary numbers against AGENTS.md | patch |
| 18 | standards | AD-9 calls activity breakdown the only exception | low | Investment funding has a separate selection rule; AD-9 now records its eligibility and separates it from trades | patch |
| 19 | standards | Return percentage formatting duplicated in three components | low | The finite/infinite translation rule is shared through lib/trade-format.ts without changing output | patch |
| 20 | standards | Duplicate trade fixture in report tests | low | The first scenario now calls investmentFixture instead of repeating recordTrade conversion | patch |
| 22 | verification | Ledger coverage initially misses aggregate fallbacks | low | SQL aggregates without GROUP BY always return one row; replace unreachable optional fallbacks with the ledger's existing reduce pattern. All 5156 server tests then pass and ledger branch coverage is 100% | patch |
| 23 | full-suite | Manual-name browser assertion assumes its holding is in the top five | medium | Other tests seed larger holdings. Give the six remaining units a current-day quote above the existing largest position, preserving all historical numeric assertions and the full-name assertion | patch |

## Verification

Run focused Vitest files first, then the volume project separately. Finish with `pnpm install --frozen-lockfile`, `pnpm format`, `pnpm lint:code`, `pnpm lint:format`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`. Do not edit tracked files after that gate. Capture the report and print with seeded data at wide/narrow widths and both themes; leave no server running.
