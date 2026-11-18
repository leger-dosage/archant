---
title: "Story 31.1: Filter transactions by status and amount"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: '4deb59cdc2281f384501685fcdd57832dff27263'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) filters its transactions by status, « Confirmée » or « En attente » (`Transaction::Search#apply_status_filter`), and by one amount with an operator, « Égal à », « Supérieur à » or « Inférieur à » on the absolute value (`EntrySearch.apply_amount_filter`). Archant's list has no status filter and takes a minimum and maximum instead.

**Approach:** `GET /api/transactions`, its totals and the bulk filter take `status` (repeated, `confirmed` or `pending`), `amount` and `amountOperator` (`equal`, `greater`, `less`; either alone filters nothing, as Sure's `apply_amount_filter`, while the interface's select starts on « Égal à ») in place of `amountMin` and `amountMax`; the operator becomes the inclusive minor-unit bounds the ledger already reads. The « Filtrer » menu gains « Statut » and its « Montant » becomes Sure's select and one field. The assistant's `group_transactions_by_label` takes Sure's `amount` and `amount_operator` too, as `get_transactions` already does.

## Boundaries & Constraints

**Always:**
- Sure's semantics: `equal` keeps `|amount|` within 0.01 inclusive, `greater` and `less` are strict; both statuses or none is no filter; the totals follow every filter.
- Integer minor units per currency, read from the decimal text with bigint, never a float; `less 0` matches nothing.
- A malformed `amount` (letters, too many digits) is `400 VALIDATION_ERROR` with `{ path: "amount", code: "invalid_amount" }`; a leading sign is dropped, as Sure's `to_f.abs`; an unknown `status` or `amountOperator` is a `400` too.
- Texts from Sure's `fr.yml`: « Statut », « Confirmée », « En attente », « Égal à », « Supérieur à », « Inférieur à », placeholder « 0 »; the chips read « Confirmée » or « En attente », and « Montant égal à 42,90 » (Sure's `transactions.searches.search` operator words, prefixed as Archant's chips are).
- The interface's search params are the API's keys, so « Tout sélectionner » sends them as they are to the strict bulk filter.

**Never:** no migration, no new dependency; no reordering of Archant's other filters; no change to `get_transactions` (it already takes Sure's `statuses`, `amount` and `amount_operator`, Story 27.x) nor to `bulk_update_transactions`' filter.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pending | `?status=pending` | pending lines only, totals counting them | none |
| Confirmed | `?status=confirmed` | booked lines only | none |
| Both | `?status=confirmed&status=pending` | every line | none |
| Equal | `-42,90`, `42,91`, `42,92`; `?amount=42,90&amountOperator=equal` | first two | none |
| Greater | `?amount=42,90&amountOperator=greater` | `42,91`, `42,92` | none |
| Less | `?amount=42,91&amountOperator=less` | `-42,90` | none |
| Malformed | `?amount=abc` or `?amount=5-` | nothing listed | `400 invalid_amount` on `amount` |
| Old link | `/transactions?amountMin=40` | param dropped, page loads | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb:app/models/entry_search.rb` `apply_amount_filter`, `app/models/transaction/search.rb` `apply_status_filter`; `app/views/transactions/searches/filters/_status_filter`, `_amount_filter`, `_search.html.erb` (chip text); `config/locales/views/transactions/fr.yml`.
- `packages/api/src/schemas/transactions.ts` -- `filterFields`, `filterCheck`, `FilterPaths`, `parseBounds`, `transactionFilterSchema`, `transactionTotalsSchema`, `bulkFilterSchema`: replace `amountMin`/`amountMax` by `status`, `amount`, `amountOperator`; `parseBounds` becomes the step that turns them into `amountMin`/`amountMax` `AmountBound`s and `pending`. Move `operatorBounds` (and `AMOUNT_OPERATORS`, `STATUSES`) here from `schemas/assistants/transactions.ts` and export them.
- `packages/api/src/domain/transaction-filter.ts` -- `amountBoundsFor`: an upper bound below zero (`less 0`) gives `null`; keep inward rounding.
- `packages/api/src/services/transactions.ts` -- `filterOf`, `amountsFor`, `NamedFilterRequest.pending` already read the parsed fields; only types follow.
- `packages/api/src/services/ledger/filter.ts` -- unchanged: `amounts` and `pending` already filter.
- `packages/api/src/schemas/assistants/transactions.ts` -- import the moved helpers; `toolFilterFields` (group tool) takes `amountFields` in place of `amount_min`/`amount_max`.
- `packages/api/src/routes/transactions.spec.ts` -- `syncOwn`, `bankLine` make pending lines; replace the range tests.
- `packages/app/src/lib/transaction-filters.ts` -- `operationsSearchSchema`, `FILTER_KINDS` (add `status` before `amount`), `PARAMS_OF`, `toTotalsQuery`, `filterChips`, `ChipKey`.
- `packages/app/src/components/TransactionFilters.tsx` -- `AmountEditor` (shadcn `Select` + one `Input`), new `StatusEditor` modelled on `DirectionEditor`.
- `packages/app/src/locales/fr.json` -- `operations.kinds.status`, `operations.chips.statuses.*`, `amountEqual|Greater|Less`, `operations.editor.operator|amount|statuses`; drop `min`, `max`, `amountBetween|AtLeast|AtMost`, `errors.fields.below_min` if unused.
- `packages/app/e2e/operations.spec.ts` -- amount tests; `packages/app/e2e/bank-connections.spec.ts` -- the fake bank's pending line for the status test.
- `docs/sure-parity.md` « List, search, filters » row.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/transaction-filter.spec.ts`, `packages/api/src/schemas/transactions.spec.ts`, `packages/api/src/routes/transactions.spec.ts` -- tests first: each status, both, each operator, one cent off either side, strictness, `less 0`, malformed amount and unknown operator or status refused on the page and the totals, totals following the filter.
- [x] `packages/api/src/schemas/transactions.ts`, `domain/transaction-filter.ts`, `schemas/assistants/transactions.ts` -- implement; MCP specs follow the group tool's new fields.
- [x] `packages/app/src/lib/transaction-filters.ts` + spec, `components/TransactionFilters.tsx`, `locales/fr.json` -- search params, chips, editors.
- [x] `packages/app/e2e/operations.spec.ts`, `bank-connections.spec.ts` -- amount greater than a value, a malformed amount refused in the menu, the pending line filtered by « En attente ».
- [x] `docs/sure-parity.md` -- the row reads Parity; story and sprint status to done, epic 31 in progress.

**Acceptance Criteria:**
- Given the « Filtrer » menu, when « Statut » opens, then two checkboxes « Confirmée » and « En attente » apply; one checked shows its chip, both or none clear the filter.
- Given « Montant », when it opens, then a select defaults to « Égal à » and one field reads the amount; a malformed amount shows « Montant invalide » under the field and changes nothing.

## Implementation Notes

Decisions taken alone, the owner unavailable:

- `AMOUNT_OPERATORS`, `STATUSES`, `operatorBounds` and a new `pendingOf` live in `schemas/transactions.ts`; the assistant schemas import them. Their orders stay the assistant's (`equal, less, greater`; `pending, confirmed`) so `get_transactions`' tool schema does not move; the interface lists Sure's own order, `OPERATOR_OPTIONS` and `STATUS_OPTIONS` in `lib/transaction-filters.ts`.
- `filterCheck` checks `amount` with `parseAmountBound`; the assistant tools never pass it an amount, since their `amount` is Sure's lenient `to_f` reading through `amountFilterOf`, so `FilterPaths.amount` is only the route's. `parseBounds` is now the route's step alone; the assistant filters no longer go through it.
- `compareAmountBounds` and the `below_min` code went with the range: nothing compares two bounds any more.
- The interface's URL drops `status` when both values are present, and `amountOperator` without `amount`, so neither shows a chip that filters nothing.
- The operator select has no label in Sure; Archant labels it « Comparaison » for screen readers, and keeps its hint « Sans signe : … » above the field: the sign changes nothing.
- `docs/sure-parity.md` records the refusal of a lettered amount as Different, security and Story 31.1, beside Parity.

## Spec Change Log

- Code review (Blind Hunter, Edge Case Hunter): the route defaulted an absent `amountOperator` to `equal`, where Sure's `apply_amount_filter` and the assistant's `amountFilterOf` filter nothing. Amended by the owner's standing rule (follow Sure): either alone filters nothing on the route; « Égal à » stays the interface's default. Avoids one query meaning two things. KEEP: the select's default and the chip.

- Self-review: the frozen block refused a signed amount, where Sure's `to_f.abs` reads `-5` as 5. Amended by the owner's standing rule (follow Sure, decide alone): a leading sign is dropped, letters still refused as the story asks. Avoids refusing what Sure's number field accepts. KEEP: `invalid_amount` on `amount` for letters and too many digits.

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Spec `in-review` while sprint status says done | false | reject | Step 5 sets both to done after the review; they agree in the pull request. |
| 2 | « Never » forbids touching `get_transactions`, yet its transform changed | false | reject | Only the shared `pendingOf` replaced an inline copy; its existing specs pass unchanged. |
| 3 | `checkWithToolPaths` comment says only dates are checked while passing `amount` | low | patch | Comment now says a tool's amount never reaches `listFilterOf`, so only `end_date` is refused. |
| 4 | `parseBounds` name misleads now that it reads status and operator | low | patch | Renamed `toLedgerFilter`, its input type `FilterParams`. |
| 5 | No route test that a bulk action's filter selects by status and amount | medium | patch | `bulk-update` test with `status`, `amount` and `amountOperator`. |
| 6 | Both statuses checked untested through the interface | low | patch | The e2e checks « Confirmée » too, then the chip and `status` are gone. |
| 7 | No e2e for the default « Égal à » | low | reject | The e2e checks the select reads « Égal à »; the chip text is unit-tested in `filterChips`. |
| 8 | No test of `equal` in a currency without cents | low | patch | `amountBoundsFor` test: 41,99 to 42,01 in yen is 42 alone. |
| 9 | Old-link e2e does not check the URL loses `amountMin` | low | reject | The list is unfiltered whatever the URL holds: the API strips unknown keys and no chip shows. |
| 10 | Removed `amountMin`/`amountMax` and `amount_min` are a breaking change | low | reject | The route is the interface's own; assistants read the tool schema on each session. Said in the pull request. |
| 11 | Parity row cites Story 31.1 twice, omits the default operator and chip wording | low | patch | Row reworded; an absent operator defaults to Sure's select's first option, which Sure's form always sends. |
| 12 | « Montant invalide » stays while typing until « Appliquer » | low | reject | Same as `PeriodEditor`'s errors. |
| 13 | Chip keeps a typed sign | low | reject | Sure's badge shows the typed value too. |
| 14 | `AmountOperator` defined twice | low | patch | The interface imports the API's type. |
| 15 | `less 0,001` test comment imprecise | low | patch | Comment names the strict bound. |
| 16 | `leadingAmount` misreads a JSON number in exponent form | low | reject | Pre-existing in `get_transactions`; no assistant sends 1e-7 as an amount. |
| 17 | List silently ignores the removed range keys | low | reject | The list query is not strict by design; the interface drops the keys from old links. |

Second pass, `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). Every patch applied.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The route reads an amount without operator as `equal`, Sure and the assistant as no filter (two layers) | medium | patch | Either alone filters nothing on the route; the interface fills « Égal à ». See the change log. |
| 2 | `AmountBound` still documented as non-negative | low | patch | Comment names `less 0`'s bound. |
| 3 | `amountBoundsFor` example still a range | low | patch | Example is `equal 42,90`. |
| 4 | « Sans signe » hint contradicts the accepted sign and the strict operators (two layers) | low | patch | « Le signe est ignoré : les dépenses et les revenus sont comparés en valeur absolue. » |
| 5 | `docs/deployment.md` gives the amount pair to `get_transactions` alone | low | patch | Names `group_transactions_by_label` too. |
| 6 | Bulk test patches `excluded`, which Story 31.2 removes | low | reject | Story 31.2 updates the tests its change breaks. |
| 7 | `Status` type duplicates the API's | low | patch | Imports `TransactionStatus`. |
| 8 | `statusLabel` joins values the URL never holds together | low | reject | Harmless and robust to a hand-written link the API reads alike. |
| 9 | `FilterPaths.amount` forced on the tools | low | patch | Optional; the tools pass `end_date` alone. |
| 10 | The field takes ten decimals where Sure's `step: 0.01` takes two | low | reject | Compared exactly and rounded inward; nobody types five decimals. |
| 11 | The frozen block was amended without the owner (two layers) | false | reject | The owner's standing rule for this run: follow Sure and decide alone, recorded in the change log as Story 30.9 did. |
| 12 | Clearing the amount untested | low | reject | One branch of `AmountEditor`; `withoutFilter` covers the chip's removal. |
| 13 | A tab open across the upgrade sends `amountMin` to the strict bulk filter | low | reject | A 400 until reload, on a one-household server. |
| 14 | `get_transactions` and the bulk tool's transforms touched despite « Never » | false | reject | Same as the first pass, #2. |
| 15 | Parity row is not « Parity » alone | false | reject | The page's rules give each sub-difference its status; the refusal is the story's. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure or Archant's model:

- The route reads an amount or an operator alone as no filter, as Sure's `apply_amount_filter` and the assistant's tools; the interface's select starts on « Égal à » and writes both keys whenever an amount is set, and a hand-written link with an amount alone takes « Égal à ».
- Bounds: `equal` is `[x − 0.01, x + 0.01]` rounded inward per currency, so a yen amount must match exactly; `greater` and `less` move the amount by 10⁻⁵, finer than any minor unit, then round inward, as the assistant's `operatorBounds` already does.
- `parseAmountBound` drops a leading sign, as Sure's `to_f.abs`, and refuses letters, which Sure reads as 0: the story asks for the refusal, and every boundary input is parsed.
- « Statut » sits before « Montant » in the menu, as in Sure's `transaction_search_filters`; the other entries keep Archant's order.
- `group_transactions_by_label` takes Sure's amount pair so every assistant read shares one amount filter; no Sure tool to follow, the range disappearing from the shared fields.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
