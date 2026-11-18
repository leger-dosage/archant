---
title: 'Story 11.8: Recurring series stay single and current'
type: 'bugfix'
created: '2026-09-26'
status: 'done'
baseline_commit: '8ea360d0a99efa02b9065d81b51b927c876bf0d8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A series is keyed on its merchant, or else its normalised label, so renaming its transactions or setting their merchant makes detection create a twin (Netflix listed twice). Detection only refreshes the rows it finds again: a confirmed or manual series keeps a past next date, a reverted import leaves counts and dates built on deleted rows, and the sheet offers « Ajouter aux récurrences » on a transaction that already has a series.

**Approach:** Detection gains two passes around Sure's identifier, in its one `immediate` transaction. Before matching patterns, a stored series whose latest transaction no longer carries its key follows that transaction's new key. After matching, every stored series detection did not find is recomputed from its current transactions, as Sure's `update_manual_recurring_transactions`. Revert runs detection. The sheet asks the API for the transaction's series.

## Boundaries & Constraints

**Always:**
- « Rename » means changing the label of the series' transactions (edit, bulk edit, rule); a series has no name of its own. A change `normalizeLabel` erases keeps the key and needs nothing.
- Re-key: a stored row, dismissed included, with no candidate of its account, key and amount dated on its `last_occurrence_date` and none left in its refresh window (amended after review, 2026-09-26: renaming only the latest row moved the series and the older rows came back as a twin), where the candidates of that account, amount and currency on that date (transfers left out) carry exactly one other key, moves to that key (`merchant_id`/`label_key`, `label`), keeping id and status. If another stored row already holds that key and amount: a `detected` holder is deleted and the move happens; any other holder stays and the moving row is deleted.
- Refresh, for every non-dismissed row no pattern updated: its occurrences are the candidates of its account, key, amount and currency within `dayDistance` 5 of its expected day, over 6 months for a confirmed or manual row (Sure's manual pass), 3 months otherwise. With occurrences: count, latest date and latest label are rewritten, next date from `nextExpectedDate`. Without: a `detected` row whose stored last date lies inside the window is deleted, its rows are gone; any other row gets count 0 and keeps its last date.
- A confirmed or manual row never keeps a next date before today: `nextDateFrom(today, day)` replaces it, after a pattern update, a refresh, or a confirm through `setRecurringStatus`.
- Staleness runs after both passes, on the refreshed last dates. Detection still never reactivates an inactive row.
- `revertImport` in `services/imports.ts` runs detection after the revert commits; a failure is logged, code only, and never fails the revert, as `detectAfterImport`.
- `addRecurringFromEntry` never creates a row when one exists for the account and key, whatever the amount or status: it confirms the one with the same amount, else the latest `last_occurrence_date`.
- `GET /api/recurring/by-entry/:entryId` answers `{ data: RecurringRecord | null }`: the non-dismissed row for the transaction's account and key, same amount first, else latest; `NOT_FOUND` for an unknown entry.
- Sheet « Récurrence » block: with a series, a sentence naming it (merchant name, else label) and a link to `/recurring`; without, the current button. Query key under `["recurring"]`, so adding or detecting refreshes it.
- `domain/**` stays at 100 % branches; every visible string in `fr.json`.

**Never:** no link table between entries and series, no migration; no change to grouping, thresholds or clustering (the 7.5 % and ±2-day Sure detector stays « no decision recorded »); no detection after a single edit, bulk edit, delete or rule run; no change to the merchant cascade on merge or delete; no highlight of one series on `/recurring`; no new error code.

## I/O & Edge-Case Matrix

| Scenario | State (today 2026-09-21) | Expected |
|----------|--------------------------|----------|
| Merchant set | detected « PRLV NETFLIX », 3 rows get merchant Netflix | same id, `merchant_id` set, `label_key` null, one row |
| Label renamed | confirmed series, rule renames its rows to another key | same id, confirmed, new key |
| Dismissed renamed | dismissed series, rows renamed | stays dismissed, no detected twin |
| Existing twin | confirmed orphan + detected row on the new key | detected row deleted, orphan moves, one row |
| Ambiguous day | two rows, same account, amount and date, two new keys | no move |
| Late confirmed | confirmed, last 07-15, nothing since | next 10-15 |
| Manual caught up | manual 1 occurrence 06-03, rows 07-03 … 09-03 | count 3, last 09-03, next 10-03 |
| Revert, some left | detected count 5, import of 2 rows reverted | count 3, dates from the 3 left |
| Revert, none left | detected, all rows reverted | row deleted |
| Revert, confirmed | confirmed, all rows reverted | count 0, confirmed, next ≥ today |
| Add, other amount | series Netflix −13,49; add from a −15,99 Netflix row | that series confirmed, no new row |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/recurring.ts` -- `detectRecurring` :101 (load `stored` with dates, day, manual; candidates from 6 months); `keyOf` :56; `setRecurringStatus`; `addRecurringFromEntry` :266 (key lookup drops `amount`); add `recurringOfEntry`.
- `packages/api/src/domain/recurring.ts` -- pure `rekey(stored, candidates)`, `occurrencesOf(row, candidates, today)`, `currentNextDate(next, day, today)`; reuse `dayDistance`, `nextExpectedDate`, `nextDateFrom`, `isStale`, `LOOKBACK_MONTHS`; add `MANUAL_LOOKBACK_MONTHS = 6`. `direction()` drops transfers.
- `packages/api/src/services/ledger.ts:2074` `ruleCandidates` -- reuse as is.
- `packages/api/src/services/imports.ts:504` `revertImport`, `:431` `detectAfterImport` to generalise.
- `packages/api/src/routes/recurring.ts` -- add the `by-entry` GET before `/:id` routes.
- `packages/web/src/hooks/useRecurring.ts`, `lib/query-keys.ts:61` -- `useRecurringOfEntry`, key `["recurring", "entry", id]`.
- `packages/web/src/components/TransactionSheet.tsx:526` `RecurringBlock`; `routes/_authed.recurring.tsx` `nameOf`; `fr.json:347` `transactions.recurring`.
- Tests: `services/recurring.spec.ts` (`addRows` :65, `detectedBill` :101, `setStatus`, fake clock 2026-09-21), `domain/recurring.spec.ts`, `app.spec.ts:6497`, `packages/web/e2e/recurring.spec.ts` (`addMonthly`, `detect`).

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/recurring.spec.ts`, `recurring.ts` -- tests first for re-key (single target, ambiguous day, own key still present), occurrences (window per status, day distance) and `currentNextDate`; then the functions.
- [x] `packages/api/src/services/recurring.spec.ts`, `recurring.ts` -- one test per matrix row through `updateTransaction`, `bulkUpdateTransactions`, `applyRulePlanToHistory` and `revertImport`; then both passes, the confirm roll-forward, the add lookup, `recurringOfEntry`.
- [x] `packages/api/src/services/imports.ts`, `app.spec.ts` -- detection after revert, its failure logged without failing; `GET /api/recurring/by-entry/:entryId` envelopes and `NOT_FOUND`.
- [x] `packages/web` -- hook, query key, `RecurringBlock` with and without a series, `fr.json`.
- [x] `packages/web/e2e/recurring.spec.ts` -- detected series: its transaction's sheet names it and the link opens `/recurring`; a transaction without one shows « Ajouter aux récurrences ».
- [x] `docs/sure-parity.md` -- recurring rows: re-key and revert refresh as Archant departures, the manual pass as parity, the next date kept from today for confirmed rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row and the sheet behaviour have an automated test: Playwright for the sheet, Vitest for the rest.

## Implementation Notes

`rekey`, `refreshSeries`, `occurrencesOf` and `currentNextDate` are pure, in `domain/recurring.ts`; `detectRecurring` applies their steps in its one `immediate` transaction. The rule-rename test imports its rows from an OFX file, since a rule never renames a hand-entered row (its label is locked). The interface invalidates `recurring` after an import confirm or revert and after a single or bulk transaction update, so the sheet and the page follow detection.

## Spec Change Log

- 2026-09-26, review: renaming only a series' latest row moved the whole series, and the older rows under the old key came back as a detected twin (blind, edge). Amended the frozen re-key rule: a row also needs no own-key occurrence left in its refresh window. Avoids a twin born from annotating one row. KEEP: re-key before patterns, the holder rule, the refresh pass and its deletion of a detected row whose rows are gone.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| Renaming only the latest row moves the series; old rows recreate a twin (blind, edge) | medium | `rekey` looked at the last date only; three later old-label rows form a pattern on the vacated key. | patch, frozen rule amended |
| Import confirm and revert run detection but the interface never invalidates `recurring` (blind, edge) | medium | `useImports.ts` invalidates the account only. | patch |
| The sheet's series query stays stale after the transaction's label or merchant is saved (blind, edge) | low | `useTransactions.ts` mutations do not touch `recurring`; one line each. | patch |
| No test for the roll-forward in the pattern-update branch, in `addRecurringFromEntry`, nor through a revert with a past date (verification, blind) | medium | Removing either roll-forward kept 456 tests green. | patch |
| « A new price never makes a twin » comment is false (blind) | low | Detection still groups by exact amount. Direct rewording. | patch |
| `docs/sure-parity.md` Next date row omits the add path; Manual pass row reads badly (blind) | low | Direct rewording. | patch |
| Latest row deleted while an unrelated payment of the same amount sits on that day moves the series onto it (blind, edge) | low | Needs same account, amount and day; after the amendment also needs no own row left in the window. A guard adds a branch. | rejected |
| Own-key check ignores currency while the target check filters it (blind) | false | The frozen rule states exactly this split; a same-key row in another currency is the same key. | rejected |
| A confirmed row moving onto a dismissed holder is deleted (blind, edge) | low | Needs an existing twin already dismissed; the dismissed key is the user's own decision. | rejected |
| The sheet says a one-off at another amount, or a refund, belongs to the series (blind, edge) | low | AC4 matches on merchant or label, not amount. | rejected |
| Every detection rewrites `updatedAt` on every row (blind) | low | Nothing reads `updated_at` for display or logic. | rejected |
| `occurrenceCount` now counts a sliding window and differs between the pattern and refresh paths (blind, edge) | low | The page never shows the count. | rejected |
| A manual row added from a transaction older than six months drops to count 0 (edge) | low | Rare; count not displayed; last date kept. | rejected |
| A future-dated row can become the last occurrence (edge) | low | Pre-existing in detection; unchanged. | rejected |
| Two series swapping keys lose one (edge) | low | Needs two series renamed into each other in one run. | rejected |
| A failed `by-entry` query shows the add button (blind, edge) | low | The API then confirms the existing row instead of creating one: no twin. | rejected |
| Spec cites `applyRulePlanToHistory` where tests use `applyRules`; `nameOf` not reused; status fields differ (blind) | low | Test entry point choice; `nameOf` is private to the route file; status moves by workflow step. | rejected |
| No test shows the merchant name in the sheet sentence (verification) | low | `merchantName ?? label` mirrors the page's `nameOf`; `getRecord` already joins the merchant. | rejected |

## Design Notes

Why re-key on the latest transaction and not a link table: Sure has no link either and shows the same twin; a link needs a migration, a write on every ingest and absorb, and still misses a rename of only future rows. The latest transaction is the series' identity the user just edited: if it carries no longer the key but exactly one other, the series follows it. Two identical payments renamed differently on the same day stay put rather than guess.

Why roll a confirmed next date forward: Sure's manual pass computes it from the latest row and can leave it past; the story's title asks for a date not in the past, and `addRecurringFromEntry` already dates a manual row from today.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green, 100 % branches on `domain/**`.
- `pnpm test:e2e` -- expected: green.
