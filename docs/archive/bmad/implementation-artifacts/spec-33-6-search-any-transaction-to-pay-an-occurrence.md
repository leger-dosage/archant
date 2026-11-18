---
title: "Story 33.6: Search any transaction to pay an occurrence"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '8820fd79704b04624c83d8ab9a71ad27ad7d4379'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) builds an occurrence's « Trouver un paiement » from two lists (`recurring_occurrences_controller.rb:99-200`, `show.html.erb:163-245`): up to six transactions `Matcher#explain` scores, the best as a card and the rest under « Autres correspondances probables », then a disclosure « Rechercher dans toutes les transactions » with a search box and up to fifteen transactions of the bill's account, sign and currency, nearest the remaining amount first; a search reads past the date window. Archant's `OccurrenceSheet` shows only the scored list, so a payment the matcher's narrow window or name test missed can only be recorded by hand, with no transaction.

**Approach:** a new read, `GET /api/recurring/occurrences/:id/others?q=`, Sure's `candidate_entries` less the ranked ones; the sheet's `AddPayment` becomes Sure's layout: the promoted card, « Autres correspondances probables », then a `<details>` with the search form and the second list. Each row links through the existing `POST /api/recurring/occurrences/:id/payments` with `entryId`.

## Boundaries & Constraints

**Always:** Sure's scope (`candidate_scope`): the series' account, else every account; the occurrence's currency; the series' sign; transactions only; not a transfer side unless the series is a recurring transfer; not already on this occurrence; not a split parent (Archant's `attachEntry` refuses one, AD-20). Sure's window (`candidate_window`): from `dueOn` − 40 days to the earlier of `dueOn` + 40 and today in `APP_TIMEZONE`. A non-empty `q` drops the window and keeps labels containing it. Sure's order: `|amount| − target` ascending, target being what remains, else the expected amount; then distance to `dueOn`; then newest; then id. Twenty-one read, the ranked ids removed, fifteen kept. Sure's French wording from `recurring_occurrences/fr.yml`.

**Never:** no change to `paymentCandidates`' own scope (it keeps dropping transactions with nothing left to spend, an earlier decision), to `addPayment`, the MCP tools, the manual payment form, or the migration set. No search over notes or merchant: Sure's `candidate_entries` reads `entries.name` only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Window | due D, transactions at D−41, D−40, D+40, D+41, today D+10 | D−40 and up to D+10 only | none |
| Amount order | remaining 50,00, rows 49,00, 80,00, 50,00 | 50,00, 49,00, 80,00 | none |
| Search past window | `q` « loyer », a « LOYER MARS » a year earlier | listed | none |
| Nothing found | `q` matches nothing | empty list, « Aucun résultat pour {{query}}. » | none |
| Accountless bill | series `accountId` null | every account's transactions | none |
| Transfer side | a transfer outflow, ordinary series | left out; kept for a recurring transfer | none |
| Ranked overlap | a transaction the matcher scores | in the ranked list only | none |
| Unknown occurrence | bad id | 404 `NOT_FOUND` | toast from the code |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/controllers/recurring_occurrences_controller.rb:13-21,99-200`, `app/views/recurring_occurrences/show.html.erb:163-245`, `_candidate.html.erb`, `config/locales/views/recurring_occurrences/fr.yml`.
- `packages/api/src/services/ledger/recurring.ts` -- `occurrenceTransactions`: the SQL of Sure's `candidate_scope`, window or search, and order.
- `packages/api/src/services/recurring/payments.ts` -- `otherPaymentCandidates(deps, occurrenceId, q)`: the occurrence, its series, its held entries, the target, then the ranked ids removed.
- `packages/api/src/schemas/recurring.ts`, `routes/recurring.ts` -- `othersQuerySchema` (`q` up to 200 characters) and `GET /occurrences/:id/others`.
- `packages/app/src/hooks/useRecurring.ts`, `lib/query-keys.ts` -- `useOtherPaymentCandidates(id, q)`.
- `packages/app/src/components/OccurrenceSheet.tsx` -- `AddPayment`: card, rows, disclosure, search.
- `packages/app/src/components/BillLabels.tsx` -- `matchReasons` returns the strings `MatchReasons` draws, for a row's one line.
- `packages/app/src/locales/fr.json` -- `bills.sheet`.
- `packages/app/e2e/bills.spec.ts`, `e2e/recurring.spec.ts`, `e2e/viewer.spec.ts` -- the sheet's tests; a viewer reads neither list.
- `docs/sure-parity.md` -- « Occurrences and payments ».

## Tasks & Acceptance

**Execution:**
- [x] `services/recurring/payments.spec.ts` -- failing tests first: the window, the amount order, a search past the window, the transfer side, the accountless bill, the ranked overlap.
- [x] `ledger/recurring.ts`, `recurring/payments.ts`, `schemas/recurring.ts`, `routes/recurring.ts` (+ route spec) -- the read.
- [x] `hooks/useRecurring.ts`, `lib/query-keys.ts`, `BillLabels.tsx`, `OccurrenceSheet.tsx`, `locales/fr.json` -- the sheet.
- [x] `e2e/bills.spec.ts` -- search a transaction a year before the due date and link it; existing tests follow the new names.
- [x] `docs/sure-parity.md`; story and `sprint-status.yaml` to `done`; Epic 33 stays `in-progress`.

**Acceptance Criteria:**
- Given an open occurrence, when « Trouver un paiement » renders, then the best scored transaction is a card with « Lier le paiement », the others under « Autres correspondances probables », and « Rechercher dans toutes les transactions » opens on fifteen nearby transactions at most.
- Given a search, when the administrator submits « Rechercher des transactions », then the list reads every transaction of the scope whose label contains the text, whatever its date, or says « Aucun résultat pour {{query}}. ».
- Given a row of either list, when pressed, then it is linked through `POST /api/recurring/occurrences/:id/payments`.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `8820fd79`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A transaction fully spent on another occurrence is listed, and linking it toasts `PAYMENT_EXCEEDS_TRANSACTION` | low | reject | Sure's `candidate_entries` keeps it too; its controller says over-allocation is refused at write time, never hidden at read time. |
| 2 | The window and the date order start from `dueOn`, not the snoozed `effectiveDueOn` | low | reject | Sure's `candidate_window` and `candidate_relevance_sql` read `@occurrence.due_on`. |
| 3 | An unknown occurrence shows an inline alert, where the matrix says a toast | low | reject | The sheet's own read fails first with the same inline alert; the list's alert is the sheet's existing pattern. |
| 4 | A row's accessible name drops the amount | low | patch | `linkCandidate` now names the label, the date line and the amount. |
| 5 | The second list is read, and the matcher run again, while the disclosure is folded | low | patch | `useOtherPaymentCandidates` takes `enabled`, true once unfolded. |
| 6 | The disclosure's open state is fixed at mount | false | reject | `AddPayment` is keyed by `expected` and `remaining`, so a link remounts it with a fresh `defaultOpen`. |
| 7 | No test for the 15 cut after the ranked ones go, nor for the end at due date + 40 | medium | patch | Two tests added to `payments.spec.ts`. |
| 8 | A transaction rejected with « Pas cette facture » returns in the second list | low | reject | Sure's `candidate_scope` leaves out rejections only from the ranked list. |
| 9 | SQLite's `LIKE` folds ASCII case only | low | reject | The transactions search and the bill picker share `contains`; Design Notes record it. |
| 10 | The card shows the amount unsigned | false | reject | Sure's `_candidate` formats `entry.amount_money.abs`. |
| 11 | Spec tasks unticked, tracking at `in-progress`, `viewer.spec.ts` missing from the Code Map | low | patch | Ticked, set to `done`, Code Map amended. |
| 12 | Search UX: a skeleton per search, the native clear button does not resubmit, the 15 cut is not announced | low | reject | Same as Archant's bill picker and Sure's form. |
| 13 | An occurrence due more than 40 days ahead gets an empty window | low | reject | Sure's range `(due_on - 40)..[due_on + 40, Date.current].min` is empty too; a search still reads every date. |
| 14 | A search matching only a ranked transaction says « Aucun résultat » | low | reject | Sure removes ranked ids from the searched list as well; the match is shown above. |
| 15 | The e2e test searches 200 days back, not about a year | low | patch | Now 330 days. |
| 16 | No test of « Autres correspondances probables » | medium | patch | The e2e test now scores a second transaction and checks its row and reasons. |
| 17 | No test of the expected-amount target once nothing remains | low | patch | A reopened, fully paid occurrence orders by the expected amount. |
| 18 | `docs/sure-parity.md` « Payment matching » does not mention the search | false | reject | That row covers the matcher; « Occurrences and payments » covers the sheet and now the search. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- The story lists « Autres correspondances probables » above the fifteen; Sure's view puts that heading over the ranked list's second to sixth rows, and the fifteen inside « Rechercher dans toutes les transactions ». Sure's layout wins.
- The disclosure starts open when the ranked list is empty or a search is under way, as Sure's `open:`.
- The search runs on Enter, as Sure's form and Archant's bill picker do; `LIKE` is the transactions search's, case-insensitive for ASCII.
- A transaction excluded from reports stays in the second list, as Sure's `candidate_scope` keeps it; a split parent does not, since Archant refuses to attach one.
- The promoted card keeps Archant's percentage beside the amount; the rows show date and reasons on one line, as Sure's `_candidate`.
- A separate route rather than a wider `/candidates`, so a search refetches only the second list; the server drops the ranked ids itself, as Sure's `show`.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/recurring/payments.spec.ts src/routes/recurring.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
