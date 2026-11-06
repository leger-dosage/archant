# Epic 34 Context: Dashboard and reports as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's dashboard, reports and layout back to Sure's behaviour at revision `00dd977fb`. The parity review found departures with no admitted reason; each story removes one. The owner chose Sure's layout under Archant's own visual style, inspired by Linear: colours, Inter and shadows stay; where Sure opens a drawer or lays out cards, Archant follows.

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
- Story 34.11: Sure's investment sections on the reports page

## Requirements & Constraints

- Sure settles behaviour: its views, controllers, scripts and locale files are the reference. Where Sure's French has no key, Archant writes the words a French user expects.
- An admitted difference needs integer money, appropriate French text, accessibility contrast, security, or a recorded owner decision. Each story moves its row of `docs/sure-parity.md` to Parity, or records its admitted difference.
- Money stays integer minor units with an ISO 4217 currency. Display rounding changes formatting only. Amounts retain the account-point-of-view sign convention; presentation must not change stored signs.
- Every visible string has French and English translations. Routes and search parameters stay English.
- The dashboard shares one period across its widgets. Report review includes its own selected period, export and print presentation. User layout preferences persist across visits.
- Import and rule management work on phones, overriding their earlier laptop-only scope. Privacy mode remains outside this epic.

## Technical Decisions

- Totals are computed on the server. Reporting includes active accounts not excluded from reports, in the reporting currency. Accounts in other currencies are left out and named until currency conversion exists.
- One money representation and one account-type definition serve the interface and server. Securities and crypto accounts retain their existing ledger and cost-basis contracts.
- Cash-flow classification has one shared domain rule. Reports must preserve the distinction between cash flow, securities trading and portfolio value rather than reuse an unrelated total.
- A read writes nothing. Administrators may save layout or data changes; viewers read without write controls. The server enforces the same permissions.
- Existing bank data, amounts and identifiers must not enter logs or error reports. Export, report and investment work introduces no external data transmission.

## UX & Interaction Patterns

- Sure determines layout and interaction; Archant retains its colours, Inter typography and shadows in both appearances. Accessibility contrast takes precedence over an exact colour match.
- Use the existing page, card and inset layering. Charts follow Sure's restrained axes and grid treatment.
- Dashboard widgets and report sections support persistent arrangement and collapse according to their respective Sure layouts. Export and print belong to report review.
- Keep keyboard operation and visible focus available. Drawers, responsive layouts and a few explicit shortcuts follow Sure; do not introduce a general shortcut system.

## Cross-Story Dependencies

- Stories 34.1, 34.2, 34.8, 34.9 and 34.10 come in any order.
- Story 34.3 comes before 34.4, 34.5 and 34.7; Story 34.6 follows 34.4 and 34.5; Story 34.11 follows 34.7.
- The transfer, bill, bulk-edit and split drawers belong to Stories 31.6, 33.7, 31.2 and 31.3. Story 34.10 leaves them to those stories. The goals card leaves the dashboard with Story 35.10.
