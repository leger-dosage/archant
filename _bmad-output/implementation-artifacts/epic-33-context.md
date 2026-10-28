# Epic 33 Context: Bills as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's bills and recurring series back to Sure's behaviour at revision `00dd977fb`. A review of the Sure parity table found departures with none of the admitted reasons (money as integer minor units, French text, accessibility contrast, security); each story removes one and follows Sure's code, views and French locale.

## Stories

- Story 33.1: Retire stale bills from the cleanup button only
- Story 33.2: Date a monthly bill's next payment as Sure
- Story 33.3: Leave a renamed series behind
- Story 33.4: Declare a bill from any transaction
- Story 33.5: Postpone an occurrence a week
- Story 33.6: Search any transaction to pay an occurrence
- Story 33.7: Show a bill's drawer in full
- Story 33.8: Price notices and autopay tone
- Story 33.9: Turn recurring transactions off

## Requirements & Constraints

- Sure settles behaviour: its identifier claims or creates series and never deletes one; its cleaner runs only from « Nettoyer les obsolètes »; a renamed series leaves its twin, which the cleaner retires.
- Money stays integer minor units with a currency; interface text is French, using the words Archant already uses.
- Every story keeps `docs/sure-parity.md` and, when a decision changes, `docs/architecture.md` in step with the code.

## Technical Decisions

- AD-24 governs recurring: pure functions in `domain/recurring/` (identifier, schedule, matcher, series helpers), writes in `services/recurring/` inside one immediate transaction run after an import, a revert, a sync, or the detection buttons.
- A series' key is its merchant, else its normalised label, plus account, currency and `dedup_scope`; a unique index guards it.
- Payments and price changes reference their entry with `ON DELETE SET NULL`; nothing in detection deletes a series.

## Cross-Story Dependencies

- Stories 33.1 and 33.3 both change `detectWithin` in `packages/api/src/services/recurring/series.ts`; 33.1 landed first.
- No other ordering inside the epic.
