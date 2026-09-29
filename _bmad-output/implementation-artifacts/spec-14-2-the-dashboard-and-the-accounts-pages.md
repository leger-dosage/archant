---
title: 'Story 14.2: The dashboard and the accounts pages'
type: 'feature'
created: '2026-09-29'
status: 'in-review'
baseline_commit: 'f744495232316bcdc8dd11cc9698160649d30f7b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-14-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 14.1 gave every page Sure's shell and scale, but the dashboard and the accounts pages keep Epic 12's small blocks: 8 px radii, 14 px card titles, a 28 px hero, a 256 px chart, 4 px weight bars, 22 px tinted icons, and a two-column grid from 1024 px that squeezes the cards beside the accounts column.

**Approach:** Lay out the dashboard, the accounts page and an account's page as Sure's `pages/dashboard.html.erb`, `accounts/index` and `UI::AccountPage` do, in `DESIGN.md`'s tokens, and land the primitives Stories 14.3 and 14.4 reuse: the card, the inset group, the summary strip, the tinted icon at 20/28/36 px and the `amount-summary` and `amount-hero` styles.

## Boundaries & Constraints

**Always:**
- Primitives. `Section` becomes `DESIGN.md`'s card: `rounded-xl border bg-card`, header title in `card-title` (16 px, 510), its `action` slot and `id` unchanged. A new `components/InsetGroup.tsx`: a `section` named by its header, tray `rounded-xl bg-inset p-1`, header `px-4 py-2` in `overline` (12 px, 510, uppercase, 0.02em, muted) holding the heading on the left and an optional total on the right, then an inner `rounded-lg border bg-card` block whose rows are separated by `line`; the heading level is a prop. A new `components/SummaryStrip.tsx`: equal cells split by `line`, each a `role="group"` named by its label, a muted `text-sm` label over a figure in `amount-summary`; one column below `sm`. `TintedIcon`: `sm` 20 px (`rounded-md`, 12 px glyph), `md` 28 px (`rounded-lg`, 16 px glyph), `lg` 36 px (`rounded-[10px]`, 20 px glyph); letters `text-xs` at sm and md, `text-sm` at lg.
- `styles.css`: `amount-hero` 30 px, 510, 1.2, -0.02em; new `amount-summary` 20 px, 510, 1.4; both with `tabular-nums`. `type-title` becomes `card-title` of `DESIGN.md` (16 px, 510, 1.5).
- Dashboard (`routes/_authed.index.tsx`): the greeting `h1` at 30 px from 1024 px (24 px below), as Sure's `text-xl lg:text-3xl`; cards `grid grid-cols-1 gap-6 2xl:grid-cols-2 2xl:items-start` in the order net worth, month's flow, balance sheet, each a `Section`.
- Net worth: the value in `amount-hero`; the change in `text-sm` with its arrow; Actifs and Passifs on the right; the period control in the card header; the chart 208 px high (`h-52`), its table the same height, the summary and « Voir le tableau » below.
- Month's flow: a `SummaryStrip` of Revenus, Dépenses and « Épargne du mois » under the header, then the donut beside the categories. The categories sit in an `InsetGroup`; each row has an `md` tinted icon, the name, the amount and the share in `text-sm` muted.
- Balance sheet: per class, the name and total in `section-title` (18 px), a 6 px weight bar (`h-1.5`, `gap-1`, segments `rounded-sm`), the legend in `text-sm` with 10 px dots, then an `InsetGroup` of its accounts, each row an `md` tinted icon, name over subtype, balance.
- Accounts page (`AccountGroups.tsx`): each class an `InsetGroup` with its `h2` name and total in the header; rows `p-4` with an `lg` tinted icon, name over subtype, the inactive badge, balance; `hover:bg-hover`.
- Account page: the header icon `lg`; the balance in `amount-hero` above a chart card (`Section` titled as the balance heading today, the period control as its action, the chart at 256 px as Sure's `h-64`); tabs unchanged on the `inset` track.
- Every region, group, list and heading name that tests use today survives.

**Never:** no API or route change; no transactions-list change beyond what the new `md` icon size implies (Story 14.3); no recurring, rules or settings layout change beyond the `Section` restyle (Story 14.4); no sparkline, no drag-and-drop dashboard.

</frozen-after-approval>

## Code Map

- `packages/app/src/styles.css:223-245` -- `amount-hero` (28 px, 590), `type-display` (leave), `type-title` (14 px, 590).
- `packages/app/src/components/Section.tsx` -- `rounded-lg`, header `min-h-11 border-b`, used by recurring, rules and six settings routes.
- `packages/app/src/components/TintedIcon.tsx:9-13` -- `SIZES`; callers: `AccountGroups.tsx:69` (`sm` → `lg`), `AppShell.tsx:121` (`md`), dashboard and settings rows (default `md`), `TransactionList.tsx` (leave).
- `packages/app/src/routes/_authed.index.tsx:71-110` -- `Page` props, `grid gap-4 lg:grid-cols-2`.
- `packages/app/src/components/Page.tsx:159-173` -- `h1.text-2xl`; needs an opt-in for the greeting size.
- `packages/app/src/components/NetWorthSection.tsx` -- hand-written card, `NetWorthChange` `text-xs`, `dl` totals, `PeriodToggle`.
- `packages/app/src/components/BalanceChart.tsx:50,132,205` -- `CHART_HEIGHT = "h-64"`, shared with the account page: make the height a prop.
- `packages/app/src/components/CashFlowSection.tsx` -- `FlowCell` grid (:235), donut `DONUT_SIZE = 128` (:87), rows (:61).
- `packages/app/src/components/BalanceSheetSection.tsx` -- group (:31), bar `h-1` (:41), legend, rows.
- `packages/app/src/components/AccountGroups.tsx` -- class sections, excluded note, rows.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:336-406` -- header icon and placeholder `size-[22px]`, balance block, chart section.
- Sure: `app/views/pages/dashboard.html.erb`, `pages/dashboard/_balance_sheet.html.erb`, `_outflows_donut.html.erb`, `accounts/index/_account_groups.erb`, `accounts/_account.html.erb`, `app/components/UI/account/chart.html.erb`.
- Tests: `e2e/dashboard.spec.ts`, `e2e/accounts.spec.ts:160-161` (`region` `toHaveClass(/bg-card/)` becomes the inset tray), `e2e/manage-accounts.spec.ts`, `e2e/balance-history.spec.ts`, `e2e/shell.spec.ts`, `e2e/brand.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/styles.css` -- utilities above.
- [x] `packages/app/src/components/{TintedIcon,Section,InsetGroup,SummaryStrip}.tsx` -- primitives.
- [x] `packages/app/src/components/Page.tsx` -- greeting title size.
- [x] `packages/app/src/routes/_authed.index.tsx`, `NetWorthSection.tsx`, `BalanceChart.tsx`, `CashFlowSection.tsx`, `BalanceSheetSection.tsx` -- dashboard.
- [x] `packages/app/src/components/AccountGroups.tsx`, `routes/_authed.accounts.$accountId.tsx` -- accounts pages.
- [x] `packages/app/e2e/{dashboard,accounts,manage-accounts,balance-history}.spec.ts` -- new assertions: greeting 30 px; one column at 1440, two at 1600; hero 30 px; chart 208 px on the dashboard and 256 px on an account; flow figures 20 px; weight bar 6 px; trays on `inset` with uppercase headers; tinted icons 36 px on the accounts page and the account header, 28 px in the balance sheet; account balance 30 px inside no card and the chart inside a card.

**Acceptance Criteria:**
- Given the dashboard at 1440 px, when it loads, then its three cards stack in one column with 12 px radii; at 1600 px the month's flow sits beside the net worth.
- Given any existing end-to-end test, when the gate runs, then it passes with its assertions kept or made stricter.

## Implementation Notes

- `type-title` is renamed `card-title` rather than re-valued, so its two other callers, `EmptyState` and `OutsideShell`, follow the new 16 px, 510.
- The balance sheet's inset group is headed « Comptes » with no total: the class total already sits above it in `section-title`, as Sure's tray carries column labels only. The month's flow tray is headed « Dépenses par catégorie » or « Revenus par catégorie », the name its list already had.
- `BalanceChart` takes `height` as 208 or 256, mapped to literal `h-52` and `h-64` classes so Tailwind still sees them.
- The dashboard's « Ajouter un compte » moves from `sm` to the default 36 px button, as DESIGN.md's page header asks.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass.
