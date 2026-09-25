- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-end-to-end-tests-for-the-interface.md`
  summary: Test that a `PORT` written only in the root `.env` becomes the proxy target of `vite.config.ts`.
  evidence: The suite passes `PORT` through `process.env`, which `loadEnv` overlays on the files; pointing `loadEnv` at the package directory passes every test. A pure `apiTarget(envDir, mode)` tested by Vitest would cover it.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-list-and-filter-transactions-across-accounts.md`
  summary: Assert with `EXPLAIN QUERY PLAN` that the unfiltered transaction list uses `entries_kind_date` and no temporary B-tree.
  evidence: The first page takes 11 ms without the index at 50,000 rows, so the 300 ms test cannot see it disappear.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-8-command-palette-and-keyboard-shortcuts.md`
  summary: Add the « Opérations » group to the command palette (search by label from 3 characters, opening the transaction's sheet) and recent items first when the query is empty, as EXPERIENCE.md describes.
  evidence: Story 1.8 lists only Aller à, Actions and Comptes; opening a transaction's sheet from any page needs a global sheet host that no page has today.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-an-ofx-file-with-preview.md`
  summary: A bank that reuses a `FITID` across files would have a new line recognised as already present through its `ext:` key.
  evidence: Unverified, medium if true. AD-7 treats any key hit as present; real exports showing cross-file FITID reuse would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-1-import-an-ofx-file-with-preview.md`
  summary: No end-to-end test covers an accepted opening-date move surviving an `IMPORT_PREVIEW_STALE` re-preview.
  evidence: `ImportDialog` re-previews with `preview.opening?.date`; the stale test never accepts the move.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-2-use-the-ofx-ledger-balance.md`
  summary: Check whether banks write `DTASOF` at midnight to mean the end of the day before, which would put the imported snapshot one day late.
  evidence: Unverified, medium if true. `providerDate` keeps the first eight digits of `DTASOF`; real exports whose `DTASOF` has a midnight time and lines posted that day would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-3-import-a-csv-file-with-a-saved-mapping.md`
  summary: Check whether a French bank writes `0,00` in the unused debit or credit column, which the CSV source rejects as both cells filled.
  evidence: Unverified, medium if true: every line of such an export would land under Rejetées. A real export with debit and credit columns would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-2-4-import-a-qif-file.md`
  summary: Check whether a French Quicken or Microsoft Money QIF export writes its starting balance under a French payee such as « Solde d'ouverture », which the QIF source would import as a transaction.
  evidence: Unverified, medium if true. `toLine` recognises only `Opening Balance`; a real French export would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-sign-out-change-password-reset-from-the-server.md`
  summary: Run `cli/reset-password.ts` through its prompts in a test, covering the mapping from each refusal to its French sentence and the exit code.
  evidence: The spec covers the terminal check only; reaching the prompts needs a pseudo-terminal, a dependency the repository does not have. Swapping two entries of `MESSAGES`, or exiting 0 on a failure, breaks no test today. Every piece of logic behind them is covered separately in `services/password.spec.ts` and `lib/prompt.spec.ts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-default-categories-and-category-management.md`
  summary: Group the delete-replacement and merge-target pickers by kind, with children indented, by reusing the category combobox of Story 4.2.
  evidence: Both pickers list every category in one alphabetical list, so the user cannot tell an income category from an expense one or a child from a parent.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-1-default-categories-and-category-management.md`
  summary: Cover the command palette's « Catégories » entry in `e2e/keyboard.spec.ts`.
  evidence: Removing or misrouting the `go-categories` item in `CommandPalette.tsx` breaks no test today.
- source_spec: `_bmad-output/implementation-artifacts/spec-4-4-tags.md`
  summary: Test in `e2e/tags.spec.ts` and `e2e/merchants.spec.ts` that renaming to a taken name shows « … porte déjà ce nom. » under the field and keeps the dialog open.
  evidence: The API refusal is tested; removing the `name_taken` branch of `RenameTagDialog` or `RenameMerchantDialog` breaks no test today.
- source_spec: `_bmad-output/implementation-artifacts/spec-7-1-loan-accounts.md`
  summary: A `loan_payment` or `investment_contribution` outflow categorised before its match counts in that category on the dashboard, while its row shows the transfer chip and offers no way to change the category.
  evidence: medium. Transfer matching leaves the category in place (`services/ledger.ts`) and `countsInCashFlow` in `domain/cash-flow.ts` counts these outflows by category; `TransactionList.tsx` hides the category of any transfer side. Decide whether a spent transfer outflow shows and edits its category, as Sure lets a loan payment keep one.
  planned: Story 11.3 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-7-3-property-and-vehicle-accounts.md`
  summary: Group the account form's « Type » select by account type, now that it lists 17 kinds in one flat list.
  evidence: `CreateAccountDialog.tsx` renders `ACCOUNT_KINDS.map` as flat `SelectItem`s since Story 1.1; Story 7.3 raised it from 10 to 17 entries.
- source_spec: `_bmad-output/implementation-artifacts/spec-8-1-create-a-categorisation-rule.md`
  summary: Rule amount conditions store minor units of the reporting currency without the currency code.
  evidence: `getReportingCurrency()` returns a constant today; if it becomes a `settings` row, stored amounts would be read at another scale (EUR to JPY) without warning. Store the currency beside the value or migrate them when the setting ships.
- source_spec: `_bmad-output/implementation-artifacts/spec-9-1-detect-recurring-transactions.md`
  summary: A stored pattern that detection no longer finds stays as it was, so a pattern regrouped under a merchant assigned later leaves its label-keyed twin behind, and a reverted import leaves counts and dates computed on deleted rows.
  evidence: medium. `detectRecurring` in `services/recurring.ts` turns a `detected` row `inactive` only once `isStale` sees no occurrence for two months, reading the stored `last_occurrence_date`; until then the twin and the reverted pattern are listed as current, and a `confirmed` one never leaves.
  planned: Story 11.8 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-9-2-recurring-transactions-page.md`
  summary: A confirmed or inactive pattern that detection does not find again keeps its dates, so its next date slips into the past; a manual add or a confirm on an old row keeps its old dates too.
  evidence: medium. Detection refreshes only the patterns it finds, as Sure's identifier does; Sure runs a separate pass over manual rows. A manual item whose transaction has fewer than three occurrences in three months shows a past « Prochaine échéance » until detection finds it.
  planned: Story 11.8 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-1-connect-a-bank.md`
  summary: The CI `image` job does not check that `docker-compose.yml` passes the Enable Banking variables and `ENCRYPTION_KEY` to the container.
  evidence: The job sets only `BETTER_AUTH_SECRET` and never calls `GET /api/bank-connections/setup`; a typo in one of the three pass-through lines stays green.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-2-link-bank-accounts.md`
  summary: No test proves that a failure in the middle of `linkBankAccounts`'s write transaction leaves nothing written.
  evidence: Every tested failure happens before the first write; removing the outer transaction keeps all tests green. Only a concurrent request reaches a mid-batch failure today.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-3-sync-transactions-and-balances.md`
  summary: A synced transaction the user deletes comes back on the next sync while its date is inside the 7-day overlap.
  evidence: Deleting an entry deletes its `entry_keys`, so the next read finds no key; keeping a tombstone key for bank-sourced deletions would settle it.
  planned: Story 11.6 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-3-sync-transactions-and-balances.md`
  summary: No test covers the « Synchronisation terminée » toast or the silent `SYNC_TOO_RECENT` after linking.
  evidence: `e2e/bank-connections.spec.ts` clicks « Synchroniser » only in refused states (`SYNC_TOO_RECENT` after a first sync, `CONSENT_EXPIRED`); the API paths behind both are covered.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: A pending line the bank keeps listing beside its booked version, same line or with new figures and no reference, lives as a second entry counted in the balance until two misses delete it.
  evidence: Step 3 never merges a pending line by amount, so a second purchase of the same amount is never lost; Sure instead drops pending rows that match a booked row by fingerprint or `entry_reference` (`enable_banking_item/importer.rb:466-526`).
  planned: Story 11.5 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: Two misses an hour apart delete a pending entry, with what the user set on it, when the bank drops the pending line a little before listing the booked one.
  evidence: The one-hour gap between button syncs is the only spacing; a minimum delay between misses would need the intent's « two consecutive syncs » renegotiated.
  planned: Story 11.5 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: The second of two identical same-day pending lines without a reference is taken for the first once the first is booked, then deleted after two misses and recreated when booked.
  evidence: medium. The fingerprint's occurrence index shifts when the statement loses the first pending line; the booked entry keeps the old pending fingerprint. Fixing it changes AD-7's keys.
  planned: Story 11.5 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: A `PDNG` line with no `booking_date` and a future `value_date` would be dated in the future, so today's balance would leave it out.
  evidence: unverified. A real bank's pending payload settles it; the fixtures carry `transaction_date` only, and AD-18 fixes the date order.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-5-consent-renewal-and-disconnection.md`
  summary: Disconnect revokes the session before the ledger transaction, so a failed unlink leaves an active connection on a revoked session until the user disconnects again.
  evidence: low. The intent orders revoke, unlink, delete; Sure unlinks first. A retry completes because a second revocation's 404 is ignored.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-6-merge-or-dismiss-a-possible-duplicate.md`
  summary: No end-to-end test drives the sheet's « Doublon possible » block through a merge or dismissal refused because another tab resolved it first.
  evidence: `DuplicateBlock.failed` handles `DUPLICATE_RESOLVED`, `NOT_FOUND` and `VALIDATION_ERROR`, but `e2e/duplicates.spec.ts` only covers the successful paths.
- source_spec: `docs/sure-parity.md`
  summary: A manual account created with the default opening date, today, refuses a transaction dated today.
  evidence: medium, confirmed. `CreateAccountDialog.tsx` defaults `openingDate` to today and `rejectionFor` in `domain/statement.ts` refuses `line.date <= openingDate`. Sure defaults the opening date to two years back, or the day before the oldest entry.
  planned: Story 11.1 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `docs/sure-parity.md`
  summary: The automatic transfer matcher takes excluded transactions and transactions of deactivated accounts as candidates.
  evidence: medium. `candidateOf` in `services/ledger.ts` and `isTransferCandidate` in `domain/transfer-matching.ts` check neither; Sure's `auto_transfer_matchable.rb` requires `excluded = FALSE` and an active account. Such a row can also be a second candidate that blocks the real pair's mutual uniqueness.
  planned: Story 11.2 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `docs/sure-parity.md`
  summary: Enable Banking: a failing balance call fails the account's whole sync, a `WRONG_TRANSACTIONS_PERIOD` refusal is never retried with a shorter window, and an error after the first page throws away the pages already read.
  evidence: medium. `fetchStatement` awaits `fetchBalance` in `connectors/enable-banking/client.ts`; Sure keeps the old balance, retries 89/60/30 days, and keeps partial pages. An account whose window outgrows what the bank allows fails on every sync.
  planned: Story 11.4 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `docs/sure-parity.md`
  summary: Enable Banking: the consent asks for exactly the bank's `maximum_consent_validity`, and one operation sent twice in the same response creates two entries.
  evidence: medium. Sure trims 60 seconds because clock drift made banks refuse the consent, and deduplicates a response by content (Sure issue #954).
  planned: Story 11.4 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `docs/sure-parity.md`
  summary: A synced account's `current_anchor` is replaced on every sync instead of turning the previous one into a reconciliation, so one bank figure rebuilds the whole history and a missing line shifts every past day.
  evidence: medium. `writeCurrentAnchor` in `services/ledger.ts` deletes and rewrites; Sure's `current_balance_manager.rb` keeps the chain. AD-8's own « Prevents » names this drift.
  planned: Story 11.7 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `docs/sure-parity.md`
  summary: No action unlocks a field the user set by hand, so no rule ever reaches it again.
  evidence: medium. Sure's `POST /transactions/:id/unlock` clears the locks; spec-4-2 left it to Epic 8, which never took it.
- source_spec: `docs/sure-parity.md`
  summary: Recurring detection ports Sure's detector as it was before 2026-08-31: exact amount grouping and a 5-day spread, where Sure now clusters amounts within 7.5 % and days within 2 of the expected day.
  evidence: low. `epic-9-context.md` and spec-9-1 say « as in Sure »; decide whether to port the new detector or record the older one as the choice.
- source_spec: `_bmad-output/implementation-artifacts/manual-qa-scenarios.md`
  summary: Reverting an import that moved the opening date keeps the moved date with the original amount, so importing the same file again counts its total twice.
  evidence: high, reproduced on a scratch instance: Livret A goes from 9 100,00 to 10 200,00 after revert then re-import of `manual-qa-files/05-livret-a.qif`. The revert in `services/ledger.ts` gives back the amount shifted on the opening anchor but not its date.
  planned: Story 11.1 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/manual-qa-scenarios.md`
  summary: Renaming a recurring series or setting its merchant makes the next detection create it a second time, and the old item stays until it goes stale.
  evidence: medium, reproduced: Netflix listed twice. `services/recurring.ts` keys an item on its merchant, or else its label, and the edit changes that key.
  planned: Story 11.8 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/implementation-artifacts/manual-qa-scenarios.md`
  summary: The import preview's explanation under the matched group says the lines were entered by hand, even when they came from another file.
  evidence: low, reproduced. The `fr.json` string predates Epic 2's cross-file matching.
  planned: Story 11.1 in `_bmad-output/planning-artifacts/epics.md`.
