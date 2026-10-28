---
title: "Story 33.5: Postpone an occurrence a week"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'da651d8acb5437eae35b38dbe5ab4cf910e03b08'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) closes a scheduled occurrence's dialog with « Marquer comme payée » and a menu beside it, whose items are « Ignorer » and « Reporter d'une semaine » (`recurring_occurrences/show.html.erb:284-287`), the latter patching `snooze` with `until: Date.current + 7`. No view of Sure sets `override_amount`. Archant's `OccurrenceSheet` offers « Reporter au » with a date field, « Modifier le montant » with an amount field, and a separate « Ignorer cette échéance » button.

**Approach:** in `OpenActions` of `packages/app/src/components/OccurrenceSheet.tsx`, drop the postpone and amount sections and the skip button; put a menu beside « Marquer comme payée » with « Ignorer » and « Reporter d'une semaine ». The week is counted from today in `APP_TIMEZONE`, which the client reads from the occurrence row the server computed: `effectiveDueOn` less `days`, plus 7. The API is unchanged.

## Boundaries & Constraints

**Always:** Sure's labels from `config/locales/views/recurring_occurrences/fr.yml` (`skip` « Ignorer », `snooze_week` « Reporter d'une semaine », `snooze.success` « Reportée au %{date} »); the menu trigger named « Actions pour {{name}} », as Archant's other row menus; the date from the server's today, never the browser's; a viewer sees no menu, as before.

**Never:** no change to `PATCH /api/recurring/occurrences/:id`, `occurrencePatchSchema`, the MCP tools or the bills page rows; no « Modifier la facture » or « Mettre en pause » in this menu (Sure's divider items belong with the drawer, Story 33.7); no reshaping of « Marquer comme payée » or « Ajouter un paiement ».

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Due in 3 days | `effectiveDueOn` D+3, `days` 3 | `snoozedUntil` D+7, toast « Reportée au {{D+7}} » | API error: toast from its code |
| Overdue | `effectiveDueOn` D-4, `days` -4 | `snoozedUntil` D+7 | same |
| Due in 10 days | `effectiveDueOn` D+10, `days` 10 | `snoozedUntil` D+7; the effective date stays D+10, as Sure's `[due_on, snoozed_until].max` | same |
| Skip | « Ignorer » | occurrence skipped, toast « Échéance ignorée » | same |
| Closed occurrence | paid or skipped | « Rouvrir » alone, no menu | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/views/recurring_occurrences/show.html.erb:270-300`, `app/controllers/recurring_occurrences_controller.rb#snooze`, `app/models/recurring_occurrence.rb` `effective_due_on`, `snooze!`.
- `packages/app/src/lib/dates.ts` -- `weekFromToday({ effectiveDueOn, days })`: today in `APP_TIMEZONE` plus 7, as `YYYY-MM-DD`.
- `packages/app/src/components/OccurrenceSheet.tsx` -- `OpenActions`: drop `until`, `expected`, `expectedError` and their sections and the skip button; a `DropdownMenu` beside « Marquer comme payée ».
- `packages/app/src/hooks/useRecurring.ts` -- `useEditOccurrence`, `useSetOccurrenceClosed` doc comments.
- `packages/app/src/locales/fr.json` -- `bills.sheet`: drop `postponeTo`, `changeAmount`, `changeAmountHint`, `expected`, `amountChanged`; `skip` « Ignorer », `postpone` « Reporter d'une semaine », `postponed` « Reportée au {{date}} », add `menu`; `bills.description`.
- `packages/app/e2e/bills.spec.ts:299`, `e2e/viewer.spec.ts:650` -- the sheet test and the viewer's absent controls.
- `docs/sure-parity.md:222` -- « Occurrences and payments ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/dates.spec.ts` -- failing test first: `weekFromToday` for a row due ahead, overdue, and across a month end.
- [x] `lib/dates.ts`, `components/OccurrenceSheet.tsx`, `hooks/useRecurring.ts`, `locales/fr.json` -- the menu.
- [x] `e2e/bills.spec.ts`, `e2e/viewer.spec.ts` -- postpone a week through the menu, no amount field, skip through the menu; the viewer sees no menu.
- [x] `docs/sure-parity.md`; story and `sprint-status.yaml` to `done`; Epic 33 stays `in-progress`.

**Acceptance Criteria:**
- Given an open occurrence, when the administrator opens « Actions pour {{name}} », then the menu lists « Ignorer » and « Reporter d'une semaine », and no « Reporter au », « Montant attendu » or « Modifier le montant » remains.
- Given « Reporter d'une semaine », when chosen, then the row reads « Reportée au {{today + 7}} » and the toast says so.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `da651d8a`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | On a row due further than a week out, the toast says « Reportée au {{today + 7}} » while the row keeps its due date | low | reject | Sure's `recurring_occurrences_controller.rb#snooze` flashes `success` with `until_date` whatever the due date, and `effective_due_on` keeps the later one. |
| 2 | An occurrence already snoozed past a week comes back to today plus 7 | low | reject | Sure's `snooze!` writes `until` as given, so its menu does the same. |
| 3 | An amount overridden earlier can no longer be cleared on screen | low | reject | No view of Sure sets or clears `override_amount`; the route and the assistant still can. |
| 4 | `EXPERIENCE.md` still describes « Reporter », « Modifier le montant » and « Ignorer cette échéance » | low | patch | The Bills row now names the menu with « Ignorer » and « Reporter d'une semaine ». |
| 5 | Story 23.4's text in `epics.md` still describes the old sheet | low | reject | A done story's text is history; Story 33.5's criteria state the revision. |
| 6 | No e2e test runs the browser in another zone than `APP_TIMEZONE`, nor postpones an overdue row | low | reject | `weekFromToday` is pure and its spec covers an overdue row and a month end; the e2e test proves the date counts from today, not from the due date. |
| 7 | A sheet left open past midnight postpones from yesterday | low | reject | Sure's view computes `Date.current + 7` when it renders, so a page left open behaves alike; the sheet's read refetches on focus. |
| 8 | Spec tasks unticked, tracking not `done` | low | patch | Step 5 ticks them and sets both to `done`. |
| 9 | The epic's `bills.description` criterion is not restated in the spec | false | reject | The diff rewrites `bills.description` to « l'ignorer ou la reporter d'une semaine ». |
| 10 | The menu sits inside « Marquer comme payée »'s box | low | reject | Sure's `show.html.erb:283-300` puts the menu in the same row as « Marquer comme payée ». |
| 11 | No undo after a postpone or a skip | false | reject | Sure offers none; « Rouvrir » undoes a skip, as in Sure. |
| 12 | « Ignorer » and « Reporter d'une semaine » can both run while the other is pending | low | patch | Both items are disabled while either mutation is pending. |
| 13 | The e2e check after a skip filters on « Reportée au » only | low | reject | Pre-existing assertion; the sheet's « Ignorée » and « Rouvrir » prove the skip. |
| 14 | The criterion's « Reportée au » row label shows only when the snooze passes the due date | false | reject | The e2e row is due tomorrow, so its label reads « Reportée au {{today + 7}} », as Sure's `due_label`. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- The week counts from today in `APP_TIMEZONE`, which the client reads as the row's `effectiveDueOn` less its `days`, both computed by the server on the read; Sure's view computes `Date.current + 7` on render, on the server's day as well. No new route: Sure's `snooze` takes a date too.
- A bill due further than a week out keeps its due date when postponed, as Sure's `effective_due_on` is the later of the two.
- An occurrence's amount already overridden, by an earlier version or the assistant, keeps its amount; the API still clears or sets it, as Sure's `override_amount` route.

## Verification

**Commands:**
- `pnpm --filter @archant/app exec vitest run src/lib/dates.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
