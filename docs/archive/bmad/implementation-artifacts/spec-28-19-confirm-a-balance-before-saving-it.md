---
title: "Story 28.19: Confirm a balance before saving it"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '49f3d9e7ee4e17cd76455c9568c6eac6e2f4cc28'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-28-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure never saves a valuation from its form. `ValuationsController#confirm_create` and `#confirm_update` refuse a blank amount with `valuations.errors.amount_required`, run `Account::ReconciliationManager#reconcile_balance` with `dry_run: true`, and render `valuations/confirm_create` or `confirm_update`: a dialog titled « Confirm new balance » or « Update balance » whose `_confirmation_contents` partial says the balance it sets on its date, splits an investment account's total into holdings and brokerage cash, and warns that every later balance is recomputed; only its button saves. Archant's « Ajouter un solde », « Modifier le solde » and « Solde d'ouverture » save on « Enregistrer » or « Mettre à jour la valeur » at once.

**Approach:** A read-only dry-run route answers Sure's `new_balance` and `new_cash_balance` for a date and an amount. Each of the three forms submits to it, then shows Sure's confirmation step, and only that step's button writes through the existing routes. A blank amount is refused as Sure's `amount_required` before any request.

## Boundaries & Constraints

**Always:**
- `POST /api/accounts/:id/snapshots/dry-run`, body `snapshotBodySchema`, parsed by `createSnapshotSchema(currency)`, writes nothing and answers `{ data: { date, balance, cash } }`. `cash` is Sure's `derived_cash_balance`: the amount less the non-cash part (`balances.balance − balances.cash`) of the account's stored row on exactly that date, `null` when no row holds the date. A viewer is refused by `viewerReadOnly`, as Sure's `require_account_permission!`.
- The ledger reads the row (`reconciliationDryRun` in `services/ledger/snapshots.ts`, AD-2: only the ledger touches `balances`).
- A blank or whitespace balance gives the field code `amount_required`, « Le montant est requis. », in the shared schemas, so the form refuses it before the dry run and the API refuses it alike.
- « Ajouter un solde »: submit → dry run → the same dialog becomes « Confirmer le nouveau solde » with Sure's sentence and « Toutes les transactions et soldes futurs seront recalculés sur la base de cette mise à jour. »; « Confirmer » records it; « Annuler » closes without writing.
- « Modifier le solde » with a changed date or amount, and the « Solde d'ouverture » sheet likewise: the step reads « Mettre à jour le solde », its notice ends « sur la base de ce changement. », its button « Mettre à jour », as Sure's `confirm_update` with `is_update: true`. Notes alone save at once, as Sure saves them apart from the reconciliation.
- The snapshot dialog swaps its content, as Sure's `confirm_create` replaces the `new` modal; the opening sheet opens the step as a dialog over it, as Sure's drawer posts into the `modal` frame. A refusal at save returns to the form with the error on its field.
- Sentence by type, Sure's `_confirmation_contents` in the French a user expects: « Définir le solde du compte au 17 octobre 2026 à 1 234,56 €. » (« Mettre à jour » for an update), the noun per type: depository « solde du compte », credit card « solde de la carte de crédit », loan « solde du prêt », property « valeur du bien », vehicle « valeur du véhicule », crypto « solde en cryptomonnaies », other asset « valeur de l'actif », other liability « solde du passif ».
- Investment (Sure's `account.investment?`, the `investment` type only): « Cela définira la valeur du compte au … à : » (« mettra à jour » for an update), then « Valeur totale du compte », « Valeur des positions » = total − cash, « Trésorerie de courtage » = `cash ?? 0`, the cash in the expense colour when negative and the income colour otherwise, as Sure's red and green.
- `docs/sure-parity.md`: the « Editing the opening balance » row drops its 28.19 « Later », and a « Balance confirmation » row says Parity.

**Never:** no change to what saving writes, to the save routes' refusals (Story 28.20) or to `record_valuation` and `set_opening_balance`; no confirmation on delete beyond the existing one; no new dependency; no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New balance, checking | 17/10, « 1 234,56 » | step « Confirmer le nouveau solde », « Définir le solde du compte au 17 octobre 2026 à 1 234,56 €. »; nothing written until « Confirmer » | none |
| Edit, amount changed | snapshot 2 000 → 1 500 | step « Mettre à jour le solde », « Mettre à jour » saves | none |
| Edit, notes only | notes changed | saved at once, no step | none |
| Opening balance changed | date or amount | step over the sheet; « Mettre à jour » saves, both close | refusal returns to the sheet, field marked |
| Investment, no trades | PEA, row on the date, cash = balance | total 26 300, positions 0, trésorerie 26 300 | none |
| Investment, holdings | row balance 10 000, cash 2 000, amount 12 000 | positions 8 000, trésorerie 4 000 | none |
| Date with no row | before the history's start | `cash: null`; positions = total, trésorerie 0 | none |
| Empty amount | « » or spaces | « Le montant est requis. » under the field, no request | API `VALIDATION_ERROR` `amount_required` |
| Viewer | `POST …/dry-run` | `403` | refused before the route |

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/snapshots.ts` -- `balanceIn` gives `amount_required` for a blank balance.
- `packages/api/src/services/ledger/snapshots.ts` -- `reconciliationDryRun(deps, accountId, { date, balance })`.
- `packages/api/src/services/snapshots.ts` -- `dryRunSnapshot(deps, accountId, input)`.
- `packages/api/src/routes/accounts.ts` -- `POST /:id/snapshots/dry-run`.
- `packages/app/src/hooks/useSnapshots.ts` -- `useSnapshotDryRun`.
- `packages/app/src/components/BalanceConfirmation.tsx` -- the step's text, Sure's `_confirmation_contents`.
- `packages/app/src/components/SnapshotDialog.tsx` -- form then confirmation step.
- `packages/app/src/components/OpeningBalanceSheet.tsx` -- the step as a dialog over the sheet; `OpeningAccount` gains `type`.
- `packages/app/src/routes/_authed.accounts.$accountId.tsx` -- passes the type.
- `packages/app/src/locales/fr.json` -- `snapshots.confirm.*`, `errors.fields.amount_required`.
- Specs: `schemas/snapshots.spec.ts` or the route specs, `routes/accounts.spec.ts` (dry run), `services/ledger/snapshots.spec.ts` (dry run with holdings); `e2e/snapshots.spec.ts`, `e2e/bank-connections.spec.ts` (the opening sheet), any other e2e saving a balance through the forms.
- `docs/sure-parity.md`.
- Sure, read-only: `app/controllers/valuations_controller.rb`, `app/views/valuations/{new,show,confirm_create,confirm_update,_confirmation_contents}.html.erb`, `app/models/account/reconciliation_manager.rb`, `config/locales/views/valuations/{fr,en}.yml`.

## Tasks & Acceptance

**Execution:**
- [x] `routes/accounts.spec.ts` -- the dry run answers balance and cash, writes nothing, `cash: null` without a row, `amount_required` on a blank balance, viewer refused; `services/ledger/snapshots.spec.ts` -- the cash derived beside holdings; failing first.
- [x] Schema, ledger, service, route.
- [x] Hook, `BalanceConfirmation`, the dialog's step, the sheet's step, locales.
- [x] `e2e/snapshots.spec.ts` -- confirm a new balance (step text, nothing saved before), an update (« Mettre à jour le solde »), a PEA's split, the opening sheet's step, an empty amount; other e2e follow the step.
- [x] Parity rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass, and screenshots of each step, light and dark, desktop and phone width, are reviewed against Sure's `confirm_create`.

## Design Notes

Assumptions taken alone, each settled by Sure. One dry-run route serves the three forms: Sure's `confirm_update` passes the existing entry only to read its old balance, which its view never shows. The dry run validates the amount and date format, not the ledger's refusals, as Sure's `prepare_reconciliation` saves nothing and checks nothing; a refusal appears when the step saves, back on the form, as Sure re-renders `new` or `show` with its error. Sure's `fr.yml` lacks `action_set`, `action_update`, `confirm_create` and `confirm_update`, and writes « sur » and « à » word for word; the French follows the story's titles and reads « au 17 octobre 2026 à … ». Sure's « Valeur des holdings » reads « Valeur des positions », the word Archant uses; « solde cryptographique » reads « solde en cryptomonnaies », « valeur de la propriété » reads « valeur du bien », Archant's « Bien immobilier ». The notice keeps Sure's « transactions » as the story quotes it, and gives each noun its article: « cette mise à jour », « ce changement ». The step keeps Archant's « Annuler » beside its button, where Sure's dialog has a close cross; it returns to the form with what was typed, as Sure's modal closes over its drawer, on the snapshot dialog as on the sheet.

## Implementation Notes

- The dialog's step replaces the form's content in the same `SnapshotForm`, whose `useForm` keeps the typed values while the inputs are unmounted; the sheet's step is a `Dialog` inside `OpeningBalanceForm`.
- A refusal at save, or « Annuler » on the step, gives focus back to the first refused field by its id, since the date is a controlled field react-hook-form holds no ref to; on the sheet, the step's `onCloseAutoFocus` does it, else Radix would return focus to the sheet's button.
- While the step saves, « Annuler », Escape and the overlay wait.
- `formatMoney` writes a narrow no-break space between thousands, which reads tight at the step's size; unchanged, as everywhere else.
- Screenshots of the three steps (new balance, PEA split, opening balance), light and dark, at 1280 and 390 px, were reviewed against Sure's `confirm_create`, `confirm_update` and `_confirmation_contents`.

### Review Findings

- [x] [Review][Patch] « Annuler » on the snapshot dialog's step closed everything, where the sheet's returned to the form [packages/app/src/components/SnapshotDialog.tsx]
- [x] [Review][Patch] Focus never returned to the refused field: `form.setFocus` has no ref for the controlled date, and on the sheet Radix gave focus back to its button [packages/app/src/components/SnapshotDialog.tsx, OpeningBalanceSheet.tsx]
- [x] [Review][Patch] The sheet's step dropped its description while closing [packages/app/src/components/OpeningBalanceSheet.tsx]
- [x] [Review][Patch] No test for « Annuler » on the sheet's step, nor for a malformed date on the dry run [packages/app/e2e/snapshots.spec.ts, packages/api/src/routes/accounts.spec.ts]

Rejected:
- Crypto shown without Sure's split (false): Sure's partial splits only `account.investment?`; a crypto account reads « le solde en cryptomonnaies ».
- Negative positions, and zero cash in the income colour (low): Sure's `holdings_value` is plain subtraction and its cash is green unless negative.
- The dry run should run the ledger's refusals (low): Sure's `prepare_reconciliation` checks nothing; Story 28.20 drops most of them.
- Escape during the dry run drops its answer (low): nothing is written; the user closed the dialog.
- The sentence assembled from keys rather than one `<Trans>` key (low): Sure's partial is built the same; one locale.
- The two forms duplicate the step's logic (low): one dialog step, one dialog over a sheet; a shared hook would cover two callers whose closing differs.
- No test of a negative cash's colour, of the close guard while saving, or of non-zero positions on screen (low): the colour is a class on one branch, the guard a timing, and the split's arithmetic is the ledger test's.
- `stored()` in e2e reads the body without a schema (low): it now asserts the status, naming the path.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | « Annuler », Escape or the overlay during the step's save | medium | patch | The save still lands after the cancel, or its refusal reaches a form the user left; both steps now block closing while it runs. |
| 2 | No test of a refusal at save from the snapshot dialog's step | medium | patch | Only the opening sheet's refusal was exercised; e2e now moves a snapshot onto the opening date and sees `snapshot_exists` back on the form. |
| 3 | `amount_required` untested on the two `PATCH` routes | low | patch | `balanceIn` serves them too; blank cases added to their existing refusal tests. |
| 4 | The investment split with `cash: null` never shown on screen | low | patch | The `?? 0` branch ran in no test; e2e adds a PEA balance dated before its opening date. |
| 5 | Dead `nouns.balance` key behind `NOUN_KEYS.investment` | low | patch | The investment branch returns before reading it; entry and key removed. |
| 6 | The sheet's step focuses « Annuler », the dialog's its action | low | patch | Radix's default first focusable; the step now focuses « Mettre à jour » as the dialog does. |
| 7 | `stored()` in e2e reads a failed response silently | low | patch | A 401 or 500 would fail later on `toMatchObject`; it now asserts `ok()` naming the path. |
| 8 | A ledger test mixes a bare number and `MinorUnits` | low | patch | Direct correction. |
| 9 | Sentence assembled from fragments rather than one key with `<Trans>` | low | reject | Mirrors Sure's partial word for word; one locale, and the fix adds markup plumbing for no user-visible change. |
| 10 | « 1 octobre » rather than « 1er octobre » | low | reject | `longDate` is Sure's `l(date, format: :long)` and already reads so across Archant. |
| 11 | No row on the date reads as all holdings | low | reject | Sure's `new_cash_balance \|\| 0`, recorded in the Code Map's matrix. |
| 12 | The dry-run body accepts `notes` it ignores | low | reject | `snapshotBodySchema` is the route family's shared body, as Sure's `entry_params` permits notes on `confirm_create`. |
| 13 | Spec, sprint status and WIP commit disagree | false | reject | All set to done together at completion. |
| 14 | `amount_required` on the save routes breaks the Never clause | false | reject | The spec's Always says the API refuses a blank amount alike; the refusals 28.20 owns are the ledger's, untouched. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
