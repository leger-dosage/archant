---
title: 'Story 9.2: Recurring transactions page'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '9f996cbe3286beed2024f9f6bbd2d2cf2cbf00b6'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-9-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 9.1 stores recurring patterns nobody can see, confirm or reject, and a stale pattern stays current forever (FR41).

**Approach:** Give each stored item a status and a manual flag, teach detection to respect them, and add the `/recurrences` page with confirm, deactivate, dismiss and "Détecter", plus an "Ajouter aux récurrences" action in the transaction sheet.

## Boundaries & Constraints

**Always:**
- Migration `0025`: `status` text, check on `RECURRING_STATUSES = ["detected", "confirmed", "inactive", "dismissed"]`, default `detected`; `manual` integer boolean, default false. Existing rows become `detected`.
- Detection, per stored row matched by key: `dismissed` is neither updated nor recreated; any other status gets its label, day, dates and count updated and keeps its status. Detection never reactivates an `inactive` row, as in Sure. After the upserts, every `detected` row whose `last_occurrence_date` is before `addMonths(today, -2)` becomes `inactive`. `confirmed` rows never change status through detection.
- `next_expected_date`: the expected-day date nearest to one month after the latest row (fixes the 9.1 deferred entry: 07-01, 08-02, 08-31 give 10-01, not 09-01).
- User transitions: confirm (`detected` or `inactive` → `confirmed`), deactivate (`confirmed` → `inactive`), dismiss (any but `dismissed` → `dismissed`). Anything else answers `VALIDATION_ERROR`; an unknown id answers `NOT_FOUND`.
- Manual add, `POST /api/recurring { entryId }`: account, merchant or else `normalizeLabel(label)`, label, amount, currency, the date's day, last date = the date, count 1, next date = the first expected-day date on or after today, `status: confirmed`, `manual: true`. An existing row with the same key becomes `confirmed` instead, `dismissed` included. A transfer side answers `VALIDATION_ERROR`; an unknown or non-transaction entry `NOT_FOUND`.
- `GET /api/recurring` returns every row but `dismissed`, unpaginated like merchants, with account name and merchant name joined; `detected` and `confirmed` first, then `inactive`, each by `next_expected_date`, then id.
- Page `/recurrences`: sidebar entry after Opérations, `g r`, command palette. A table: name (merchant, else label), account, amount through `<Money>`, next date in French, a status badge (Détectée, Confirmée, Inactive) and « Ajoutée à la main » when manual. Row menu per allowed transition; dismiss goes through `ConfirmDialog`. « Détecter » calls `POST /api/recurring/detect` and toasts the count. Empty, loading and error states follow `_authed.regles.tsx`.
- Sheet: « Ajouter aux récurrences » on a saved transaction that is not a transfer side; success toasts and invalidates the list.

**Never:** no link between a recurring row and an entry; no new error code; no "upcoming" tab, projection or dashboard widget; no amount variance (Sure's min/max/avg); no feature toggle; no deletion of rows by detection; no amount or label in a log.

## I/O & Edge-Case Matrix

| Scenario | State (today 2026-09-21) | Expected |
|----------|--------------------------|----------|
| Stale detected | `detected`, last 07-15 | `inactive` after detection |
| Stale confirmed | `confirmed`, last 06-01 | stays `confirmed` |
| Fresh inactive | `inactive`, pattern detected again | dates updated, stays `inactive` |
| Dismissed | `dismissed`, pattern still detected | row untouched, no new row |
| Manual kept | manual row, no pattern found | untouched |
| Manual over detected | `detected` row, add from one of its rows | same row, `confirmed` |
| Early month end | rows 07-01, 08-02, 08-31 | next 10-01 |
| Deactivate detected | `detected` | `VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/recurring-transactions.ts` -- add columns and check; `schema/imports.ts` 24 and 97 model the `const` array plus `inList` check. `pnpm --filter @archant/data generate --name add_recurring_status`; `migrate.spec.ts` recurring `describe`.
- `packages/api/src/domain/recurring.ts` -- `detectRecurring` 93, next date at 144; add the nearest-date rule, the stale test (`isStale(lastDate, today)`) and the manual next date here, pure. `domain/dates.ts` `withDay` 77, `addMonths`.
- `packages/api/src/services/recurring.ts` -- `detectRecurring` 45: load `status` with the key, skip `dismissed`, then the inactive update in the same transaction. Add `listRecurring`, `setRecurringStatus`, `addRecurringFromEntry`.
- `packages/api/src/services/ledger.ts` -- `findTransaction` 2721 for the manual add; `listTransactions` 2947 models the account join. Do not write ledger tables.
- `packages/api/src/routes/recurring.ts`, `schemas/recurring.ts` -- GET `/`, POST `/`, PATCH `/:id { status }`; `routes/merchants.ts` and `schemas/merchants.ts` 14–19 are the model. `services/merchants.ts` 22 for the `NOT_FOUND` factory.
- `packages/web/src/routes/_authed.recurrences.tsx` (new), `hooks/useRecurring.ts`, `lib/query-keys.ts` 49 -- model `_authed.regles.tsx` and `useRules.ts`; `components/ui/table.tsx`, `ui/badge.tsx`, `ConfirmDialog.tsx`, `lib/error-toast.ts`, `lib/balance-change.ts` date formatters.
- `packages/web/src/components/AppSidebar.tsx` 183, `lib/shortcuts.ts` 15 (`goRecurring`, `g>r`, free), `routes/_authed.tsx` 51, `CommandPalette.tsx` 118, `lib/shortcuts.spec.ts` 75.
- `packages/web/src/components/TransactionSheet.tsx` -- a block beside `TransferBlock` 297.
- `packages/web/src/locales/fr.json` -- `nav.recurring`, `shortcuts.labels.goRecurring`, `recurring.*`.
- Tests: `services/recurring.spec.ts` (fake clock, fresh DB per test), `app.spec.ts` 6249, `e2e/fixtures.ts` (`api.addTransaction`, `daysAgo`, `uniqueName`), `e2e/rules.spec.ts` as model.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data` -- failing migrate tests for the status check and default, then schema and migration `0025`.
- [x] `domain/recurring.spec.ts`, `recurring.ts` -- matrix rows « Early month end », the stale boundary at exactly two months, manual next date on and after today's day and on the 31st.
- [x] `services/recurring.spec.ts`, `services/recurring.ts` -- every other matrix row, list order, each transition and its refusals, manual add including the key collision and the transfer refusal.
- [x] `routes/recurring.ts`, `schemas/recurring.ts`, `app.spec.ts` -- GET, POST, PATCH envelopes, `NOT_FOUND` and `VALIDATION_ERROR`.
- [x] `packages/web` -- hook, page, sidebar, shortcut, palette, sheet action, `fr.json`, `shortcuts.spec.ts`.
- [x] `packages/web/e2e/recurring.spec.ts` -- the acceptance criteria below.

**Acceptance Criteria:**
- Given three monthly rows entered through the API, when I press « Détecter » on `/recurrences`, then a row shows the label, account, amount and next date, and rows are ordered by next date.
- Given a detected item, when I confirm it, then its badge reads « Confirmée ».
- Given a detected item, when I dismiss it and confirm the dialog, then it disappears and stays gone after « Détecter ».
- Given a transaction, when I choose « Ajouter aux récurrences » in its sheet, then `/recurrences` lists it as confirmed and « Ajoutée à la main », and it stays after « Détecter ».
- Given `g r`, when pressed outside a field, then `/recurrences` opens.

## Implementation Notes

- Migration `0025` edited by hand, as `0012` was: drizzle-kit copied `status` and `manual` from the old table, which has neither; existing rows become `detected`, not manual.
- `domain/recurring.ts` exports `nextExpectedDate`, `nextDateFrom` and `isStale`. The stale test reads the last date this run computed, so a pattern found again after a gap stays `detected`.
- `POST /api/recurring` answers 200 whether it inserts or confirms; refusals carry `{ path, code: "invalid_value" }` on `status` or `entryId`. A manual add on an existing key changes only its status.
- The manual add refuses an entry only when `direction()` calls it a transfer, so a loan payment or contribution outflow, which detection groups, can be added too.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind, edge | A confirmed or inactive row detection does not find again keeps a past next date; a manual add or confirm on an old row keeps its old dates | medium | defer: detection only refreshes rows it finds, as Sure's identifier; logged in `deferred-work.md` |
| 2 | blind | A merchant merge cascades and drops a manual single-occurrence row, which detection cannot recreate | low | rejected: merging a merchant that carries a manual pattern is rare, and repointing rows in `mergeMerchant` adds a branch and a unique-key collision case |
| 3 | blind, edge | `findTransaction` runs outside the write transaction | low | rejected: one user; a delete racing the click is unlikely and fails loudly |
| 4 | blind | The sheet toast says « ajoutée » when an existing row is only confirmed | low | rejected: the item is in the list either way |
| 5 | blind, edge | « Ajouter aux récurrences » sends the saved values while the form holds unsaved edits | low | patch: button disabled while the form is dirty |
| 6 | blind | `detected` counts rows already confirmed or inactive | low | rejected: 9.1 defined it as patterns found |
| 7 | blind | The PATCH schema accepts `detected` | low | rejected: the service refuses it with `VALIDATION_ERROR`, tested |
| 8 | blind | The `queryKeys.recurring` comment says detection runs apart from transaction writes | low | patch: comment corrected |
| 9 | blind | « Écarter » stays enabled while a status change is pending | low | patch |
| 10 | blind | The web `RecurringStatus` shares a name with the four-value data type | low | patch: renamed |
| 11 | blind | The `ghost` badge has only hover styles | low | patch: outline, muted |
| 12 | blind | `app.spec.ts` lacks the HTTP transfer refusal and the dismissed filter | low | rejected: both are service tests; the route adds no logic |
| 13 | blind | The 0025 snapshot is missing from the diff | false | excluded from the review diff as generated; present in the tree |
| 14 | blind | Spec and sprint statuses differ | false | statuses move at their own workflow steps |
| 15 | edge | The manual add refuses a loan-payment or contribution outflow that detection groups | medium | patch: refuse only when `direction()` returns `transfer`, in the service and the sheet |
| 16 | verification-gap | No test for a stale `detected` row found again this run | medium | patch: service test |
| 17 | verification-gap | No test for a stale `dismissed` row staying `dismissed` | medium | patch: service test |
| 18 | verification-gap | « Désactiver » is untested in the interface | low | patch: step added to the confirm e2e test |

## Design Notes

Taken from Sure: the manual flag, next date from today for a manual item, the two-month stale threshold, no reactivation by detection, `status, next date` ordering, dismiss confirmed by a dialog. Departures, all from `epics.md`: Sure has no confirmed status and deletes on dismiss, so its pattern comes back; here `dismissed` is a kept row that blocks the key. Manual items start `confirmed`, so the six-month manual threshold Sure uses is not needed. A merchant merge still cascades and drops the source's confirmed and dismissed rows; the next detection recreates them as `detected`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.
