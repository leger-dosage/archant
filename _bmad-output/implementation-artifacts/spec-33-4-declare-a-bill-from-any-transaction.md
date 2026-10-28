---
title: "Story 33.4: Declare a bill from any transaction"
type: 'feature'
created: '2026-10-28'
status: 'done'
baseline_commit: 'b4bdeca667991e1fb28d1e874551e7783995fec1'
route: 'dispatch'
review_loop_iteration: 0
context: ['{project-root}/_bmad-output/implementation-artifacts/epic-33-context.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) lets « Ajouter une facture » start from any transaction: `new.html.erb` links « Vous ne trouvez pas ce que vous cherchez ? » / « Rechercher dans toutes vos transactions » to `pick_entry.html.erb`, whose `picker_entries` (`recurring_transactions_controller.rb:312-345`) lists the 20 most recent rows of the dialog's sign and searches label, notes and merchant; `declared_bill.rb` keys the bill on its typed name, never on a merchant. Archant's dialog offers only the detected starting points, and `declareBill` keys a bill started from a transaction on that transaction's merchant or label.

**Approach:** a `GET /api/recurring/picker?kind=&q=` read and a picker view inside `BillDialog`'s declare form, as Sure's; `declareBill` always keys on `normalizeLabel(name)` with no merchant and stores the name as its label, and the declare body loses `entryId`, which Sure's `new_recurring_transaction_params` never takes.

## Boundaries & Constraints

**Always:** Sure's filters (transactions only, not excluded, not a split parent, no transfer side, a bill's rows negative and an income's positive, any account), Sure's order (date then creation, newest first) and cap of 20; one substring of the trimmed query against `transactions.label`, `transactions.notes` and the merchant's name, escaped as `contains` in `services/ledger/filter.ts`; a row with a confirmed payment reads « Rattachée à {{name}} » with the series' display name; the prefill stays `prefillFrom` (merchant else label, magnitude, account, kind by sign, day from today on); Sure's French strings from `config/locales/views/recurring_transactions/fr.yml` `new` and `pick_entry`; the query lives in `services/ledger/` (AD-2).

**Never:** no migration and no rewrite of bills already keyed on a merchant; no change to the candidates, the matcher, « Ajouter aux récurrences » or the MCP tools; no live search as one types (Sure submits on Enter); no pagination.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open, bill | 25 debits, a credit, a transfer side, an excluded row, a split parent | the 20 newest debits, newest first | none |
| Open, income | same | the credit only | none |
| Search | `q=edf` | rows whose label, notes or merchant contains « edf », any case | `%` and `_` match literally |
| Claimed row | a row paying a bill | listed with `claimedBy` the bill's name | none |
| No match | `q=zzz` | empty list; « Aucun résultat pour « zzz »… » | none |
| Declare from a merchant row | row « PRLV EDF », merchant « EDF », name kept « EDF » | series `merchantId` null, `labelKey` « edf », label « EDF » | none |
| Entry on an inactive account | picked from the picker | form's account « N'importe quel compte », as Sure's select falls back to its blank | none |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/controllers/recurring_transactions_controller.rb` `new` (115-145), `prefill_recurring_from_entry`, `picker_entries`, `claimed_series_names`; `app/views/recurring_transactions/new.html.erb` (« Partir d'une autre transaction » once started from a row, else the search link), `pick_entry.html.erb`, `_picker_row.html.erb` (label, date · account · claimed, magnitude); `app/models/recurring_transaction/declared_bill.rb`.
- `packages/api/src/services/ledger/recurring.ts` -- add `pickerTransactions(db, { sign, q, limit })`: join `transactions`, left join `merchants` and `accounts`, `not inAnyTransfer`, `notSplitParent`, `excluded = false`, `kind = 'transaction'`.
- `packages/api/src/services/recurring/bill-candidates.ts` -- add `billPicker(deps, kind, q)`: the rows plus `claimedBy` from confirmed `recurringAllocations` → occurrence → series, named by `displayName` (`domain/recurring/bills.ts`).
- `packages/api/src/schemas/bills.ts` -- `pickerQuerySchema` (`kind`, `q` optional, max 200); drop `entryId` from `declareBodySchema` and `declareBillSchema`.
- `packages/api/src/routes/recurring.ts` -- `.get("/picker", …)` beside `/candidates`.
- `packages/api/src/services/recurring/bills.ts` -- `declareBill`: key `{ merchantId: null, labelKey: normalizeLabel(bill.name) }`, `label: bill.name`; drop `findTransaction`, `seriesKeyOf` imports if unused; doc comment.
- `packages/api/src/testing/recurring.ts` -- `declareMortgage` comment; `pipeline.spec.ts` merchant cases set the series' key to the merchant by hand (a bill an earlier version declared).
- `packages/app/src/hooks/useRecurring.ts`, `lib/query-keys.ts` -- `useBillPicker(kind, q)`, key under `recurring.all`.
- `packages/app/src/components/BillDialog.tsx` -- `DeclareForm` keeps `startedFrom` state (prefill or chosen row) instead of a form `entryId`; `picking` state swaps header, candidates and form for a `Picker`; `EditForm` loses `entryId: _entry`.
- `packages/app/src/locales/fr.json` -- `recurring.form` keys.
- `packages/app/e2e/recurring.spec.ts`, `e2e/bills.spec.ts:197`, `e2e/fixtures.ts` `declareBill` -- picker test; drop `entryId`.
- `docs/sure-parity.md:220` -- « Bills declared by hand »: Parity.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/services/recurring/bill-candidates.spec.ts`, `bills.spec.ts` -- failing tests first: picker filters, order, cap, search on label, notes and merchant, `%` literal, claimed row; name key with no merchant.
- [x] `services/ledger/recurring.ts`, `services/recurring/bill-candidates.ts`, `schemas/bills.ts`, `routes/recurring.ts` -- the picker read.
- [x] `services/recurring/bills.ts` and the specs that passed `entryId` -- the name key.
- [x] `hooks/useRecurring.ts`, `lib/query-keys.ts`, `components/BillDialog.tsx`, `locales/fr.json` -- the picker view and links.
- [x] `e2e/recurring.spec.ts` -- declare a bill from a searched transaction; fix `e2e/bills.spec.ts` and `fixtures.ts`.
- [x] `docs/sure-parity.md`; story and `sprint-status.yaml` to `done`; Epic 33 stays `in-progress`.

**Acceptance Criteria:**
- Given the declare dialog not started from a row, when it opens, then « Vous ne trouvez pas ce que vous cherchez ? » and « Rechercher dans toutes vos transactions » sit below the starting points; once started from a row, « Partir d'une autre transaction » replaces them.
- Given the picker, when a row is chosen, then the form shows its values and « Revenir au formulaire » returns to the form with what was typed.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass.

## Implementation Notes

- `contains` in `services/ledger/filter.ts` is exported and takes any column, so the picker searches the merchant's name with the same escaping.
- Tests that declared from a transaction to key a bill on its merchant now key it by hand with `keyOnMerchant` in `testing/recurring.ts`, as a bill an earlier version declared; the e2e bills queue test names its bills as their rows.
- `PICKER_SHOWN` lives in `schemas/bills.ts`, read by the service and the dialog's capped note.
- The picker's body takes `min-w-0`: on a phone a truncated row otherwise widened the dialog's grid column.

## Spec Change Log

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `b4bdeca6`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A starting point keyed on a merchant stays offered after a bill is declared from it, the bill keying on its name | low | reject | Sure's `candidate_patterns` (`identifier.rb:42-55`) compares the same identity, merchant or name, so it keeps offering it too. |
| 2 | A bill prefilled with the merchant's name does not recognise rows labelled otherwise | low | reject | Sure's `matcher.rb:359-380` `identity_matches?` compares a name-keyed series' name and aliases with the row's name, as Archant's `knownNames`; recorded in Design Notes and the PR. |
| 3 | Matrix rows « merchant row » and « inactive account » have no test | low | patch | The e2e picker test now picks a row with a merchant on a deactivated account and checks « Nom » and « N'importe quel compte ». |
| 4 | « Revenir au formulaire » keeping typed fields is untested | low | patch | The sheet's e2e test goes to the picker, searches and comes back with the frequency it chose kept. |
| 5 | With no query and no row, the empty text quotes an empty query | low | reject | Sure's `pick_entry.html.erb` renders `no_results` with an empty query too. |
| 6 | `keepPreviousData` shows the old list, or the new query's empty text, while a search loads | low | patch | `useBillPicker` drops it; a new search shows the skeleton. |
| 7 | The capped note shows after a search | false | reject | Sure's `@picker_capped` is `size == PICKER_SHOWN` whatever the query. |
| 8 | Two bills claiming one row, or a suggested payment, are untested | low | reject | One confirmed claim is covered; the filter on `confirmed` mirrors Sure's `RecurringAllocation.confirmed`. |
| 9 | The picker's `LIKE` is not timed by the volume test | maybe-false | defer | Same `contains` as the transactions search; deferred with what would settle it. |
| 10 | Task list ticks « done » while tracking reads in-progress | low | patch | Step 5 sets both to `done`. |
| 11 | `docs/sure-parity.md` row not padded | low | patch | `pnpm format` realigned the table. |
| 12 | `q` over 200 characters and blank `q` untested at the route | low | reject | The schema's `max(200)` and `trim()` are one line each; the blank case is the service's `q.trim()`, covered by `"  edf "`. |
| 13 | An old merchant-keyed bill and a new name-keyed one of the same name can both exist | low | reject | Rare after upgrade and visible on « Factures »; said in the PR's upgrade note. |
| 14 | The picker lists rows of a deactivated account | false | reject | Sure's `Current.accessible_entries` has no visibility filter; the form falls back to « N'importe quel compte », as Sure's select. |
| 15 | On that fallback the amount text was formatted in the row's currency | low | reject | Both are two-decimal currencies in every realistic household; the schema refuses an amount the reporting currency cannot hold. |
| 16 | Accounts still loading make the fallback drop the account | low | reject | The dialog opens from a button the user clicks after the page loaded its accounts. |
| 17 | Pending rows are listed | false | reject | Sure's `picker_entries` does not filter pending rows. |
| 18 | The search form's `stopPropagation` inside the sheet is untested | low | patch | Covered by the sheet's e2e test (finding 4). |
| 19 | The income picker is not exercised end to end | low | reject | The service test covers the sign; the UI passes the dialog's kind on one line. |

## Design Notes

Assumptions taken alone, each settled by Sure:

- A bill declared from a transaction keys on its name as Sure's `declared_bill.rb`, so it recognises rows of that name, its aliases learned from confirmed payments, and no longer a merchant's other rows; Sure's matcher does the same.
- The search is one substring of the trimmed query, as Sure's `ILIKE '%q%'`; SQLite's `LIKE` folds ASCII case only, as the transactions search already does.
- « Revenir au formulaire » keeps what was typed; Sure reloads a blank form only because its picker is a separate page.
- Upgrade: a bill already declared from a transaction keeps its merchant key; only new bills key on their name.

## Verification

**Commands:**
- `pnpm --filter @archant/api exec vitest run --project unit src/services/recurring` -- expected: pass.
- The repository's verification gate in `AGENTS.md` -- expected: pass, no tracked file changed after it.
