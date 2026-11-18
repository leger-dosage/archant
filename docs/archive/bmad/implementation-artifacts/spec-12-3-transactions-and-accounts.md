---
title: 'Story 12.3: Transactions and accounts'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: '3eb19941867c567c3a04a8bbe9692d4471160639'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-12-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The transaction list still shows Epic 1's rows: an 8 px dot for the category, a bare day title, no row icon, the account as plain text, statuses as outline badges or loose text, and no recurring marker. The accounts page lists plain rows, and the account page's title bar shows the generic wallet icon.

**Approach:** Rebuild `TransactionList` rows and day headers as `DESIGN.md`'s transaction row, with `TintedIcon`, `CategoryPill` and one status badge component. Add `recurring` and `accountType` to the list API. Put the accounts page's groups in sections with type icons, and the account's type icon in its title bar.

## Boundaries & Constraints

**Always:**
- Row, from 768 px: a 36 px single line with the checkbox (transactions page only), a `md` `TintedIcon`, the label then its badges then the caption (merchant name or transfer caption, `caption` type, muted) then tag badges, all truncating, then the category pill column, the account column (`showAccount` only: `sm` type `TintedIcon` + name), and the right-aligned amount. Below 768 px the current two-line layout stays.
- Row icon, first match: a transfer side showing no category → `transfer`; a category → `category`; a merchant → `merchant` (first letter); else `uncategorised`.
- Row states: hover `bg-hover`; selected `bg-selection` plus a 2 px `accent-brand` bar on the left edge; the row button's focus ring stays. Muted amount for pending and excluded, as today.
- Category slot: `CategoryChip` stays the same button with the same accessible names and tooltip; its content becomes `CategoryPill`. `TransferChip` becomes a transfer-tinted pill with `ArrowLeftRight` and the kind's name.
- Badges, one `StatusBadge` component (20 px, 5 px radius, `bg-badge`, `foreground-secondary`, 12 px icon): « En attente » `Clock`, « Récurrent » `Repeat`, « Virement interne » `ArrowLeftRight` on every matched transfer side, « Virement possible » `ArrowLeftRight`; « Doublon possible » `TriangleAlert` in the warning tint. All inside the row button, after the label. Excluded keeps `ExcludedMarker` beside the amount.
- `recurring`: true when a non-dismissed series matches the row's account and series key (`seriesKeyOf`), amount ignored, the rule `recurringOfEntry` uses for the sheet. Computed once per page in one query, never per row.
- `accountType`: read in the same join as `accountName`.
- Day header: a row on `bg-section` with the day as the `h3`, the count (« 2 », read « 2 opérations »), and the day's subtotal right-aligned: the signed sum of that day's rows on the current page, pending and excluded included as in the filter total, one `Money` per currency. Not an `li`.
- Accounts page: Actifs and Passifs each a `section` (DESIGN's section: `bg-section`, 8 px radius, border) whose header holds the `h2` and the group total; rows gain a `sm` type `TintedIcon`, keep one link per account holding the balance.
- Account page: `Page` accepts a rendered icon; the account's title bar shows its `md` type `TintedIcon`, then the name `h1`, actions and `AccountMenu` unchanged. The balance stays `amount-hero`. The tabs lose the active tab's shadow through a `className` at the call site, not in `components/ui/tabs.tsx`.

**Never:** no search box or « Filtrer » chip from the mock (the filter bar stays), no per-day select-all checkbox, no merchant logos, no new endpoint, no server-side day subtotal, no change to row accessible names, no restyle of the sheet, bulk bar, filter bar or pagination (Story 12.4 owns the remaining screens).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Day across pages | 3 rows of a day on page 1, 2 on page 2 | page 1 header « 3 », subtotal of those 3 | N/A |
| Mixed currencies | −10,00 € and −5,00 $ on one day | two subtotals, one per currency | N/A |
| Recurring by merchant | row merchant M, series (account, M) confirmed | « Récurrent » | N/A |
| Dismissed series | only a dismissed series matches | no badge | N/A |
| Other account | series on account B, row on account A | no badge | N/A |
| Spent loan payment | `loan_payment` outflow showing its category | category icon and pill, « Virement interne » badge, spent caption | N/A |
| No category, no merchant | bare manual row | `CircleDashed` icon, « Sans catégorie » pill | N/A |

</frozen-after-approval>

## Code Map

- `packages/app/src/components/TransactionList.tsx` -- `groupByDay` (:36), `CategoryChip` (:77, button kept), `TransferChip` (:123), `TransferSuggestedFlag` (:139), `RowCheckbox` (:154), row (:251-359). Used by `_authed.transactions.tsx:250` (`showAccount`, `selection`) and `_authed.accounts.$accountId.tsx:145`.
- `packages/app/src/components/DuplicateFlag.tsx`, `ExcludedMarker.tsx` -- fold `DuplicateFlag` into `StatusBadge`; `ExcludedMarker` stays.
- `packages/app/src/components/TintedIcon.tsx`, `CategoryPill.tsx` (unused so far), `lib/tint.ts` (`resolveTint`, `ACCOUNT_TYPE_TINTS`), `lib/transfers.ts` (`showsCategory`, `transferCaption`, `TRANSFER_COLOR`).
- `packages/app/src/hooks/useCategories.ts:25` -- `useCategoryShown` returns `{color, name}`; add `icon`.
- `packages/app/src/hooks/useRecurring.ts:30` -- `useInvalidateRecurring` must also invalidate `queryKeys.transactions.all` now that rows show the badge.
- `packages/api/src/services/ledger.ts:3933` (`TransactionListRecord`), `:4305` (`accountName` join) -- add `accountType`.
- `packages/api/src/services/transactions.ts:92` (`withSources`), `:156` and `:235` (both list services) -- enrich with `recurring` the same way.
- `packages/api/src/services/recurring.ts:347` (`seriesOfTransaction`), `domain/recurring.ts:193` (`seriesKeyOf`) -- the matching rule to batch.
- `packages/app/src/components/AccountGroups.tsx` -- sections, row icon. Pattern: `BalanceSheetSection.tsx:103-114` (section markup, `type-title`).
- `packages/app/src/components/Page.tsx:14-31` -- `icon: LucideIcon` only today.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx:330` (`Page icon=WalletIcon`), `:395` (`TabsList`).
- `packages/app/src/locales/fr.json` -- `transactions.pending` (:269), `.duplicate.flag` (:320), `.transfer.suggested` (:312); add `transactions.recurringBadge`, `transactions.transfer.internal`, `transactions.days.count`.
- e2e constraints: flags stay inside `button[data-transaction-id]` (`bank-connections:578`, `duplicates:59`, `transfers:145,545`, `bulk:184`, `operations:372-375`); exact `listitem` texts in `main` (`transactions:77`, `manage-accounts:77,210,362`) forbid new `li`; `h2` « Actifs »'s parent holds the total (`accounts:8`, `manage-accounts:10,358`); one link per account with its balance (`accounts:66-70`); `region` named by the account `h1` holds subtype and balance.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/recurring.spec.ts` (series matching) and `app.spec.ts` (`GET /api/transactions` and an account's list) -- written first: `recurring` for matrix rows 3-5, `accountType` on both list endpoints.
- [x] `services/recurring.ts` (`recurringEntryIds` or equivalent), `services/transactions.ts`, `services/ledger.ts` -- the two fields, one series query per page.
- [x] `packages/app/src/lib/transaction-days.spec.ts`, `transaction-days.ts` -- `groupByDay` moved here with count and per-currency subtotals; matrix rows 1-2.
- [x] `lib/tint.spec.ts`, `lib/tint.ts` -- `rowSubject(transaction, category, merchantName)` for the icon rule; matrix rows 6-7.
- [x] `packages/app/e2e/transactions.spec.ts` (or a new `transaction-rows.spec.ts`) -- written before the UI: 36 px row height, day header count and subtotal, row `tinted-icon`, pill text, account type icon, each badge's text and icon, selected row background `selection` and its left bar.
- [x] `e2e/accounts.spec.ts` -- sections with type icons; account page title bar holds `[data-slot="tinted-icon"]`.
- [x] `components/StatusBadge.tsx`, `TransactionList.tsx`, `useCategories.ts`, `useRecurring.ts`, `fr.json` -- rows and headers.
- [x] `components/AccountGroups.tsx`, `Page.tsx`, `_authed.accounts.$accountId.tsx` -- accounts screens.
- [x] Remaining e2e fixes from the Code Map.

**Acceptance Criteria:**
- Given the finished story, when the `AGENTS.md` verification gate and `pnpm test:e2e` run, then all pass and no tracked file changes.
- Given the list in light and dark, when Story 12.1's contrast test runs, then every new text pair (badge text on `badge`, caption on `selection`) is covered and passes.

## Implementation Notes

- From 768 px the row is a CSS grid: the row button spans every column through `grid-cols-subgrid`, and the category button sits over the button's empty category cell (`col-start-2 row-start-1`, `z-10`). The category button stays outside the row button in the DOM, so accessible names and tab order are unchanged.
- Column widths (`9rem` category, `9rem` account, `7.5rem` amount) keep the label column wider than the other three at 1280 px, so the row button's centre, where Playwright clicks, lands on the label and not under the pill. `TransferChip` is `pointer-events-none`, so a click on it reaches the row.
- The duplicate badge's tint is `bg-warning/6` in light mode, not 10 %: at 10 % the warning text falls to 4.4:1 on a hovered or selected row. `styles.spec.ts` checks the composite on the panel, hover and selection surfaces in both modes.
- `DuplicateFlag` is deleted; the sheet's duplicate section title now renders `StatusBadge status="duplicate"`.
- Spec-review pass: the category slot's classes are one `CATEGORY_SLOT` constant, the empty cell's comment gives its reason, and the day test helper names its minor units. Kept as they are: the label's 510 weight (the mock's `.lb b`), a selected row staying on `selection` under hover, and `rowSubject` in `lib/tint.ts` beside the other subjects.
- QA on a built server with seeded data, light and dark at 1280 px and light at 700 px: rows measure 36 px, and `/accounts` and an account page match the mock.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Route | Evidence |
|-------|---------|---------|-------|----------|
| edge | A transfer side matching a series shows « Récurrent » though its sheet has no recurring section | low | patch | `TransactionSheet` renders `RecurringBlock` only when `showsCategory`; the badge now follows the same condition |
| edge | Several badges squeeze the label to nothing below 768 px | low | patch | badges are `shrink-0 whitespace-nowrap` beside a truncating label; the line wraps below md |
| blind | Skeletons keep Epic 1's shapes, so both pages jump on load | low | patch | direct class change |
| blind | Account title bar icon grows from 16 to 22 px on load, shifting the `h1` | low | patch | direct: a 22 px box while loading |
| blind | `listItemsOf` comment counts three queries | low | patch | it runs two |
| blind | Duplicate badge contrast tested on `accent`, rows use `hover` | low | patch | same value today, nothing ties them |
| gap | No test sees the row badge after « Ajouter aux récurrences » | medium | patch | reverting the invalidation keeps every test green |
| blind | Row accessible names change with the new badges | low | reject | the frozen intent puts the badges inside the row button; « no change to row accessible names » forbids a rewrite of the naming, as pending and duplicate already sat there |
| blind | Sheet's duplicate title restyled as a badge | low | reject | the Code Map folds `DuplicateFlag` into `StatusBadge`; one heading changes look |
| blind | Detected, unconfirmed series count as recurring | false | reject | the frozen intent says non-dismissed, the sheet's rule |
| blind, edge | Row icon and pill disagree for an unknown category id, and flicker while categories load | low | reject | an unknown id needs a race with a deletion; loading lasts one request; a guard adds a branch |
| blind | Sprint status `in-progress` while the spec is `in-review` | false | reject | step 5 moves the sprint to `review` |
| blind | Verification section lists only the test commands | low | reject | the acceptance criteria name the full gate; fixing it edits the spec |
| blind | Two-line layout below 768 px untested | low | reject | presentational wiring, which AGENTS.md does not pad with tests |
| edge | A refund from a subscribed merchant shows « Récurrent » | false | reject | the frozen intent ignores the amount, as `recurringOfEntry` does, so the sheet names the same series |
| edge | Random amounts in `transaction-rows.spec.ts` may collide with another test's transfer | low | reject | 80 000 values, opposite sign on another account inside the match window; a counter adds plumbing |

## Design Notes

The day subtotal is Sure's: `_entry_group.html.erb` sums the page's entries by currency, so a day split across two pages shows two partial subtotals; a server figure would contradict the rows it sits above. `recurring` comes from the API because the series key needs the normalised label, and the sheet's own rule lives there. `accountType` comes from the list join rather than from `/accounts` so a row of an inactive or hidden account still gets its icon.

## Verification

**Commands:**
- `pnpm test` -- expected: pass, including the new specs.
- `pnpm test:e2e` -- expected: pass.

**Manual checks (if no CLI):**
- Light and dark screenshots of `/transactions` next to the mock's « 2a » and « 2b » panels, and of `/accounts` and an account page, at 1280 px and 700 px.
