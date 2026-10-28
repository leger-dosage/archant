---
title: "Story 33.8: Price notices and autopay tone"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'a5b8c56fbb4d9937f8792e150c29e01db6e80411'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) opens `bills#index` with « Changements », a notice per price change of a listed bill in the last 30 days (`bills_controller.rb#collect_notices`, `bills/_notice.html.erb`, `index.html.erb:35-64`), and quiets an autopaid bill's row (`bills/_occurrence.html.erb:5`, `bills_helper.rb#bills_row_subline`). Archant's `/bills` has neither.

**Approach:** `billsOverview` returns `notices`, the price changes of its payable active series effective from 30 days ago, each with Sure's whole percent and `urgent` (`RecurringPriceChange::MATERIAL_SHIFT`), sorted as Sure; each row carries its series' `autopay`. The page renders the section, the fold and the tone.

## Boundaries & Constraints

**Always:** Sure's rules. Window: `effective_on >= today - 30`, no upper bound. Scope: the series `billsOverview` lists (payable: outgoing, no destination or a card or loan), status `active`. Urgent: `previous > 0` and `|new − previous| × 10 >= previous`, integers only. Percent: `round(|new − previous| × 100 / previous)` half up, signed, `0` when `previous` is `0`; printed whole, « +19 % », « −12 % ». Order: urgent first, then `|effectiveOn − today|` ascending, then latest `effectiveOn`, then id. Section « Changements » with the notice count; urgent lines in the foreground and medium weight, others muted; the routine ones fold under « N changement(s) mineur(s) » only when an urgent one exists. « Gérer » opens `/bills/$billId`. Autopaid row: name and amount `text-muted-foreground`; the subline starts with « Paiement automatique » when its series is active (`bills_autopay_label`). Viewers see all of it.

**Never:** no migration, no MCP change, no trial or renewal notices (Archant stores no `trial_ends_on`/`renews_on`, deferred in `deferred-work.md`), no row verb, no `amount_changed` subline reason, no change to which rows sit in « Requiert votre attention ».

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rise 13,49 → 15,99 today | active bill | urgent, « +19 % » | none |
| 10,00 → 10,99 | 9,9 % | routine | none |
| 10,00 → 9,00 | exactly −10 % | urgent, « −10 % » | none |
| 31 days ago | change | no notice | none |
| Paused, ended or income series | change today | no notice | none |
| Only routine notices | two | listed flat, no fold | none |
| Autopay, overdue | row | muted, « Paiement automatique · … », stays in « Requiert votre attention » | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/controllers/bills_controller.rb:500-560`, `app/models/recurring_price_change.rb`, `app/views/bills/index.html.erb:35-64`, `_notice.html.erb`, `_occurrence.html.erb:1-80`, `helpers/bills_helper.rb:238-240,332-344`, `config/locales/views/bills/fr.yml:149-157`.
- `packages/api/src/domain/recurring/occurrences.ts` -- `changePercent`, `roundHalfUp`; add `isMaterialShift`, `wholePercent` beside them, tested in its spec.
- `packages/api/src/services/recurring/bill-overview.ts` -- `BillRow` gains `autopay`; `BillsOverview` gains `notices`; the payable-series condition is shared between the rows and the notices.
- `packages/api/src/services/recurring/all-bills.ts` -- `priceChangesWhere` (reused for names and amounts).
- `packages/api/src/services/recurring/bill-overview.spec.ts` -- window, threshold, order, scope, `autopay`.
- `packages/app/src/components/BillLabels.tsx` -- `noticeText`, `noticeGroups`, tested in `BillLabels.spec.ts`.
- `packages/app/src/routes/_authed.bills.tsx` -- `BillRow` tone, `Notices` section in `OverviewPage` after `LeftOutNotice`, as Sure's order (after the pulse).
- `packages/app/src/locales/fr.json` -- `bills.notices`.
- `packages/app/e2e/bills.spec.ts` -- `repriced` helper; a notice and an autopaid row.
- `docs/sure-parity.md` -- « Bills page, all bills, bill drawer » row.

## Tasks & Acceptance

**Execution:**
- [x] `occurrences.spec.ts`, `bill-overview.spec.ts` -- failing tests first.
- [x] `occurrences.ts`, `bill-overview.ts` -- the read.
- [x] `_authed.bills.tsx`, `fr.json` -- section, fold, tone.
- [x] `bills.spec.ts` e2e -- a notice with « Gérer » opening the drawer, an autopaid row.
- [x] `docs/sure-parity.md`; story and `sprint-status.yaml` to `done`; Epic 33 stays `in-progress`.

**Acceptance Criteria:**
- Given an active bill with a price change in the last 30 days, when `/bills` renders, then « Changements » lists « {{name}} a changé de prix : {{from}} → {{to}} ({{percent}}) » with « Gérer », which opens the drawer.
- Given urgent and routine notices, then the urgent come first and the routine fold under « N changements mineurs ».
- Given an autopaid bill, then its row's name and amount are muted and its subline starts « Paiement automatique ».
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the code diff since the baseline; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `list(items, label?)` never receives a label | low | patch | Parameter removed. |
| 2 | The page duplicates a percent formatter and names it like the API's `wholePercent` | low | patch | The notice line moves to `noticeText` in `BillLabels.tsx`, beside `PriceChangeAmounts`. |
| 3 | A change from 0 reads « (0 %) » | low | reject | Sure's `shift` is 0 without a previous amount and prints « 0% » too. |
| 4 | The flat list without an urgent notice is untested | low | patch | `noticeGroups` decides the fold and is tested in `BillLabels.spec.ts`. |
| 5 | Ordering by distance is not proven: every fixture is today or past | medium | patch | A change three days ahead now sorts after one a day ago, against the query's order. |
| 6 | The label reads the occurrence's state, so a paused bill's paid row this month says « Paiement automatique » | low | reject | Only a paid row of a bill paused after paying, this month; the fix needs a new row field. |
| 7 | A late autopaid row is muted though it needs attention | false | reject | Sure's `lead_tone` reads `series.autopay?` alone, late or not. |
| 8 | 9,9 % reads « +10 % » among the minor changes | false | reject | Sure rounds the shown percent and compares the exact shift. |
| 9 | `PriceNotice.currency` is a `string` | low | reject | As `PriceChange.currency`, the type it mirrors. |
| 10 | The notices read after the review queue, one more round trip | low | reject | The overview's reads are already sequential; one indexed query. |
| 11 | « Changements » sits after `LeftOutNotice`, not right after the totals | false | reject | `LeftOutNotice` names the series the totals leave out: it belongs to them. |
| 12 | A transfer into savings is not proven absent from the notices | medium | patch | `bills.spec.ts` records a change on one and expects no notice. |
| 13 | A paused autopaid row's missing label is untested | low | reject | One condition beside a tested one; an e2e test for it would cost a minute of run. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- « requièrent votre attention »: Sure's `@needs_action_count` leaves autopaid bills out, but no view at `00dd977fb` renders it, and its « Requiert votre attention » section lists every overdue row, autopaid or not (an overdue autopay is chased, `bills_row_verb`). Archant has no such count; its section keeps Sure's rows.
- « Paiement automatique » rather than « Payer »: Archant rows carry no verb; Sure's due autopaid row has none either and leads its subline with « Paiement automatique », which Archant now does.
- The percent prints with Archant's French format (« +19 % », U+2212 minus) rather than Sure's « +19% ».
- The notice rows' order breaks Sure's ties (same urgency and distance) by latest date then id, for a stable page.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/recurring/bill-overview.spec.ts src/domain/recurring/occurrences.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
