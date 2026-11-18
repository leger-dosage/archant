---
title: "Story 31.3: Split lines as Sure shows and edits them"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'cc2bc04b31023a7dedab2e04447257e9ae51c8b9'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-31-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) takes a signed amount per split line (`splits/new.html.erb`, the parent's `-amount` as the total), lets each user list lines flat (`User#show_split_grouped?`, « Grouper les transactions fractionnées » in its appearance settings), disables a line's name, date, amount, category and merchant in its drawer (`transactions/show.html.erb`), and lets a line be a transfer candidate (`transfer_match_candidates` leaves out only excluded entries). Archant shows a Dépense / Revenu toggle per line, always groups, lets a line edit its label and category, and never matches a line.

**Approach:** The split dialog's amount becomes a plain signed text field; a per-user `users.show_split_grouped` column (default on) is edited from « Réglages › Préférences » and read by both list routes, which return no split parents when it is off, as Sure's controllers; the sheet disables a line's label and category, and `updateTransaction` refuses them; `matchableSide` and `isTransferCandidate` stop excluding split lines, the parent staying out because it is excluded.

## Boundaries & Constraints

**Always:**
- Amounts stay integer minor units, signed as the ledger stores them (negative is an expense, AD-5); the counter and the disabled submit stay.
- `PATCH /api/transactions/:id` on a line answers `409 TRANSACTION_SPLIT` when it changes the label, the category or the merchant; tags, notes and attachments stay editable. Bulk edit keeps giving lines every field but the date (Story 31.2, as `Entry.bulk_update!`).
- A line in a transfer behaves as any transfer side: deleting it (unsplit, a removed line in an edit, deleting the parent) deletes its transfer and its rejected pairs first; an edit that changes a kept line's amount deletes its transfer (AD-11).
- Matching runs after a split, an edit and an unsplit, as Sure's `sync_account_later` runs `auto_match_transfers!`.
- Visible text in Archant's words: « opérations », « divisée ».

**Never:** no change to how an edit keeps lines by id (Story 31.8); no « Rapprocher un virement » on a line's own sheet (Sure's `unless @entry.split_child?`); no new dependency; no change to duplicate detection.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signed split | -100 € parent, lines « -60 » and « -40 » | split saved | none |
| Mixed signs | -100 € parent, « -120 » and « 20 » | split saved, as Sure | none |
| Flat list | preference off | `splitParents` empty, lines are plain rows | none |
| Label on line | PATCH `{ label }` on a line | nothing written | `409 TRANSACTION_SPLIT` |
| Category on line | PATCH `{ categoryId }` on a line | nothing written | `409 TRANSACTION_SPLIT` |
| Tags on line | PATCH `{ tagIds, notes }` on a line | saved | none |
| Line matched | line -60 € in A, +60 € in B two days later | matcher proposes a pending transfer; the picker of the +60 € lists the line | none |
| Parent | parent -100 €, +100 € elsewhere | never a candidate (excluded) | none |
| Unsplit | a line in a transfer | transfer deleted, other side standard | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/views/splits/new.html.erb`, `app/javascript/controllers/split_transaction_controller.js`, `app/models/user.rb#show_split_grouped?`, `app/controllers/transactions_controller.rb` (`@split_parents`), `app/views/settings/appearances/show.html.erb` and `config/locales/views/settings/fr.yml` (`split_grouped_*`, `transactions_*`), `app/views/transactions/show.html.erb` (`disabled: @entry.split_child?`), `app/models/family/auto_transfer_matchable.rb`.
- `packages/data/schema/auth.ts` -- `users.showSplitGrouped` boolean, not null, default true; migration `packages/data/drizzle/0089_*` through `pnpm data generate`.
- `packages/api/src/schemas/preferences.ts`, `services/preferences.ts`, `routes/preferences.ts` -- both fields optional; `updatePreferences` sets what is given.
- `packages/api/src/services/transactions.ts` -- `pageItemsOf(deps, records, grouped)`; `listAccountTransactions` and `listAllTransactions` take `{ splitGrouped }` (default true for the assistant); `routes/transactions.ts` and `routes/accounts.ts` pass the signed-in user's preference (`getPreferences`, `signedInUser`).
- `packages/api/src/domain/transfer-matching.ts` -- drop `splitChild` from `TransferSide` and `isTransferCandidate`; `services/ledger/transfers.ts` -- drop it from `matchableSide`, `sideColumns`, `candidatePairQuery`.
- `packages/api/src/services/ledger/shared.ts` -- `deleteSplitChildren` deletes the lines' transfers and rejected pairs.
- `packages/api/src/services/ledger/splits.ts` -- `updateChild` deletes a kept line's transfer when its amount changes (with `clearOneTime`); `splitTransaction`, `editSplit`, `unsplitTransaction` call `matchTransfers(tx, now)` before returning.
- `packages/api/src/services/ledger/edits.ts` -- `updateTransaction`: label, category or merchant changed on a line → `refuseSplit(tx, [entryId], isSplitChild)`.
- `packages/api/src/mcp/transactions.ts` -- `update_transaction` description names the line's refused fields.
- `packages/app/src/components/SplitDialog.tsx` -- `LineAmount` a plain `Input` (no `inputMode="decimal"`: a phone's decimal pad has no minus); `AmountField` loses `defaultNature` and `natureLabel` if nothing else uses them; `fr.json` drops `transactions.split.natureOf`.
- `packages/app/src/components/TransactionForm.tsx` -- label `Input` and `CategoryField` disabled for `splitChild` (`CategoryField` gains `disabled`); `TransferBlock` shown for a line only when it is in a transfer.
- `packages/app/src/routes/_authed.settings.preferences.tsx`, `hooks/usePreferences.ts` -- section « Opérations » with a `Switch` « Grouper les opérations divisées »; a save invalidates `transactions.all` too.
- Docs: `docs/architecture.md` AD-11 and AD-20; `docs/sure-parity.md` « Split interface » Parity, « Splits » transfer clause; `docs/security-model.md` if it lists preferences.

## Tasks & Acceptance

**Execution:**
- [x] `domain/transfer-matching.spec.ts`, `services/ledger/splits.spec.ts`, `services/ledger/transfers.spec.ts`, `services/ledger/edits.spec.ts`, `routes/preferences.spec.ts`, `routes/transactions.spec.ts` -- tests first: the matrix.
- [x] Schema, migration, preferences, list services and routes -- the grouping.
- [x] Matching, `deleteSplitChildren`, `updateChild`, `updateTransaction` refusal, tool description.
- [x] `SplitDialog.tsx`, `AmountField.tsx`, `TransactionForm.tsx`, `TransactionFields.tsx`, preferences page and hook, `fr.json`.
- [x] `packages/app/e2e/splits.spec.ts` -- signed amounts, a negative split, a line's disabled label and category, grouping off then on.
- [x] Docs, story and sprint status to done.

**Acceptance Criteria:**
- Given the split dialog of a -100 € transaction, when « -60 » and « -40 » are typed, then « Reste à répartir » reads 0,00 € and « Diviser » saves.
- Given « Grouper les opérations divisées » turned off, when the list opens, then each line is its own row and no « Divisée » parent shows; turned back on, the parent returns.

## Implementation Notes

Decisions taken alone, the owner unavailable, each aligned with Sure:

- `PATCH /api/preferences` takes each field optionally, as Sure's `auto-submit-form` sends one control at a time; a body with neither field writes nothing and answers the preferences. The migration is `0089_show_split_grouped.sql`, renamed from Drizzle's generated name as the earlier ones.
- `transactionsRoutes` is now typed `Hono<SessionEnv>` so the list reads `signedInUser`; the assistant's `get_transactions` keeps reading lines grouped (`listAllTransactions`'s default), since an assistant has no « Préférences ».
- `isTransferCandidate` drops `splitChild` from `TransferSide` altogether rather than keeping a field nothing sets: the parent stays out through `excluded`, as Sure's SQL. The domain test « refuses a split line » goes with it; the ledger tests cover the line and the parent.
- `updateChild` deletes a kept line's transfer whenever the edit writes a new amount, and clears the one-time flag of both sides, as `updateTransaction` does for any side. Rejected pairs stay on a kept line, as on any side whose amount changes; a deleted line's go with it in `deleteSplitChildren`.
- The matcher runs inside each split write's own transaction, after the balance recompute, as `ingest` runs step 6 inside its own: a split and its proposals commit together.
- `updateTransaction` refuses `label`, `category` and `merchant` on a line only when they change, so the sheet's save, which always sends the unchanged label, still saves tags and notes. Tests that categorised a line through `updateTransaction` now set the category in the split itself or through `bulkUpdateTransactions`, which still reaches lines (Story 31.2).
- `AmountField` keeps its Dépense / Revenu toggle for the transaction sheet; only `defaultNature` and `natureLabel`, used by the split dialog alone, go. The split line's amount field shows Sure's `0.00` placeholder as « 0,00 ».
- The preference's description is Sure's `split_grouped_description` in Archant's words: « Affiche les lignes d'une opération divisée groupées sous l'opération dans la liste des opérations. Lorsque cette option est désactivée, chaque ligne apparaît comme une opération à part. » Saving it shows the toast the account order already shows on this page, « Votre profil a été mis à jour. »; Sure's `AppearancesController#update` redirects without a notice, and one page whose two controls answered differently would read as a failure.
- A matched line's sheet keeps `TransferBlock` as any side's, « Marquer comme récurrent » included; once dissociated there, the block goes, the line offering no picker.
- `get_transfer_candidates`'s description no longer says a split's line has no candidate, and `docs/deployment.md` names the line's refused fields beside `update_transaction`'s exclusion refusal.

## Spec Change Log

## Review Triage Log

First pass, `bmad-build` review (Blind Hunter, Edge Case Hunter, Verification Gap).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | « Annuler la division ? » does not say a line's transfer goes | low | reject | Sure's `unsplit_confirm` says nothing of it either; a matched line is rare and the other side stays. |
| 2 | « Modifier la division » does not warn that a changed or removed line loses its transfer | low | reject | Same as Sure's edit dialog; Story 31.8 rebuilds every line anyway. |
| 3 | `deleteSplitChildren` drops a line's transfer without `clearOneTime`, unlike `updateChild` (two layers) | low | reject | Every deletion path, `deleteTransactionRows` included, already drops a transfer without it; only edits and transfer actions reset the kind. |
| 4 | `updateChild`'s `clearOneTime` untested (two layers) | medium | patch | Test sets both sides one-time, changes the line's amount, both read `false`. |
| 5 | Merchant refusal on a line untested at the route | low | reject | Covered by the ledger's `it.each`; the route maps the same error. |
| 6 | A viewer sees a switch whose save is refused | false | reject | The settings route sends a viewer to « Sécurité » from any other page; `SettingsNav` lists only it. |
| 7 | `matchTransfers` after each split write is unmeasured at volume | low | reject | It already runs after every typed line and every import, which the volume project measures. |
| 8 | Nothing tells the user an expense is typed with a minus | low | reject | Sure's dialog shows the signed total and no hint; the counter shows the sign and the total to reach. |
| 9 | Spec says `in-review` while sprint status says done | low | patch | Both set to done after review. |
| 10 | Two comments badly wrapped, « a split is never moved twice » unclear | low | patch | Rewrapped, « the same money is never matched twice ». |
| 11 | AD-20 omits that a rule still applies to a line | low | patch | AD-20 says so beside the bulk edit. |
| 12 | `docs/deployment.md` omits that `get_transactions` ignores the grouping | low | reject | The tool's description already says a split is listed as its lines. |
| 13 | Account page grouping untested in the browser | low | reject | The API test covers `GET /api/accounts/:id/transactions`; the component is the same list. |
| 14 | A kept line whose amount changes keeps its rejected pairs | false | reject | `updateTransaction` keeps a side's rejected pairs on an amount change too; AD-11 deletes only the transfer. |
| 15 | The mixed-sign e2e line of +20 € may meet another test's -20 € row | medium | patch | The refund is a random amount. |
| 16 | The list refresh after the preference save is untested (reload every time) | medium | patch | The e2e test goes back through the app's history after turning grouping off. |

Second pass, `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). Every patch applied.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `deleteSplitChildren` leaves the other side one-time | low | reject | Carried from the first pass, #3. |
| 2 | A split edit may categorise a line that is an uncounted transfer inflow, past `refuseCategoryOnInflow` | low | reject | Needs a split line paired into a loan or contribution and recategorised in the dialog; the category stays hidden, as any such side's. |
| 3 | A positive line that is an inflow whose outflow the page holds leaves its split group | low | reject | `withoutShownInflows` shows a transfer once, as Sure's `entries_by_date` before `group_split_entries`. |
| 4 | A viewer flips a switch the server refuses (two layers) | false | reject | The settings route sends a viewer to « Sécurité » (`_authed.settings.tsx`); `viewer.spec.ts` checks `/settings/preferences`. |
| 5 | Splitting a parent once rejected with X into one full line proposes X again | low | reject | Sure keys rejections by transaction too; a one-line split of a rejected pair is rare. |
| 6 | `ListOptions`' grouped default has no caller | false | reject | `findTransactions`, the assistant's, calls `listAllTransactions` without options. |
| 7 | « Preferences » parity row still says the account order alone | low | patch | Names the « Transactions » section. |
| 8 | The viewer's kept grouping is not a recorded departure | low | patch | « Split interface » says a viewer keeps the grouping, as « Account ordering » does. |
| 9 | Fixed -60 € / -40 € helpers may now meet another row as transfers | maybe-false | reject | No e2e row of +60 € or +40 € falls within 4 days; each Vitest file has its own database and passes. |
| 10 | A line's own candidates are untested, while the API pairs from a line | low | reject | The search is symmetric by design; the ledger tests pair from both sides. |
| 11 | Empty `PATCH /api/preferences` untested (two layers) | medium | patch | Test sends `{}` and reads the preferences unchanged. |
| 12 | The « Opérations » section shows no load error | low | reject | « Général » above shows it for the page. |
| 13 | A save invalidates both accounts and transactions whatever changed | low | reject | One refetch per manual toggle. |
| 14 | `matchTransfers`' comment still overlong | low | patch | Rewrapped. |
| 15 | The grouping route test restores the preference without `finally` | low | patch | `finally` restores it. |
| 16 | The disabled label relies on react-hook-form dropping a disabled field | false | reject | `label` is optional in the patch schema and an unchanged label changes nothing; the e2e saves a line's notes. |
| 17 | « Split interface » omits attachments, the one-time flag and the transfer block | low | patch | Row names them. |
| 18 | The mixed-sign e2e checks only the positive line | low | patch | It checks the negative line's amount too. |
| 19 | A parent deleted with a line holding a rejected pair is untested | medium | patch | Test deletes it and reads no transfer and no rejected pair. |
| 20 | Wording differs from the story's « Grouper les transactions fractionnées » | low | reject | Recorded in Design Notes and the parity row: Archant's words. |
| 21 | Merchant refusal goes beyond the story and is tested only in the ledger | low | reject | Spec's « Always »; Sure disables it. |
| 22 | No new Vitest case for mixed signs | false | reject | `allows zero and mixed signs, as Sure` in `splits.spec.ts` covers it. |

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure or Archant's words:

- Words: « Grouper les opérations divisées », section « Opérations », « Personnalisez l'affichage des opérations », where Sure says « transactions fractionnées » and « Transactions »: Archant's list says « opérations » and its splits « divisée ».
- Archant has no « Apparence » page; the toggle sits in « Préférences », the per-user page that already holds Sure's account order.
- Grouping is read on the server, as Sure's controllers skip `@split_parents`, so the list never flickers from grouped to flat.
- The merchant is refused on a line too: Sure disables it beside the label and category, and a line takes its parent's (AD-20).
- A line's own sheet offers no picker, as Sure's; a matched line shows its transfer block so the proposal can be confirmed or refused there.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
