---
title: "Story 33.1: Retire stale bills from the cleanup button only"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'a29af7f8'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) retires a stale bill only when the owner asks: `RecurringTransaction::Cleaner#cleanup_stale_transactions` runs from `RecurringTransactionsController#cleanup` alone, behind « Nettoyer les obsolètes », and `Pipeline#run!`, the post-sync job's, the « Identifier les modèles » button's and the bills page's detection, never calls it. Neither the identifier nor the cleaner deletes a `suggested` series; Sure's cleaner deletes only old inactive non-manual series, which Archant never ported. Archant's `detectWithin` ends with `clean`, so every sync, import, revert and « Identifier les modèles » turns a stale active series `inactive`, and both `cleanerSteps` (its `deleted` step) and `refreshSeries` (its `delete` kind) delete a suggestion with no row left in its window.

**Approach:** `detectWithin` in `packages/api/src/services/recurring/series.ts` stops calling `clean`; `cleanupRecurring` keeps it, unchanged in what it retires. `cleanerSteps` in `packages/api/src/domain/recurring/series.ts` loses its `deleted` step and returns the ids to retire; `clean` loses its deletion. `refreshSeries` loses its `delete` kind: a suggestion with no row left is left as it is.

## Boundaries & Constraints

**Always:** « Nettoyer les obsolètes » retires exactly what it retires today, Sure's `staleness_threshold_date` and recent-match test unchanged, a recurring transfer included; a series retired by the button loses its future occurrences, as any status change; detection still refreshes every series but an ended one or a recurring transfer, and still generates the active ones' occurrences.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no migration; no change to the threshold; no deletion of an old inactive series (Sure's `remove_old_inactive_transactions` stays unported); no change to the rename handling in `rekey` (Story 33.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stale active, detection | active series, last row before `staleBefore`, no recent row | stays `active` after `runRecurring`, a revert or an import | none |
| Stale active, button | same series | `cleanupRecurring` answers `{ inactive: 1 }`, series `inactive`, future occurrences gone | none |
| Rowless suggestion, detection | `suggested`, no row left in its window (time, revert, rename) | stays `suggested`, unchanged | none |
| Rowless suggestion, button | same | stays, `{ inactive: 0 }` | none |
| Stale manual bill | declared, six months unpaid | `active` after detection, `inactive` after the button | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/models/recurring_transaction/pipeline.rb` (`run!`, no `Cleaner`), `app/models/recurring_transaction/cleaner.rb` (`cleanup_stale_transactions`), `app/controllers/recurring_transactions_controller.rb#cleanup`, `app/models/recurring_transaction/identifier.rb` (no deletion), `config/locales/views/recurring_transactions/fr.yml` (`cleaned_up`).
- API: `domain/recurring/series.ts` (`cleanerSteps`, `refreshSeries`, `SeriesRefresh`), `services/recurring/series.ts` (`clean`, `detectWithin`, `cleanupRecurring`).
- Tests: `domain/recurring/series.spec.ts` (`refreshSeries`, `cleanerSteps`), `services/recurring/series.spec.ts` (`cleanupRecurring`, « detection and statuses », reverts, renamed series).
- Tests: `routes/imports.spec.ts` (a revert keeps the suggestion it empties).
- Interface: `locales/fr.json` `settings.recurring.info` keeps its sentences: they already describe the button and say detection runs after an import, a revert and a sync.
- Docs: `docs/sure-parity.md` « Inactive » row; « Renamed series » already says detection never deletes a series, which now holds.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: detection leaves a stale active series and a stale manual bill active; the button retires them; a rowless suggestion survives detection, a revert and the button.
- [x] `cleanerSteps` returns the ids to retire only; `refreshSeries` has no `delete` kind.
- [x] `detectWithin` without `clean`; `clean` without deletion.
- [x] Docs, story and sprint status, Epic 33 in progress.

**Acceptance Criteria:**
- Given an active series past Sure's `staleness_threshold_date` with no recent row, when a sync, an import, a revert or « Identifier les modèles » runs detection, then it stays `active`.
- Given the same series, when the administrator presses « Nettoyer les obsolètes », then `cleanupRecurring` makes it `inactive` and the toast counts it.
- Given a `suggested` series whose transactions were all deleted, when detection or the cleanup runs, then the suggestion stays.

## Design Notes

Assumptions taken alone, each settled by Sure or by an Archant convention:

- The toast keeps Archant's `recurring.cleaned_*` texts, « {{count}} récurrence devenue inactive », « {{count}} récurrences devenues inactives » and « Aucune récurrence obsolète », where the story quotes Sure's « %{count} transactions récurrentes obsolètes nettoyées »: it is the same message, Archant calls a series « récurrence » on every toast of the page (« récurrences détectées »), and its singular and zero forms are correct French where Sure's single string is not. The story says no screen changes and Playwright stays unchanged, which only holds with the current wording.
- A rowless suggestion is left as it is, count and dates included, as Sure, which never touches an unclaimed non-manual series: a count of 0 would read « Vue une fois » under the suggestion, French plurals treating 0 as singular. A pattern found again claims it, as any suggestion.
- A suggestion whose rows were renamed away now stays beside the new key's suggestion until the owner ends it, as Sure's twin; Story 33.3 settles renames.
- A stale active bill keeps its open occurrences and gets new ones, so it shows as overdue on « Factures » and in the assistant's bill tools until « Nettoyer les obsolètes » retires it, as Sure's pipeline generates every active series' occurrences.
- Upgrade: nothing stored changes. A series detection already made inactive stays inactive; a suggestion detection already deleted comes back only if a later detection finds its pattern again. From the upgrade on, a stale bill stays active until « Nettoyer les obsolètes » is pressed, and a suggestion with no row left stays listed until ended.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `a29af7f8`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent. The Verification Gap layer found no gap.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A rowless suggestion kept with count 0 reads « Vue une fois » under its name | medium | patch | `RecurringSuggestions.tsx` renders `recurring.suggested.seen` with the count, and i18next's French plural maps 0 to `seen_one`. `refreshSeries` now leaves such a suggestion as it is, count included, as Sure. |
| 2 | A rowless suggestion keeps a past next date | low | reject | Sure leaves an unclaimed suggestion untouched; the suggestions list shows no date. |
| 3 | A new pattern beside a kept dead suggestion of the same key gets a second-tier `dedupScope` | low | reject | Sure's identifier does the same, the dead series being kept there too. |
| 4 | The stale active test switched to `backfill: true`, leaving the sync path unasserted | low | patch | It now runs `backfill: false`, the sync's, import's and revert's path, then `true`, « Identifier les modèles ». |
| 5 | A stale active bill keeps generating overdue occurrences, in totals and the bill audit | low | reject | Sure's `Pipeline#run!` generates every active series' occurrences until the cleaner runs; recorded in Design Notes and the upgrade note. |
| 6 | The toast keeps Archant's text, not the story's quoted Sure string | low | reject | Archant's word for a series and its plural forms are kept, as the brief's language rule asks; recorded in Design Notes. |
| 7 | The spec misquoted the toast keys | low | patch | Design Notes name `recurring.cleaned_*` and their exact texts. |
| 8 | « Renamed series » parity row still says the cleaner retires the old twin | false | reject | The row's Archant column describes `rekey`, Story 33.3's subject, and its « Detection never deletes a series » now holds. |
| 9 | No test imports or reverts on a stale active series | low | reject | Sync, import, revert and the button all call `runRecurring`, whose `detectWithin` no longer calls `clean`; the revert test covers the suggestion. |
| 10 | Upgrade note silent on series already retired or deleted | low | patch | Design Notes and the PR say both. |
| 11 | `clean` has a single caller and could fold into `cleanupRecurring` | low | reject | A naming preference with no named harm. |
| 12 | The `current` map's comment says later passes read it | false | reject | The claiming, insertion and refresh passes still read it. |
| 13 | Tasks unticked and the departures review not marked | low | reject | Tasks ticked at step 3's close; the departures review is a dated record mapped to stories, never edited by them. |
