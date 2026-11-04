# Epic 34 Context: Dashboard and reports as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's dashboard, reports and a few layout details back to Sure's behaviour at revision `00dd977fb`. A review of `docs/sure-parity.md` found departures with none of the admitted reasons (integer money, French text, accessibility contrast, security); each story removes one. The owner chose Sure's layout under Archant's own visual style, inspired by Linear: colours, Inter and shadows stay; where Sure opens a drawer or lays out cards, Archant follows.

## Stories

- Story 34.1: Group the balance sheet by account type
- Story 34.2: Draw charts' axes as Sure
- Story 34.3: Pick the dashboard period
- Story 34.4: Cash flow widgets
- Story 34.5: Investment summary on the dashboard
- Story 34.6: Arrange the dashboard
- Story 34.7: The reports page, its CSV and print layout
- Story 34.8: Import files and edit rules on a phone
- Story 34.9: Sure's few hotkeys
- Story 34.10: Sure's layout under Archant's visual style

## Requirements & Constraints

- Sure settles behaviour: its views, controllers, scripts and `fr.yml` are the reference; where Sure's French has no key, Archant writes the words a French user expects.
- Money stays integer minor units with an ISO 4217 currency; a display rounding (Sure's `precision: 0`) is formatting only.
- The interface reads in English or French (Epic 37): every visible string goes through both `locales/fr.json` and `locales/en.json`.
- Each story moves its row of `docs/sure-parity.md` to Parity, or records an admitted difference.

## Technical Decisions

- Group totals come from the API (`GET /api/accounts`): active, included in reports, in the reporting currency (AD-6); the interface never recomputes them.
- Dashboard figures read `services/reports.ts` and `domain/cash-flow.ts` (AD-6, AD-8, AD-9).
- A control that writes shows only for an administrator (`useIsAdmin()`); viewers write nothing (AD-21).

## Cross-Story Dependencies

- Stories 34.1, 34.2, 34.8, 34.9 and 34.10 come in any order.
- Story 34.3 comes before 34.4, 34.5 and 34.7; Story 34.6 follows 34.4 and 34.5.
- The transfer, bill, bulk-edit and split drawers belong to Stories 31.6, 33.7, 31.2 and 31.3; the goals card leaves the dashboard with Story 35.10.
