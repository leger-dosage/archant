---
title: "Story 34.1: Group the balance sheet by account type"
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: '7692e17df0305f9710d7421dd5359a5f64cb2904'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** the dashboard's « Bilan » lists each side's accounts flat under its weight bar, where Sure's `pages/dashboard/_balance_sheet.html.erb` (`00dd977fb`) groups them by account type: a table « Nom », « Poids », « Valeur », one collapsible row per type with its five-bar weight and total, its accounts under it, and an « Expand all » toggle in the card's header.

**Approach:** extend `balanceSheet` in `lib/balance-sheet.ts` with one row per type and per-account weights, computed from `/accounts` alone; render them as native `<details>` rows driven by React state, so « Tout développer » opens or closes every row. Amounts read in whole units, as Sure's `precision: 0`.

## Boundaries & Constraints

**Always:** weights follow Sure: a type's weight is its counted sum (active, included, reporting currency, as `countsInReports`) over the side's API total, an account's its balance over that total, both 0 when the total is 0. The side totals stay the API's. Rounding to whole units is display only, from integer minor units. Every string goes through `locales/fr.json` and `locales/en.json`. Types keep `TYPE_ORDER`, accounts the API's order (the member's « Ordre d'affichage »).

**Never:** no API, schema or migration change; no per-user « start expanded » preference (Sure's `always_expanded_account_groups`) and no change to the accounts column; no exchange rates.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two types | depository 25 000 €, property 75 000 € | rows « Comptes bancaires » 25 %, 25 000 €; « Bien immobilier » 75 %, 75 000 €; weights sum to 100 | N/A |
| Five bars | weight 25 % | `ceil(25 / 20)` = 2 bars lit, 3 at 20 % opacity | N/A |
| Excluded account | vehicle 8 000 € excluded, side total 10 000 € | listed under « Véhicule » with 80 %, muted with the eye-off marker; the type's total and weight leave it out | N/A |
| Foreign account | investment in USD | listed under its type with its own balance; no weight, since `/accounts` carries no converted balance | N/A |
| Empty side | no active liability | « Pas encore de passif », « Ajoutez vos comptes de passif pour voir une répartition complète », Sure's minus icon; « Aucun actif pour l'instant » and its line for assets | N/A |
| Expand all | every row closed | button named « Tout développer » opens all, then reads « Tout réduire »; closing one row by hand brings back « Tout développer » | hidden when no side has a row |

</frozen-after-approval>

## Code Map

- `packages/app/src/lib/balance-sheet.ts` -- `balanceSheet`, `TYPE_ORDER`, `countsInReports`; add `rows` (type, total, weight, accounts with their weight or null) and a pure `litBars(weight)`. Keep `types` (bar and legend) as is.
- `packages/app/src/lib/balance-sheet.spec.ts` -- existing `listOf`/`account` helpers to reuse.
- `packages/app/src/components/BalanceSheetSection.tsx` -- `Group` renders the side; replace the flat `InsetGroup` list. `TYPE_COLOURS` colours the bars. The legend's `shareFormat` goes to 0 decimals, Sure's `number_to_percentage(precision: 0)`.
- `packages/app/src/components/LoanChart.tsx#formatWholeMoney` -- half-up whole-unit formatter in BigInt; move it to `lib/format-money.ts` and reuse it here, then add a `whole` prop to `components/Money.tsx` and pass it through `components/AccountBalance.tsx`.
- `packages/app/src/components/AccountAdditionalDetails.tsx` -- existing `<details>`/`summary` styling to copy (marker hidden, chevron rotated).
- `packages/app/src/components/Section.tsx` -- `action` slot holds « Tous les comptes »; the toggle sits beside it. Lucide `ChevronsUpDown`/`ChevronsDownUp`, as Sure's `DS::ExpandToggle`.
- `packages/app/src/locales/{fr,en}.json` -- `dashboard.balanceSheet`: add `name`, `weight`, `value`, `expandAll`/`collapseAll` (« Tout développer »/« Tout réduire », Sure's en « Expand all »/« Collapse all »), `classifications` (« Actifs »/« Passif », Sure's `fr.yml`), `noAsset`, `noLiability`, `addAssetAccounts`, `addLiabilityAccounts` (Sure's `fr.yml`/`en.yml`); drop `accounts` if unused.
- `packages/app/e2e/dashboard.spec.ts`, `account-order.spec.ts`, `reset.spec.ts` -- read « Bilan »'s flat « Comptes » list and « Passifs »; open the types first.
- `docs/sure-parity.md` « Net worth » row -- the Story 34.1 « Later » becomes Parity.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/balance-sheet.spec.ts` -- failing tests first: rows by type in `TYPE_ORDER` with totals and weights summing to 100, account weights, an excluded and a foreign account, a zero total, an empty side, `litBars` at 0, 20, 21, 100.
- [x] `packages/app/src/lib/balance-sheet.ts` -- `rows` and `litBars`.
- [x] `packages/app/src/lib/format-money.ts`, `components/Money.tsx`, `components/AccountBalance.tsx`, `components/LoanChart.tsx` -- shared `formatWholeMoney`, `whole` prop.
- [x] `packages/app/src/components/BalanceSheetSection.tsx` -- both sides always; header « Actifs · total »; bar and legend; table header; `<details>` type rows with chevron, name, `GroupWeight`, total; account rows with `TintedIcon`, linked name, weight, whole balance; empty state; toggle in the action slot.
- [x] `packages/app/src/locales/fr.json`, `en.json` -- keys above.
- [x] `packages/app/e2e/dashboard.spec.ts` -- open a type and read its accounts, its weight and whole balance; « Tout développer » then « Tout réduire »; an empty side's text; adapt the two existing « Bilan » tests and `shareText`.
- [x] `packages/app/e2e/account-order.spec.ts`, `reset.spec.ts` -- expand before reading the accounts; « Passif ».
- [x] `docs/sure-parity.md` -- « Net worth » row.

**Acceptance Criteria:**
- Given the dashboard with accounts on both sides, when « Bilan » renders, then each side shows its whole-unit total, the bar and legend, then « Nom », « Poids », « Valeur » and one closed row per type.
- Given a type's row, when the member opens it, then its accounts appear with their weight and balance.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- `BalanceSheetGroup.accounts` gave way to `rows`; the type sums are computed once and feed both the bar and the rows.
- On a phone the weight column keeps its percent without the five bars (`hidden sm:flex`, `w-12`): at 390 px the names otherwise shrank to « Compt… », where Sure's table scrolls its values out of view. Recorded in `docs/sure-parity.md`.
- The standards review asked for `percentOf` to take `MinorUnits` (AGENTS.md: no bare `number` for money), `WEIGHT_BARS` shared by `litBars` and the bars, and DESIGN.md's balance sheet line updated; all applied.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `formatWholeMoney` has no unit test for half-up, negative or zero-decimal currencies | medium | patch | Only an e2e value that truncation also passes; `lib/format-money.spec.ts` added. |
| 2 | A negative weight shows a hyphen beside amounts in U+2212 | low | patch | `shareFormat` is CLDR's; `GroupWeight` now replaces it as `formatMoney` does. |
| 3 | The USD account's assertion `toContainText("5 000")` fixes neither currency nor rounding | low | patch | Now compared with a USD whole-unit `Intl` format. |
| 4 | The phone layout departs from Sure without a parity record | low | patch | `docs/sure-parity.md` « Net worth » records it, and the dropped subtype. |
| 5 | « Passif » here, « Passifs » in the net worth card above | low | reject | Sure's `pages.dashboard.balance_sheet.classifications.liability` is « Passif », which the story's criterion quotes; the net worth card's totals are Archant's own. |
| 6 | A type with only foreign or excluded accounts reads 0 % and 0 € | low | reject | Sure's `AccountGroup#total` leaves excluded accounts out too; the foreign case is the frozen matrix's choice, with no exchange rates. |
| 7 | Negative or above-100 weights, and weights on a negative side total | false | reject | Sure's `AccountGroup#weight` and the account weight divide the same way, `total.zero?` aside. |
| 8 | A bar lit beside « 0 % », legend shares that round to 99 | false | reject | Sure's `_group_weight` uses `ceil(weight / 20)` and `number_to_percentage(precision: 0)` alike. |
| 9 | `aria-label` and `aria-expanded` both change; no tooltip | false | reject | Sure's `DS::ExpandToggle` and its script set both, icon-only. |
| 10 | An empty side shows no total in its header | false | reject | Sure shows the total only `if classification_group.account_groups.any?`. |
| 11 | No test that the toggle hides when no side has a row | low | reject | The dashboard shows « Bilan » only with accounts; an inactive-only household is rare and the guard is one condition. |
| 12 | Open rows keep their keys when a type disappears and comes back | low | reject | Needs a type to vanish and return within one visit; reopening is harmless. |
| 13 | -0,40 € rounds to « 0 € » with an outflow tone | false | reject | The balance sheet passes no `signed`, so `Money` gives it no tone. |
| 14 | Spec `in-review` while `sprint-status.yaml` says `in-progress` | false | reject | Step 5 sets both to `done`. |

## Design Notes

- Native `<details>` with `open` from state and `onToggle` syncing it back: keyboard and screen readers get Sure's disclosure for free, and the toggle derives its label from « every row open ».
- An account row drops the subtype line, as Sure's shows only the logo and the name; the type row now names the type.
- A foreign account gets no weight rather than a wrong one: Archant's `/accounts` leaves it out of the total until exchange rates exist, where Sure converts it.

## Verification

**Commands:**
- `pnpm --filter @archant/app exec vitest run src/lib/balance-sheet.spec.ts` -- expected: pass.
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: pass, no tracked file modified after.

**Manual checks:**
- Screenshot « Bilan » closed, one type open, and all open, light and dark, wide and phone width.
