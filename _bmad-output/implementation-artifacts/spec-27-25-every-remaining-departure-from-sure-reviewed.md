---
title: 'Story 27.25: Every remaining departure from Sure reviewed'
type: 'chore'
created: '2026-10-13'
status: 'done'
baseline_commit: '6b42fb2348a87082150773bfcc6e0c8496536c9d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/sure-departures-review-2026-10-12.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `docs/sure-parity.md` still holds about 110 departures from Sure after Stories 27.1 to 27.24; most cite an AD-n, a spec, scope or nothing, none of the four reasons the owner admits (integer money, French text, accessibility contrast, security), and about 30 rows no longer describe the code or Sure.

**Approach:** Apply the row-by-row review in `sure-departures-review-2026-10-12.md`, read against Sure `00dd977fb`: each departure cites an admitted reason, becomes a story of Epics 28 to 36 in `epics.md`, or becomes a decision the owner took; stale rows are corrected.

## Boundaries & Constraints

**Always:**
- Each verdict of the review lands exactly once: R1–R4 as the row's cited reason; S-n as a story in `epics.md`, the row set to Later citing it; D-n as the owner's answer written into the row; Fix as the corrected text. A sub-difference is never both a story and a decision.
- Epics 28 to 36 follow the review's catalogue: goal paragraph, the Sure paths, and per story « As / I want / So that » and Given/When/Then criteria in the style of Epic 27, each ending with its `pnpm test` and `pnpm test:e2e` criterion; the Epic List gains the nine epics; `sprint-status.yaml` gains them as `backlog`.
- `docs/sure-parity.md` keeps its table shape; « How to read this page » adds that a reason is one of the four, and the header names `00dd977fb` as the reading of 27.25.
- Price changes: Parity, the row says so; only the false comment changes.
- Owner's answers of 2026-10-14:
  - D-3: Sure's layout, Archant's own visual style inspired by Linear. Colours, Inter, shadows and the rest of the visual style stay, the row citing the owner's choice; where Archant's layout departs from Sure's (dialogs where Sure has drawers, two loan cards per row on a phone, notes saved by « Enregistrer »), one story « Sure's layout » joins Epic 34. A viewer seeing no write control stays (AD-21, the server decides).
  - D-2: a row whose difference is invisible on screen, in the assistant and in the export reads Parity, its Archant column keeping the internal note.
  - D-4: an Archant addition that leaves Sure's own behaviour untouched stays; its row reads « Parity, plus … ».
  - D-1, D-5, D-7, D-8: nothing is planned for now. Each row keeps its status, its reason reads « Not planned: owner's decision of 2026-10-14 », and no story is written for it.
  - D-6: where Sure has an issue for the defect, Archant keeps its behaviour and the row cites the issue; a critical defect without one got an issue on 2026-10-14 and is cited the same way; a minor one follows Sure as a story. Import keys and the AD-7 tie flags cite Sure #3779 and its fix #3841; the `entry_reference` key cites #3464; convert to trade cites #3057 (excluded entries counted in balances); attachments, tags and notes kept on a pending merge cite #4220. The per-account sync window is D-2: a failed sync never advances Sure's `last_synced_at`, so neither leaves a gap. The disconnect history (S-29.10) and split edits that recreate the lines (S-31.8) follow Sure.
  - Bill labels: Sure's words. `bills.match.name` « Le nom correspond », `bills.match.onDate` « Correspondance de date d'échéance », `bills.review.unknown` « Une transaction », `bills.allView.active` « Actif ».
- Every document in English; Sure's paths verbatim.

**Never:** no code change except the four bill labels of `fr.json` with the Playwright assertions that read them, and the false comment of `packages/api/src/services/recurring/price-changes.ts:73-74`; no Sure commit after `00dd977fb`; no Later row reopened (exchange rates stay Later, AD-6); no AD-n edited, each story edits its own when built; no story written for a D-n answer the owner keeps.

</frozen-after-approval>

## Code Map

- `_bmad-output/implementation-artifacts/sure-departures-review-2026-10-12.md` -- the verdict per row, the decisions and the story catalogue; the source of every edit.
- `docs/sure-parity.md` -- rows cited by line at `6b42fb23`; « How to read this page » lines 7-25.
- `_bmad-output/planning-artifacts/epics.md:378-512` -- Epic List; Epic 27 at 4866 is the style to copy; new epics after the last story.
- `_bmad-output/implementation-artifacts/sprint-status.yaml:236-264` -- Epic 27 block; Epics 28 to 36 after it.
- `_bmad-output/implementation-artifacts/deferred-work.md:259-261` -- budget kind entry, now S-32.1 and S-35.2.
- `packages/api/src/services/recurring/price-changes.ts:73-74` -- the comment says the unique index is Archant's; Sure has it too (`db/schema.rb:2171-2174`).
- `packages/app/src/locales/fr.json:1565,1574,1578,1671` -- the four bill labels.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/planning-artifacts/epics.md` -- Epics 28 to 36 with every S-n story, Epic List entries, dependencies as the catalogue gives them -- the stories the review plans.
- [x] `docs/sure-parity.md` -- every reviewed row rewritten as its verdict and the owner's answers say; header and legend -- the page tells the truth after 27.25.
- [x] `packages/app/src/locales/fr.json` -- the label answers of question 6 -- the only interface change.
- [x] `packages/api/src/services/recurring/price-changes.ts` -- comment states Sure's `update!` fails on its own unique index after the change is recorded -- the behaviour is Sure's.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml`, `deferred-work.md` -- new epics as `backlog`; the budget entry points to its stories.

**Acceptance Criteria:**
- Given `docs/sure-parity.md`, when a row is Different, mixed or Dropped, then it cites one of the four reasons, a story of Epics 28 to 36, or an owner decision, and no row reads « No decision recorded ».
- Given `epics.md`, when an S-n of the review is searched, then exactly one story carries it and no row of the parity page cites it as a decision.
- Given the finished story, when `pnpm format`, `pnpm lint:format` and `pnpm typecheck` run, then they pass.

## Implementation Notes

- Epics 28 to 36 hold 102 stories: the 101 of the catalogue and Story 28.21, activity labels on investment transactions, which Story 32.8's rule action needs and no story brought.
- The parity page's legend admits one status per sub-difference, an owner's decision with its date, and a Sure defect cited by its `we-promise/sure` issue; issue #4220 was opened on 2026-10-14 for attachments, tags and notes lost on a pending merge.
- The « Assistant tools » row, mixed and outside the review's table, was rewritten under the same rules.
- Rows citing « no write control for a viewer » cite the owner's decision of 2026-10-14, as the frozen block says.
- `bills.review.unknown` « Une transaction » has no test reading it; the three other labels are read by `e2e/bills.spec.ts` and `e2e/recurring.spec.ts`.

## Spec Change Log

- Self-review, 2026-10-14: the « Never » line forbade every code change but the comment, while the owner's answer on bill labels changes `fr.json` and the Playwright assertions reading them; the line now names them. Avoids a spec that contradicts its own tasks. KEEP: no other code change.

## Review Triage Log

## Design Notes

The review stays a separate file because 110 verdicts and 102 stories do not fit a spec; the spec decides how they land. A label change in `fr.json` is text the story's own criterion already covers; `pnpm test:e2e` runs only if a label changes, since Playwright tests read labels.

## Verification

**Commands:**
- `pnpm format && pnpm lint:format && pnpm typecheck` -- expected: pass.
- `grep -c "No decision recorded" docs/sure-parity.md` -- expected: 1, the legend only.
