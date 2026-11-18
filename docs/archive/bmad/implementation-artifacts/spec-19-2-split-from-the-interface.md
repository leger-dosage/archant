---
title: 'Story 19.2: Split from the interface'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: 'ff0897674858debcd9103d397bfcff4115d721ef'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-19-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 19.1 split transactions in the ledger and over the API, but the interface neither offers « Diviser » nor shows a split: the list hides the parent, so the lines float with nothing saying they belong together.

**Approach:** Sure's split UI at `14638a7` (`splits/new.html.erb`, `split_transaction_controller.js`, `group_split_entries`, `_split_parent_row`, `transactions/show.html.erb`): a dialog from the sheet, the parent fetched apart from the page and grouped above its children, and a sheet section per role. Story 19.2 of `epics.md` is the acceptance contract; the owner delegated every decision, the ones taken alone are marked « Decided ».

## Boundaries & Constraints

**Always:**
- List: the filter, count, totals, day subtotals and bulk selection still read the children only. `GET /api/transactions` and `GET /api/accounts/:id/transactions` add `splitParents`, the parents of the page's children, read by id with no filter, as Sure's `@split_parents`. Every list item gains `splitParent: boolean`, `true` only in `splitParents` (Decided: the sheet must tell a parent from an excluded row; a column on `TransactionRecord` would add a subquery to the volume-tested list).
- Grouping, per day as `group_split_entries`: the first child of a loaded parent emits the parent's row, then every sibling of that day on the page, in line order (the reverse of the list's `createdAt desc, id desc`). A split cut by a page shows its parent on both pages; only the children matching the filter show.
- Parent row: muted, a « Divisée » `StatusBadge`, its full amount, no checkbox (spacer kept), no category chip, opens its sheet. Children: indented in a list nested in the parent's item, checkbox and category chip kept.
- Splittable, as `splitTransaction`'s refusal: no transfer (the sheet's current link), not pending, excluded or possible duplicate, neither child nor parent. Only then does the sheet show « Diviser ».
- Dialog (`SplitDialog`): one fieldset per line (label, amount through `AmountField`, category through a parameterised `CategoryField`, « Retirer la ligne N » from the second line on); new: one line labelled as the parent, amount empty, « Sans catégorie »; edit: the children, by id, so their tags and notes stay. « Ajouter une ligne » up to `MAX_SPLIT_LINES`. « Reste à répartir » is the parent's amount minus the parsed lines (an empty or invalid amount counts 0), in `Money`, `text-destructive` with the `split_sum_mismatch` sentence until it is zero. Submit, « Diviser » or « Enregistrer », is disabled until then. A new line's amount toggle starts on the parent's nature (Decided: EXPERIENCE.md asks for the Dépense / Revenu toggle, not a minus sign; Sure asks for the sign).
- Errors: `lines.N.<field>` on its field; `lines` codes under the counter, `too_small` as « Ajoutez au moins une ligne. », `too_big` as « Une division compte 50 lignes au plus. »; any other code a toast, the dialog kept open.
- Sheet of a parent: section « Division » listing the children (label, category, amount) from `GET /:id/split`, « Modifier la division », « Annuler la division » (confirmation). Sheet of a child: section naming its parent (label, date, amount) with the same two buttons, as Sure. Both: date and amount disabled, no exclusion switch, no transfer block; a child also has its merchant disabled and no « Supprimer »; a parent hides « Récurrence », and its delete confirmation says its lines go too.
- Split actions are disabled while the sheet's form is dirty, as `RecurringBlock`. After a split, an edit or an unsplit: toast, dialog and sheet closed (Sure redirects), focus on the parent's row, lists, totals, categories, tags and the split query refreshed.
- French strings in `fr.json` under `transactions.split`; every control named for assistive technology.

**Never:** no change to the ledger's split rules or error codes; no preference to ungroup (the epic forbids it); no flat-row icon mode; no attachment UI (Story 19.3); no QA screenshot committed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| New split | −100,00 €, line 1 « 60 », add « Maison » « 40 » | counter −100,00 € red then 0,00 €; « Diviser » enabled at zero; list shows parent and two children |
| Filter | category of one child | parent + that child; count 1; totals −60 |
| Pages | children on pages 1 and 2 | parent on both |
| Edit | change amounts, keep ids | children keep tags; counter starts at zero |
| Unsplit | confirm from a child's sheet | one row again, focus on it |
| Not splittable | transfer, pending, excluded, duplicate | no « Diviser » |
| API refusal | `NOT_SPLITTABLE` from a stale sheet | toast, dialog open |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger/queries.ts:256` `listTransactionPage` -- factor its select so a new `listTransactionsById(deps, ids)` returns `TransactionListRecord[]` with no filter; spec in `queries.spec.ts` (ledger at 100 % branches).
- `packages/api/src/services/transactions.ts:84` `TransactionListItem`, `:96` pages, `:156` `listItemsOf`, `:214` `listAccountTransactions`, `:294` `listAllTransactions` -- `splitParent`, `splitParents`. `findTransactions` (MCP) maps items explicitly: unchanged output.
- `packages/api/src/routes/transactions.spec.ts:314` list block, `routes/accounts.spec.ts` -- `splitParents` assertions.
- `packages/app/src/lib/transaction-days.ts` `groupByDay` -- add the per-day split grouping, pure, with `transaction-days.spec.ts`.
- `packages/app/src/components/TransactionList.tsx` -- extract the row into a component, add the parent row and nested children; `splitParents` prop; `StatusBadge.tsx` gains `split` (lucide `SplitIcon`).
- `packages/app/src/routes/_authed.transactions.tsx:310`, `routes/_authed.accounts.$accountId.tsx:164` -- pass `splitParents`.
- `packages/app/src/hooks/useTransactions.ts` -- `useSplit(id, enabled)`, `useSplitTransaction`, `useEditSplit`, `useUnsplitTransaction` (typed client `api.transactions[":id"].split`), invalidating like `useInvalidateBulk({ balances: false })` plus recurring; `lib/query-keys.ts` `transactions.split(id)` under `transactions.all`.
- `packages/app/src/components/TransactionForm.tsx` -- role from `splitParent`/`parentEntryId`, disabled fields, hidden blocks, `SplitBlock` first; `TransactionSheet.tsx` `survivor` ref takes the parent id (rename `onMerged` to a row-to-focus callback).
- `packages/app/src/components/AmountField.tsx`, `DateField.tsx` -- `disabled`; `AmountField` `defaultNature`, `natureLabel`. `TransactionFields.tsx` `CategoryField` -- `id` and `aria-label` props.
- New `components/TransactionSplit.tsx` (`SplitBlock`), `components/SplitDialog.tsx` (react-hook-form `useFieldArray`, `zodResolver(splitTransactionSchema(currency), undefined, { raw: true })`, `applyFieldErrors` with the lines' paths); models: `BudgetMoveDialog.tsx`, `DuplicateDialog.tsx`, `ConfirmDialog` (`cancelLabel`).
- `packages/app/src/locales/fr.json` `transactions` -- `split.*`; `errors.fields` already has `split_sum_mismatch`, `not_a_child`; `errors.NOT_SPLITTABLE`, `TRANSACTION_SPLIT` exist.
- `packages/app/e2e/fixtures.ts:166` `apiHelpers` -- `splitTransaction(id, lines)`; new `e2e/splits.spec.ts` beside `transactions.spec.ts` patterns.
- Docs: `docs/sure-parity.md` split rows.

## Tasks & Acceptance

**Execution:**
- [x] `services/ledger/queries.spec.ts`, `routes/transactions.spec.ts`, `routes/accounts.spec.ts` -- first: `splitParents` and `splitParent` on both lists, filtered and paged; then `queries.ts`, `services/transactions.ts`.
- [x] `lib/transaction-days.spec.ts` -- first: grouping order, siblings on the same day, parent missing, page cut; then `transaction-days.ts`.
- [x] `e2e/splits.spec.ts` -- one test per acceptance criterion of the story, with the fixture helper.
- [x] Hooks, query key, `StatusBadge`, `TransactionList`, the two pages.
- [x] `AmountField`, `DateField`, `CategoryField` props; `SplitDialog`, `SplitBlock`, `TransactionForm`, `TransactionSheet`; `fr.json`.
- [x] `docs/sure-parity.md`.

**Acceptance Criteria:**
- Given Story 19.2 of `epics.md`, when it ships, then each criterion holds with this spec's decisions, each proven by a Playwright test.
- Given `pnpm test`, when it runs, then `services/ledger/**` stays at 100 % of branches.

## Design Notes

Ordering inside a group needs no new API field: `childIdsOf` orders children `createdAt asc, id asc` and the list `createdAt desc, id desc`, so reversing a day's siblings gives the line order the dialog and the parent's sheet show.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, ledger coverage 100 %
- `until mkdir /tmp/archant-e2e.lock 2>/dev/null; do sleep 10; done; pnpm test:e2e; rmdir /tmp/archant-e2e.lock` -- expected: green

## Implementation Notes

- `CategoryField`'s `aria-label` is a function of the shown name, so a line's category reads « Catégorie de la ligne N : <choice> » and keeps its value in its name. The label and amount fields take the line through a visually hidden suffix of their `<label>`.
- Every split action drops the cached splits and only marks the series stale (`useInvalidateSplit`): refetching a line the action deleted answers 404 through react-query's three retries, which held the mutation, and the sheet, for seconds.
- The selection's `Shift`+click range follows the rows as shown (`shownOrder`), lines grouped under their parent.
- A pending row offering no « Diviser » is proven by a Playwright test whose list answer is rewritten, as `transaction-rows.spec.ts` does: only a bank sync raises the state.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| thermo, edge | `SplitDialog`'s submit bubbles through the portal to the sheet's `<form>`, which PATCHes stale values and closes the sheet | high | `SplitBlock` renders inside `transaction-form`; React propagates synthetic events along the component tree; the thermo layer reproduced it in Chromium | patch |
| edge | `⌘Enter` in a dialog of the sheet bubbles to the sheet's `onKeyDown` and saves it | medium | Same portal propagation; `onKeyDown` checks no target | patch |
| edge | A stale `survivor` ref focuses an old parent row after the outer form closed the sheet first | false | Caused only by the bubbling submit; `onCloseAutoFocus` resets the ref on every close | rejected |
| edge, blind | `useSplit` retries `NOT_FOUND` three times: a parent deleted from its sheet holds the confirmation for seconds, a split undone elsewhere shows a skeleton then a toast | medium | `app.tsx` retries every code but `UNAUTHORIZED`; `useInvalidateAccount` refetches the active split query after the delete | patch: `useAccount`'s `retry` and `notFoundInline` |
| edge | `removeQueries` under a mounted `useSplit` may flash a skeleton | low | The sheet closes in the same handler; no user meets it | rejected |
| edge, blind | A zero-amount parent starts new lines on « Revenu » | low | `parent.amount < 0 ? "expense" : "income"`; a one-character fix | patch |
| edge | An edited line of `0,00` starts its toggle on « Revenu » | low | `initialNature` reads an unsigned zero as income; rare, and the fix touches every amount field | rejected |
| edge, blind, spec, thermo | A line's category loses its line number while the categories load | low | `CategoryField` applies its name only when `name !== null`; four layers met it | patch |
| edge | Adding or removing a line while a submit is in flight shifts the API's `lines.N` errors | low | Only the submit button is disabled; disabling the two buttons is direct | patch |
| edge | A split undone between the page read and `listTransactionsById` comes back with `splitParent: true` | low | Needs a write between two reads of one request; the next refetch heals it | rejected |
| blind, spec | `not_a_child` on `lines.N.id` falls to the generic `VALIDATION_ERROR` toast | low | `LINE_FIELDS` lacks `id`; its translation exists and is never shown | patch: under the counter |
| standards | `showError` re-implements `applyFieldErrors` with its own regex | low | The spec names `applyFieldErrors` with the lines' paths | patch |
| standards | The dialog is 576 px, not DESIGN.md's 550 px | low | `sm:max-w-xl`; DESIGN.md « Components » fixes 550 px | patch |
| standards | EXPERIENCE.md says a sheet opens no dialog but a confirmation | low | Pre-existing: `TransferDialog` and `DuplicateDialog` already open from the sheet, and Story 19.2 asks for a dialog | defer |
| standards | The counter's red contradicts « expenses never shown in red » | false | The counter is an error state the story asks to turn red; it shows no expense | rejected |
| thermo | `Skeleton`, a `div`, sits in a `span` in the parent's lines | low | Invalid nesting React warns about; direct fix | patch |
| blind, thermo | Every `listAllTransactions` call reads parents, `find_transactions` and the category sheet's three rows included; the two `listItemsOf` run in sequence | low | One primary-key read when a page holds lines; running both together is direct, skipping it for callers adds a parameter | patch: concurrent only |
| standards | `listItemsOf(deps, records, true)`, `ITEM`, the `survivor` ref, `nature: "expense" \| "income"` read poorly | low | Names that no longer say what they hold; direct renames | patch |
| standards | Duplicated `inSplit`, twin mutation hooks, the e2e `toast` helper, `hundred`, the `reduce` chain, the refactor beside the feature | low | Repo patterns (one hook per verb, per-file helpers, no `await` in loops); the spec asked for the row extraction | rejected |
| verification-gap, blind, spec | No test: parent row without category chip, a line's field error, `Shift`+click across a split, no « Diviser » on a parent, « Diviser » disabled while the form is dirty | medium | `splits.spec.ts` asserts none of them | patch: Playwright assertions |
| verification-gap | The volume test never reads split parents | medium (unverified) | `history-volume.spec.ts` seeds no split; the read is by primary key over at most a page's parents | defer |
| blind | Bulk delete and exclusion skip ticked lines silently | low | Story 19.1's recorded decision, as Sure's `bulk_deletions_controller`; lines were already selectable | rejected |
| blind | A line's merchant is locked in the form only | low | As Sure's drawer; recorded in `docs/sure-parity.md` | rejected |
| blind | `linesError` stays after the lines change | low | Only `too_small`/`too_big`, which the dialog's own limits prevent | rejected |
| blind | The parent's category stays editable though shown nowhere | low | As Sure's drawer | rejected |
| blind | Spec and sprint status disagree | false | Both reach `done` together before the pull request | rejected |
| blind, spec | Implementation notes contradict each other on the pending test | low | Stale bullet | patched in the notes |
| spec | The split query is dropped, not refetched, after an action | false | Recorded in the notes; the sheet closes, and the next opening reads it | rejected |
