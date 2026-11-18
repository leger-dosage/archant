---
title: "Story 33.9: Turn recurring transactions off"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: '271ff185f1bd6b4e6c14f6ff444dd8baacbc03c7'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) lets a family turn recurring transactions off: `families.recurring_transactions_disabled`, set by the switch on `recurring_transactions/index.html.erb` through `update_settings`, read by the jobs (`identify_recurring_transactions_job.rb`, `generate_recurring_occurrences_job.rb`), the navigation (`application_helper.rb#bills_nav_item`), the Bills controllers (`recurring_feature_guardable.rb#ensure_recurring_enabled`), the transactions tabs (`transactions/index.html.erb:50`), the transfer (`transfers_controller.rb#mark_as_recurring`, `@can_mark_as_recurring_transfer`) and the assistant's bill tools (`bills_support.rb`). Archant has no switch.

**Approach:** a `settings` row `recurring_transactions_disabled`, absent meaning on, read and written by `GET`/`PUT /api/recurring/settings`. The automatic runs and the daily generation skip when it is off; the Bills routes, the transfer's « Marquer comme récurrent » and the six bill tools refuse; the interface hides what Sure hides. Nothing is deleted.

## Boundaries & Constraints

**Always:** Sure's gates. Off: sync, import and Sure import skip `runRecurring`; the day's first request claims the day and generates nothing. Refused with `403 RECURRING_DISABLED`: the Bills surfaces Sure guards, `GET /api/recurring/bills`, `/bills/all`, `/upcoming`, `/candidates`, `/picker`, `POST /declare`, `GET`/`PATCH /:id`, `/occurrences/*`, `/payments/*`, and `POST /api/transfers/:id/recurring`. Kept, as Sure keeps them (« historical reach »): `GET /`, `POST /` (a transaction's « Marquer comme récurrent »), `/by-entry/:entryId`, `DELETE /:id`, `/detect`, `/cleanup`. Bill tools `get_bills`, `get_bill_details`, `get_bill_audit`, `create_bill`, `update_bill`, `record_bill_payment` refuse with Sure's `{ error, hint }` verbatim. Interface off: no « Factures » in the rail or « Plus »; `/bills` and `/bills/$billId` redirect home; `/transactions` shows the list without tabs; a transfer's « Paramètres » hides « Marquer le virement comme récurrent »; « Réglages › Transactions récurrentes » shows only the switch, as Sure's `unless` blocks. The switch toasts « Paramètres des transactions récurrentes mis à jour ». A viewer cannot open the settings page (settings layout); the setting's `GET` is open to every member, its `PUT` refused to a viewer by `viewerReadOnly`.

**Never:** no migration (a `settings` row), no series, occurrence or payment deleted or changed by the switch, no gate on `get_recurring_transactions` (Sure's is ungated), no preview gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh install | no row | `{ enabled: true }`, everything as before | none |
| Switch off, sync | active series | no detection, no occurrence; series kept | none |
| Switch off, first GET of day | day unclaimed | day claimed, nothing generated | none |
| Switch off | `GET /api/recurring/bills` | 403 `RECURRING_DISABLED` | toast from code |
| Switch off | `POST /api/transfers/:id/recurring` | 403, « Les transactions récurrentes sont désactivées pour ce foyer » | toast |
| Switch off | `get_bills` | `{ error: "Bills & recurring transactions are disabled for this family", hint }`, `isError` | none |
| Switch on again | | bills reappear, next run generates | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: files above; `config/locales/views/recurring_transactions/fr.yml:173-175,177,208`.
- `packages/api/src/services/recurring/switch.ts` -- new: `recurringEnabled`, `setRecurringEnabled`, `ensureRecurringEnabled` (throws `RECURRING_DISABLED`).
- `packages/api/src/lib/errors.ts` -- `RECURRING_DISABLED: 403`.
- `packages/api/src/services/recurring/pipeline.ts` -- `runAutomaticRecurring` for sync, `imports.ts`, `sure-import.ts`.
- `packages/api/src/services/recurring/occurrences.ts` -- `startDailyOccurrences` claims, runs nothing when off.
- `packages/api/src/routes/recurring.ts` -- `/settings` before `/:id`; a gate middleware on the guarded paths.
- `packages/api/src/services/recurring/bills.ts` -- `markTransferRecurring` checks the switch first.
- `packages/app/src/components/TransactionLinks.tsx` -- no « Créer une facture » nor « Ouvrir » while off.
- `packages/api/src/mcp/bills.ts` -- `refuseWhenDisabled` at the top of each tool's `run`.
- `packages/app/src/hooks/useRecurring.ts` -- `recurringSettingsQuery`, `useRecurringEnabled`, `useSaveRecurringSettings`.
- `packages/app/src/components/AppShell.tsx`, `routes/_authed.bills.tsx` (`beforeLoad`), `routes/_authed.transactions.tsx`, `components/TransferDetails.tsx`, `routes/_authed.settings.recurring.tsx`, `locales/fr.json`.
- Tests: `routes/recurring.spec.ts`, `routes/transfers.spec.ts`, `services/recurring/pipeline.spec.ts`, `services/recurring/occurrences.spec.ts`, `mcp/bills.spec.ts`, `e2e/bills.spec.ts`.
- `docs/sure-parity.md` « Feature switch and preview gate ».

## Tasks & Acceptance

**Execution:**
- [x] Failing Vitest first: settings round trip and default, each gated route, the kept routes, the transfer refusal, the automatic run and the daily run skipped, the six tools' refusal.
- [x] `switch.ts`, error code, pipeline, daily, routes, transfer, tools.
- [x] Interface: hook, rail, `/bills` guard, tabs, transfer row, settings page, `fr.json`.
- [x] `bills.spec.ts` e2e: turn the switch off, no « Factures », `/bills` leads home, no « À venir », back on.
- [x] `docs/sure-parity.md`; story, Epic 33 and `sprint-status.yaml` to `done`.

**Acceptance Criteria:**
- Given « Réglages › Transactions récurrentes », then « Activer les transactions récurrentes » with Sure's description sits at the top, on by default, and saves the household setting.
- Given the switch off, then no detection or generation runs from a sync, an import or the day's first request, and no series is deleted.
- Given the switch off, then « Factures » leaves the navigation, `/bills` leads home, `/transactions` shows no « À venir », the settings page hides « Identifier les modèles » and « Nettoyer les obsolètes », and a transfer's « Marquer comme récurrent » is refused with « Les transactions récurrentes sont désactivées pour ce foyer ».
- Given the switch off, then each bill tool answers Sure's refusal.
- Given the finished story, `pnpm test` and `pnpm test:e2e` pass.

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the code diff since the baseline; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A transaction's sheet still offers « Créer une facture » and « Ouvrir » to the bill while off | medium | patch | `TransactionLinks.tsx` hides both while off: the dialog's `/candidates` and `/declare` answer 403 and the drawer leads home, as Sure's `new` and `bills#show` redirect. |
| 2 | The `/bills` guard reads a cached setting another browser may have changed | low | patch | `ensureQueryData` gets `revalidateIfStale`, so the next navigation reads it again. |
| 3 | While the setting loads, `?tab=upcoming` mounts « À venir » and the transfer shows its row | low | reject | One request on a first load; on by default avoids moving the rail on every load, and the server refuses anyway. |
| 4 | The settings page shows nothing if the setting fails to load | low | reject | Every page reads this way on a failed query; the global error toast covers it. |
| 5 | `docs/sure-parity.md` and the tracking files are not updated | false | reject | Done at finalisation, in the same pull request. |
| 6 | The transfer check sits in the route, not in `markTransferRecurring` as the Code Map says | low | patch | Moved into the service, so any caller is refused. |
| 7 | No test of a viewer's `PUT /settings` or a malformed body | low | reject | `viewerReadOnly` and `validated` are tested generically for every route. |
| 8 | The transfer test turns the switch back on without `finally` | low | patch | Wrapped in `try`/`finally`. |
| 9 | The pipeline test sits in the route spec, not `pipeline.spec.ts`; sync and import tests stub the gated run | low | reject | `runAutomaticRecurring` is tested directly against a database, off then on; the callers' tests prove they call it. |
| 10 | The daily test only checks one date is missing | low | patch | It now compares every due date before and after. |
| 11 | No end-to-end check of « Plus » on a phone or the transfer's row while off | low | reject | Both read the same `useRecurringEnabled` as the tested rail; the server refusal is tested. |
| 12 | The guard comment's « deletion » also reads as a payment's | low | patch | Now « deleting a series ». |
| 13 | A failure of `recurringEnabled` after the claim loses the day's run | low | reject | One indexed read right after a successful write; the next sync generates. |
| 14 | Turned on again, today's occurrences wait for a sync or the next day | false | reject | Design note: as Sure's nightly job, which waits for the next night. |
| 15 | `POST /detect` still runs while off | false | reject | Sure's `identify` keeps its reach; the button is hidden, as Sure's. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- The row stores Sure's column, `recurring_transactions_disabled`, `"true"` or `"false"`; absent reads as on, Sure's `default: false`.
- `/detect`, `/cleanup`, the series list, a transaction's « Marquer comme récurrent » and deletion stay open server-side, as Sure's `RecurringTransactionsController` leaves `index`, `identify`, `cleanup`, `destroy` and `TransactionsController#mark_as_recurring` ungated; the interface hides the two buttons.
- The API answers `403 RECURRING_DISABLED` where Sure's HTML controllers redirect home; the interface redirects `/bills` home itself, as Sure.
- « pour ce foyer » rather than Sure's « pour cette famille »: Archant calls the household « foyer » everywhere.
- The daily run still claims its day when off, so turning the switch on the same day waits for the next sync or day, as Sure's nightly job waits for the next night.
- `/upcoming` is gated: Sure's « À venir » tab is its only reader, and it is hidden when off.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/routes/recurring.spec.ts src/mcp/bills.spec.ts src/services/recurring/pipeline.spec.ts src/services/recurring/occurrences.spec.ts src/routes/transfers.spec.ts` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
