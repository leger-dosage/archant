---
title: 'Story 1.3: Daily balance history'
type: 'feature'
created: '2026-09-21'
status: 'ready-for-dev'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant stores an end-of-day balance for every day of every account, but shows only today's. The household cannot see how a balance moved over time.

**Approach:** Add `GET /api/accounts/:id/balances?period=` returning the stored daily balances of a period with its change, and a balance chart on `/comptes/$accountId` between the header and the transactions: a 1 M / 3 M / 6 M / 1 A / Tout segmented control, a text summary above, and a « Voir les données » table alternative (UX-DR5).

## Boundaries & Constraints

**Always:**
- Spine AD-2, AD-5, AD-8 and the Consistency Conventions bind; `scaffolding-lessons.md` pitfalls apply.
- Periods are `1M`, `3M`, `6M`, `1Y`, `all`, one `const` array shared by the API query schema and the web search param. Default `1M`, as Sure's `last_30_days`. The period lives in the `period` search param, not persisted elsewhere.
- The period ends today in `APP_TIMEZONE`. It starts at today minus 1, 3, 6 or 12 calendar months (day clamped to the month's end), or at the opening date for `all`, and never before the opening date. Balance rows after today, written for future-dated transactions, are not returned.
- One point per day of the period, read from `balances`; no downsampling. Values are stored balances (AD-5): a liability plots the amount owed, positive.
- The change is last point minus first point. Its percentage is `change / |first|`, and is `null` when the first point is zero, so the interface shows the amount alone, as Sure does.
- Summary above the chart: « Solde : 1 234,56 €, +12,40 € (+1,0 %) sur 1 mois. », « depuis l'ouverture » for `all`. Amounts through `formatMoney`, never coloured.
- Chart: shadcn `Chart` on recharts 3, one line in `--chart-1`, no fill, no grid except a faint baseline, tooltip with the French date and `Money`. Arrow keys move the tooltip cursor (recharts' accessibility layer). No animation.
- « Voir les données » is a button with `aria-expanded` that swaps the chart for a real table (Date, Solde, header cells), most recent day first, in a scrolling container. Loading shows a skeleton of the chart's height.

**Never:**
- No stat block colour, no tabs, no Soldes surface, no snapshot or gap display (Story 1.4), no net worth chart (Story 6.1).
- No change to the recompute or to `forwardBalances`: Story 1.2 already recomputes balances in every ledger write.
- No `@tanstack/react-table`: a static two-column table does not need it. No raw SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| One month | Checking opened 2026-01-10; today 2026-09-21; `1M` | `from 2026-08-21`, `to 2026-09-21`, 32 points | — |
| Clipped | Opened 2026-09-01; `6M` | `from 2026-09-01`, first point is the opening balance | — |
| All | Opened 2024-02-29; `all` | `from 2024-02-29`, one point per day to today | — |
| Month-end clamp | Today 2026-03-31; `1M` | `from 2026-02-28` | — |
| Future transaction | Transaction on today + 10 days | Last point is today; the row on day + 10 is not returned | — |
| Liability | Card owing `490,30`, purchase `-30,00` today | Last point `52030`, change `+3000` | — |
| First point zero | Opening balance `0,00`, income `+100,00` | `change.amount 10000`, `change.percent null` | Summary shows the amount only |
| Opened in the future | Opening date after today | `points: []`, `change: null` | « Aucun solde sur cette période. » |
| Bad period | `?period=2W` | `400 VALIDATION_ERROR`, field `period` | — |
| Unknown account | `/api/accounts/nope/balances` | `404 NOT_FOUND` | Page already shows « Compte introuvable » |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- `lastBalanceOnOrBefore` (L47) is the only `balances` reader and returns one row; `.oxlintrc.json` bans `@archant/data/schema/balances` outside `ledger.ts`, so the range reader lives here next to `balanceOn` (L421) and `openingDateOf` (L432). Do not touch `recomputeBalances` (L67–137).
- `packages/data/schema/balances.ts` -- primary key `(account_id, date)` serves the range scan; no migration.
- `packages/api/src/domain/dates.ts` -- `today`, `addDays`, `maxDate`, `minDate`; no month arithmetic yet. `domain/**` and `services/ledger.ts` are held to 100% in `packages/api/vitest.config.ts`.
- `packages/api/src/services/accounts.ts` -- `getAccount` (L104) gives currency, `openingDate` and `NOT_FOUND`; reuse it.
- `packages/api/src/schemas/transactions.ts` -- `pageQuerySchema` (L103) is the query schema pattern; `routes/accounts.ts` `GET /:id/transactions` (L25) is the route pattern with `zValidator` and `validationError`.
- `packages/api/src/app.spec.ts` -- helpers `request`, `openAccount`, `postTransaction` (L224–248).
- `packages/web/src/routes/comptes.$accountId.tsx` -- `searchSchema` (L21) holds `page`; header L101–116, transactions section from L118.
- `packages/web/src/lib/query-keys.ts` -- a key under `accounts.detail(id)` is invalidated by `useInvalidateAccount` (`hooks/useTransactions.ts` L38) with no change there.
- `packages/web/src/styles.css` -- `--chart-1…6` tokens exist (L27–32, L91–96). `components/ui/` has no chart, toggle-group or table.
- `~/github/sure/app/models/period.rb`, `balance/chart_series_builder.rb`, `series.rb`, `trend.rb` -- reference for period ends, liability sign and the zero-start percentage.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/api/src/domain/dates.spec.ts`, `dates.ts` -- tests first, then `addMonths(date, months)` clamping to the month's end, leap years included.
- [ ] `packages/api/src/domain/balances/history.spec.ts`, `history.ts` (new) -- tests first, then `periodRange(period, today, openingDate)` returning `{ from, to }` or `null` when empty, and `balanceChange(points)` returning `{ amount, percent }` or `null`. 100% branches.
- [ ] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- `balancesBetween(deps, accountId, from, to)` ordered by date; add the ledger-level test for several transactions on one day that Story 1.2 left at the domain level only.
- [ ] `packages/api/src/schemas/balances.ts` (new) -- `BALANCE_PERIODS` and `balanceQuerySchema` (`period`, default `1M`).
- [ ] `packages/api/src/services/balances.ts` (new), `routes/accounts.ts`, `app.spec.ts` -- `getBalanceHistory(deps, accountId, period)` returning `{ period, from, to, currency, points: [{ date, balance }], change }`; route `GET /:id/balances`; spec covers the I/O matrix through `app.request`.
- [ ] `packages/web/package.json`, `components/ui/{chart,toggle-group,table}.tsx` -- `pnpm dlx shadcn add chart toggle-group table`; recharts 3.10.1 and `react-is`, as pinned in the spine. Justify recharts in the pull request (NFR14).
- [ ] `packages/web/src/lib/query-keys.ts`, `hooks/useBalanceHistory.ts` -- `accounts.balances(id, period)` = `["accounts", "detail", id, "balances", period]`.
- [ ] `packages/web/src/components/BalanceChart.tsx`, `routes/comptes.$accountId.tsx`, `locales/fr.json` -- segmented control in a `role="group"` labelled « Période », summary, chart, table toggle, skeleton, empty state; `period` added to `searchSchema` with `.catch` to `1M`.

**Acceptance Criteria:**
- Given a saved, edited or deleted transaction, when the sheet closes, then the chart and its table show the new balance without a reload.
- Given the chart focused, when the arrow keys are pressed, then the tooltip moves day by day showing the date and the balance.
- Given `/comptes/<id>?period=3M` is opened directly, then 3 M is selected and the chart shows three months.
- Given the finished story, when the AGENTS.md verification gate runs, then every command passes and leaves no tracked file modified.

## Design Notes

The first acceptance criterion of Story 1.3 in `epics.md`, the recompute in the same database transaction, shipped with Story 1.2 (see its Design Notes); `ledger.spec.ts` and `forward.spec.ts` already cover the opening day, gaps and liabilities. This story adds only the one missing ledger-level case.

Daily points over `all` stay small: ten years is 3 650 rows from one primary-key range scan, about 100 KB of JSON. Sure downsamples past one year; Archant follows the story's "each day" instead and can add it later without changing the response shape.

Before the opening date Sure plots zero; Archant starts the series at the opening date, since a zero line before the account existed reads as a real balance.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, coverage thresholds met, `git status` clean afterwards.

**Manual checks:**
- On a checking and a card account with transactions over several months: each period, the tooltip with the arrow keys, the table toggle, a transaction added then deleted moving the last point; light and dark, 1280 and 600 px.
