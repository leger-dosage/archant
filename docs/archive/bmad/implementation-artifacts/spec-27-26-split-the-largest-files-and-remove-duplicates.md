---
title: 'Story 27.26: Split the largest files and remove duplicates'
type: 'refactor'
created: '2026-10-14'
status: 'done'
baseline_commit: '5b2099ae4a96a834b696caf5f4bc782becf9190a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `packages/api/src/schemas/assistants.ts` (1,589 lines) and `packages/api/src/services/recurring/bills.ts` (1,655 lines) are too long to read; four helpers are copied two or three times; the README's screenshots predate « Factures », « Budgets » and « Objectifs » in the sidebar.

**Approach:** Move code without changing it: one schema file per `mcp/` resource, the bill reads out of `bills.ts`, each copied helper written once beside its callers' shared module, and the two screenshots taken again from the running application.

## Boundaries & Constraints

**Always:**
- No behaviour changes: same exports' bodies, same error codes and paths, same tool inputs. Existing specs pass with only their import lines and `describe` blocks moved.
- Schemas: `packages/api/src/schemas/assistants/<resource>.ts` for each of the 16 `mcp/` tool files that imports a schema (`accounts`, `bills`, `budgets`, `categories`, `goals`, `holdings`, `imports`, `merchants`, `opening-balance`, `recurring`, `reports`, `rules`, `snapshots`, `tags`, `transactions`, `transfers`), each `mcp/<resource>.ts` importing only its own. Helpers two resources share go to `schemas/assistants/fields.ts`, which defines them; no file re-exports another's symbols. `schemas/assistants.ts` is deleted.
- Bills: `bills.ts` keeps the writes (`taken`, `declareBill`, `markTransferRecurring`, `patchRecurring`, `editBill`, `updateBill` and their private helpers). New modules, each under 800 lines: `bill-candidates.ts` (`billCandidates`, `candidatePatterns`, `BillCandidate`), `bill-overview.ts` (« Factures »: `loadBills`, `billsOverview`, `occurrenceDetail`, `upcomingRecurring`, `estimatedRange`), `all-bills.ts` (« Toutes les factures » and a bill's page: `withAmounts`, `priceChangesWhere`, `allBills`, `billDetail`, `BillRecord`, `BillOccurrence`, `PriceChange`). `bill-reads.ts` stays as it is apart from its imports. Each `describe` of `bills.spec.ts` moves to the spec of the module that now holds its function.
- `currencyOf` of `services/imports.ts`, `snapshots.ts` and `transactions.ts` becomes one exported function in `services/accounts.ts`, beside `getAccount`.
- `isDecimalString` is exported from `packages/data/money.ts` and imported by `packages/app/src/lib/balance-change.ts` and `lib/trade-format.ts`, whose copies go.
- `assertNameFree` becomes one function in `services/names.ts` taking the table (`categories`, `merchants` or `tags`), answering `VALIDATION_ERROR` on `name` with `name_taken` as today.
- `filterByName` becomes one function in `packages/app/src/lib/search-match.ts`, built from the values that always match (`CREATE`, plus `CREATE_CHILD` for categories), used by the three comboboxes.
- Screenshots: `docs/images/dashboard.png` and `transactions.png` as Story 15.3 took them: a throwaway, uncommitted script, a fresh server and SQLite file, administrator « Camille », made-up accounts and seven months of transactions through the API, transfers paired, light theme, 1440×900, dashboard on « 6 M ». README alt texts updated only if what they describe changed.

**Never:** no merge of `bills.ts`'s `currencyOfAccount` or `bank-connections.ts`'s `currencyOf` (other inputs, other error); no split of other files; no barrel file; no new spec for `services/loans.ts` (`routes/accounts.spec.ts` covers `/schedule`, `/overview`, `/payoff-chart`); no real bank data in a screenshot.

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/assistants.ts:36-96` -- shared fields: `requiredLoose`, `sureAmount`, `looseInteger`, `looseBoolean`, `clampedPageFields`, `listPageInput` (categories, goals, rules, tags), `sureName`/`requiredSureName`/`present` (categories, tags, imports), `accountId` (bills, snapshots, opening-balance, transactions, imports), `merchantId` (transactions, merchants). Resource-only: `monthParam`/`sureMonthOf`/`toolMonth` (budgets), `idsOf`…`bulkFilterInput` (transactions), `operatorsOf`…`ruleId` (rules), `billId`/`frequencyText` (bills), `importId`/`mappingField` (imports). Imported by `mcp/*.ts` only, no spec.
- `packages/api/src/services/recurring/bills.ts:93-615` writes, `616-735` candidates, `736-1180` and `1618-1655` overview, `1179-1617` all bills and detail. `estimatedRange` (786) serves `loadBills` and `withAmounts`; `Reader` type (843) is shared.
- Importers to update: `routes/recurring.ts:14-23`, `routes/transfers.ts:7`, `mcp/bills.ts:5,37`, `services/recurring/{audit,price-changes,bill-reads}.ts`, `testing/recurring.ts:23`, specs `services/recurring/{bills,bill-reads,audit,occurrences,payments,series}.spec.ts`, `mcp/bills.spec.ts`.
- `packages/api/src/services/{imports.ts:126,transactions.ts:231,snapshots.ts:44}` -- identical `currencyOf`; `services/accounts.ts:173` `getAccount`.
- `packages/data/money.ts:223`, `packages/app/src/lib/balance-change.ts:29`, `lib/trade-format.ts:12` -- identical `isDecimalString`.
- `packages/api/src/services/{categories.ts:111,merchants.ts:70,tags.ts:60}` -- `assertNameFree`; `services/names.ts:26` already types `NamedTable`.
- `packages/app/src/components/{CategoryCombobox.tsx:37,MerchantCombobox.tsx:29,TagCombobox.tsx:29}` -- `filterByName` over `matchesSearch` (`lib/search-match.ts`).
- `README.md:18-20`, `docs/images/` -- screenshots; method in `spec-15-3-*.md` lines 62 and 95.

## Tasks & Acceptance

**Execution:**
- [x] Tests first for the shared helpers: `packages/data/money.spec.ts` `isDecimalString`; `services/names.spec.ts` `assertNameFree` (taken case and accents aside, own id allowed, per table); `app/src/lib/search-match.spec.ts` the combobox filter (pinned value always 1, keywords matched, accents aside).
- [x] Write the four shared helpers and switch their callers; delete the copies.
- [x] Split `schemas/assistants.ts` into `schemas/assistants/`; update the 16 `mcp/` imports.
- [x] Split `services/recurring/bills.ts`; update importers; move `bills.spec.ts` describes to `bill-candidates.spec.ts`, `bill-overview.spec.ts`, `all-bills.spec.ts`, keeping « a bill paid from any account » where its functions' writes live.
- [x] `wc -l` every new and touched module: each under 800.
- [x] Retake the two screenshots; look at them; check the sidebar.
- [x] `sprint-status.yaml` and this spec's status.

**Acceptance Criteria:**
- Given the branch, when `grep -rn "function currencyOf\|function isDecimalString\|function assertNameFree\|function filterByName"` runs, then each name is defined once (bank-connections' `currencyOf` excepted).
- Given the verification gate, when it runs, then it passes, knip finds no unused export, and no spec assertion changed.

## Implementation Notes

- Both splits were made by a throwaway script cutting top-level declarations with their comments; a line-by-line comparison of every non-import line against `5b2099ae` shows nothing lost or added, apart from one line oxfmt rewrapped and the `listPageInput` comment, which named two of its four tools and now names none.
- `present` serves `create_category` and `update_category` only, so it stays private in `schemas/assistants/categories.ts`; `fields.ts` holds `requiredLoose`, `sureAmount`, `looseInteger`, `looseBoolean`, `clampedPageFields`, `listPageInput`, `sureName`, `requiredSureName`, `accountId` and `merchantId`. `mcp/categories.ts`, `goals.ts`, `rules.ts` and `tags.ts` import `listPageInput` from it beside their own file, the only way without a re-export.
- `estimatedRange`, `AmountRange` and `Reader` stay beside `loadBills` in `bill-overview.ts`; `all-bills.ts` imports them.
- Moving the `describe` blocks needed more than imports: the helpers several bill specs share (`account`, `addRows`, `stored`, `bill`, `refusal`, `monthly`, `firstOf`, `query`) moved verbatim to `testing/bills.ts`, rather than copied four times; the local `beforeEach`/`afterEach` became `useRecurringDatabase("2026-09-21T10:00:00Z")`, which adds `vi.restoreAllMocks()`; the local `occurrencesOf` gave way to `testing/recurring.ts`'s, which selects more columns; oxlint's `consistent-function-scoping` made `filtered`, `searched` and `subscribe` module-level in `all-bills.spec.ts`. The 57 tests and their 213 `expect` lines are unchanged.
- `assertNameFree` throws `invalidField("name", "name_taken")` from `services/ledger/shared.ts`, the same error as before.
- The acceptance grep also finds `currencyOf` in `packages/app/src/components/BillDialog.tsx:186`, an interface helper this story does not name. `mcp/bills.ts` (1,312 lines) and `services/transactions.ts` (852) are touched only in imports or by the removed copy, and stay above 800: the story splits no other file.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| Screenshots not retaken (blind) | false | Retaken in the same change, outside the reviewed diff. | rejected |
| Statuses not advanced (blind) | false | Set at finalization, after review. | rejected |
| Grep criterion matches `BillDialog.tsx`'s `currencyOf` (blind, auditor) | low | An unrelated interface helper; the fix edits the spec. | rejected, noted above |
| Specs changed beyond imports and moved blocks (blind, auditor) | low | Setup, shared helpers and three lifted closures; no assertion changed. | rejected, noted above |
| `listPageInput` comment rewritten, not verbatim (blind, edge) | low | The old comment named two of four tools. | rejected |
| Four `mcp/` files import `fields.ts` (blind, auditor) | false | The spec sends shared helpers there and forbids re-exports. | rejected |
| Two `addRows` and `account`-like helpers under `testing/` (blind, standards) | low | Different signatures: a wrong pick fails typecheck. | rejected |
| `addRows` takes `amount: number` (blind) | false | Integer minor units through `toMinorUnits`, as `testing/recurring.ts`'s `Row`. | rejected |
| `testing/bills.ts` header narrates history (blind) | low | Rewritten to say what the file holds and why. | patch |
| `all-bills.ts` takes `Reader` from `bill-overview.ts` (blind, standards) | low | Original co-location kept; no caller diverges. | rejected |
| `assertNameFree` rebuilds `invalidField`'s error (blind) | low | Direct reuse removes a fourth copy of the error. | patch |
| `assertNameFree` test skips `categories` (blind, auditor) | low | One body over a typed table parameter; tags and merchants cover it. | rejected |
| `filterByName` name and per-call comment (blind) | low | Cosmetic. | rejected |
| Code Map lists wrong sharers of `accountId` and `present` (blind) | low | The fix edits the spec; corrected in the notes above. | rejected |
| Touched modules over 800 lines (auditor) | low | `mcp/bills.ts` and `services/transactions.ts`; the spec forbids other splits. | rejected, noted above |

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all green, tracked files unchanged after.
- `git diff 5b2099ae --stat -- '*.spec.ts'` -- expected: imports and moved blocks only.

**Manual checks:**
- Both screenshots show the current sidebar (« Factures », « Budgets », « Objectifs ») and made-up data only.
