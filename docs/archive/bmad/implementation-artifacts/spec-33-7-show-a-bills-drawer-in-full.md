---
title: "Story 33.7: Show a bill's drawer in full"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '0b03cd3420766b837f634fa58f50aafe9ca66446'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) fills a bill's drawer from `bills/drawer.html.erb`, `_summary.html.erb` and `_detail.html.erb`: a headline « X payés » or « X restants » over « X sur Y payés », « Payer » or « Paiement automatique » beside the link, then « Aperçu » (matching rules, twelve-month chart, average, per year, paid this year, « Indicateurs clés » per year, last account, price changes), « À venir », « Historique » and « Remarques », with edit, pause and delete in a header menu. Archant's drawer (`_authed.bills.$billId.tsx`) shows the next payment, the average, the chart, price changes, the last account, notes, « Ouvrir le site de la facture » and three buttons at the bottom.

**Approach:** `billDetail` returns what `bills#show` with `display: "history"` loads, reusing `billHistory`'s analytics, next dates and closed occurrences, plus the matcher hints and Sure's yearly metrics; the drawer renders Sure's summary, pay action, header menu and four disclosures. The occurrence sheet's menu gains Sure's divider items « Modifier la facture » and « Mettre en pause » / « Reprendre », left to this story by 33.5.

## Boundaries & Constraints

**Always:** Sure's numbers. Analytics only once an occurrence is paid (`paid_analytics`): average, lowest and highest of each paid occurrence's confirmed sum, « Par an » the monthly equivalent × 12, « Payé cette année » every confirmed payment paid from 1 January. Yearly metrics: confirmed payments grouped by their occurrence's due year, total and total ÷ payment count rounded half up, four latest years. « À venir »: the next three dates after today, « ~ » and the series' amount. « Historique »: the twelve latest non-scheduled occurrences, status, then « N paiements » when several confirmed, else the payment's transaction label or « Paiement manuel », and the confirmed sum. Rules: merchant else label, the amount or « de X à Y », the frequency, the account, « Correspond aussi à {{names}} » from `nameAliases`, the tolerance from `learnedTolerance` (per mille) when positive. « Aperçu » starts open, the others folded. Sure's French from `bills/fr.yml`, `recurring_transactions/fr.yml`. A viewer sees everything but the menus and « Ajouter un lien ».

**Never:** no migration, no change to the MCP tools, `billHistory`'s output, the bills page rows or the occurrence sheet's other actions. No schedule line, state chips, AI item or `row_action` in the drawer (not in this story's criteria).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Paid occurrence | current paid 15,99 of 15,99 | « 15,99 € payés », « 15,99 € sur 15,99 € payés » | none |
| Open occurrence | 0 of 50,00 | « 50,00 € restants » | none |
| Autopay with link | autopay, URL | « Paiement automatique » link, new tab | none |
| Link, no autopay | URL | « Payer » link, new tab | none |
| Nothing | no URL, admin | « Ajouter un lien » opens the edit dialog; a viewer sees nothing | none |
| Yearly | 2 payments due 2025 (10,00 + 11,01), 1 due 2026 | 2026: 12,00/12,00; 2025: 21,01/10,51 | none |
| History | occurrence with two confirmed payments | « Payée · 2 paiements » | none |
| No paid occurrence | installment just declared | no average, no « Indicateurs clés » | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/views/bills/drawer.html.erb`, `_summary.html.erb`, `_detail.html.erb`, `recurring_transactions/_pay_action.html.erb`, `bills_controller.rb:139-275,430-436`, `helpers/bills_helper.rb:70-75,238-240`, `recurring_occurrences/show.html.erb:284-292`.
- `packages/api/src/services/recurring/all-bills.ts` -- `BillDetail`/`billDetail`: replace `averagePaid` with `analytics`, add `rules`, `yearly`, `upcoming`, `history`.
- `packages/api/src/services/recurring/bill-reads.ts` -- `billHistory` (reused, exported types), `averageOf`.
- `packages/api/src/services/recurring/all-bills.spec.ts` -- the detail's tests.
- `packages/app/src/routes/_authed.bills.$billId.tsx` -- the drawer.
- `packages/app/src/components/OccurrenceSheet.tsx` -- `OpenActions` menu; `useBillActions` from `BillActions.tsx`, `useBill`.
- `packages/app/src/locales/fr.json` -- `bills.detail`.
- `packages/app/e2e/bills.spec.ts`, `recurring.spec.ts`, `viewer.spec.ts` -- the drawer's tests.
- `docs/sure-parity.md` -- « Bills page, all bills, bill drawer ».

## Tasks & Acceptance

**Execution:**
- [x] `all-bills.spec.ts` -- failing tests first: yearly table, history read, rules, upcoming.
- [x] `all-bills.ts` -- the read.
- [x] `_authed.bills.$billId.tsx`, `OccurrenceSheet.tsx`, `fr.json` -- the drawer and the menu.
- [x] e2e -- open a drawer and find each section; existing tests follow the menu.
- [x] `docs/sure-parity.md`; story and `sprint-status.yaml` to `done`; Epic 33 stays `in-progress`.

**Acceptance Criteria:**
- Given a partly or fully paid current occurrence, when the drawer renders, then the summary reads « {{amount}} payés » or « {{amount}} restants », and « Payer » or « Paiement automatique » sits beside the link.
- Given « Aperçu », when it renders, then it lists the rules, the twelve months, « Moyenne payée », « Par an », « Payé cette année » and « Indicateurs clés ».
- Given dates to come and settled cycles, then « À venir » lists three dates and « Historique » the twelve latest closed occurrences.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since the baseline, `docs/` left out for its table width; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The occurrence menu offers edit and resume for a suggested series | low | patch | Guarded on `status !== "suggested"`, as the drawer. |
| 2 | Pausing from the occurrence sheet deletes its occurrence; the sheet stayed open on an error and the toast waited for three retries of a 404 | medium | patch | The sheet closes once the pause succeeds, as Sure's `_top` frame leaves; queries no longer retry `NOT_FOUND`; a new e2e test pauses from the sheet. |
| 3 | The edit dialog lived in `OpenActions`, which remounts when what it owes changes | medium | patch | `useBillActions` and its dialogs move to the sheet's root. |
| 4 | A skipped or missed current occurrence reads « X restants » | low | reject | Sure's `_summary` reads `paid?` else `remaining`. |
| 5 | « À venir » lists dates for a paused or ended bill, ignores a postponed date, always prints « ~ » and the series' amount | low | reject | Sure's `schedule.occurrences_between` and `_detail` do the same. |
| 6 | Two rule pills with the same text share a React key | low | patch | Keyed by position. |
| 7 | A payment whose transaction was deleted reads « Paiement manuel » | false | reject | Sure's `payment.entry&.name.presence \|\| manual_payment`. |
| 8 | « Payé cette année » counts a payment dated next year; « Par an » and it hide until an occurrence is paid | low | reject | Sure's `ytd_paid_total` has no upper bound, and both sit in `paid_analytics`. |
| 9 | `billDetail` recomputes what `billHistory` reads instead of reusing it | low | reject | `bill-reads.ts` imports `all-bills.ts`, and `import/no-cycle` refuses the reverse; the average was already computed here before this story. |
| 10 | The parity doc and tracking are not in the diff | false | reject | `docs/` was left out of the review diff; tracking moves at completion. |
| 11 | The header menu may cover a long title | low | patch | The header keeps `pr-24`; checked in the captures. |
| 12 | The sheet reads the whole bill detail for its record; its two items appear late | low | reject | One bill's read, cached with the drawer's. |
| 13 | `OpenActions` repeats `BillMenu` | low | reject | Sure's occurrence menu has icons and no delete; the drawer's has delete. |
| 14 | The sheet's new items are never clicked | medium | patch | The postpone test opens « Modifier la facture »; the new test pauses. |
| 15 | No fixture separates the payment year from the due year | medium | patch | December's occurrence paid in January lands in 2025's row and this year's payments. |
| 16 | The twelve-occurrence cap is untested | low | reject | One `slice` with Sure's constant. |
| 17 | The tolerance and alias lines are untested in the interface | low | patch | The drawer e2e test reads « Correspond aussi à » and « 18,5 % ». |
| 18 | The route spec checks neither `rules` nor `upcoming` | low | reject | The service spec covers both. |
| 19 | The matcher hints read the series row a second time | low | reject | One indexed read by primary key per drawer. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- Edit, pause or resume and delete move into a header menu « Actions pour {{name}} », as `drawer.html.erb`; « Modifier » becomes « Modifier la facture » (`bills.show.edit`). A suggestion keeps « Ajouter la facture » and « Ce n'est pas une facture ».
- « Ouvrir le site de la facture » gives way to Sure's `_pay_action`: autopay first, then « Payer », then « Ajouter un lien » for an administrator.
- The summary keeps no visible heading, as Sure; it stays a region named « Prochain paiement ».
- The learned tolerance prints with one decimal through `Intl` (« 12,5 % »).
- Queries stop retrying `NOT_FOUND`, beside `UNAUTHORIZED` and `FORBIDDEN`: a pause from an occurrence's sheet deletes that occurrence.
- `billDetail` computes the history and yearly rows itself, as `import/no-cycle` keeps `all-bills.ts` from importing `bill-reads.ts`.
- The epic context is kept although `ux-designs/.../EXPERIENCE.md` is newer: that file holds no Epic 33 decision.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/recurring/all-bills.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
