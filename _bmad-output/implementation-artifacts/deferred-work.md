- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-create-an-account-and-see-it-listed.md`
  summary: Test `unwrap` in `packages/web/src/lib/api.ts` against a 400 with fields, an unknown code, the proxy's HTML page and a rejected fetch.
  evidence: No spec references `unwrap` or `ApiError`; losing `fields` there would send every validation error to the generic toast without failing a test.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-create-an-account-and-see-it-listed.md`
  summary: Update the Quick Setup section of `AGENTS.md`, which still says no package exists and there is nothing to start.
  evidence: Story 1.1 creates the three packages and the four start commands work; the review workflow routes agent-context edits to deferred work.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-record-transactions-by-hand.md`
  summary: Chunk the `entries` and `transactions` inserts of `ledger.ingest`, as `recomputeBalances` chunks balance rows.
  evidence: At 9 bound parameters per entry row, a statement of about 3 600 lines exceeds SQLite's 32 766-parameter cap; NFR10 targets 5 000-line imports in Epic 2. Manual ingest writes one line, so Story 1.2 cannot reach it.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-3-daily-balance-history.md`
  summary: Test that `/comptes/$accountId` falls back to `1M` on an unknown `period` and keeps `period` across pagination links.
  evidence: The web package has no route or component test harness; reverting the pagination `search` updaters or the `.catch` passes every test today.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-balance-snapshots.md`
  summary: Test the account page's Soldes tab, snapshot dialog and `tab` search param with a component or end-to-end harness.
  evidence: The web package tests `lib/` only; reverting the tab wiring or the dialog's delete path passes every test today.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-list-and-filter-transactions-across-accounts.md`
  summary: Command palette on `⌘K` and the keyboard shortcuts of `EXPERIENCE.md`, now Story 1.8.
  evidence: A global layer serving every page, not the list; `x` selection has no action before Story 4.5's bulk bar. Split by the project owner on 2026-09-21.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-7-end-to-end-tests-for-the-interface.md`
  summary: Test that a `PORT` written only in the root `.env` becomes the proxy target of `vite.config.ts`.
  evidence: The suite passes `PORT` through `process.env`, which `loadEnv` overlays on the files; pointing `loadEnv` at the package directory passes every test. A pure `apiTarget(envDir, mode)` tested by Vitest would cover it.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-list-and-filter-transactions-across-accounts.md`
  summary: Invalidate `queryKeys.transactions.all` when an account is renamed, deactivated or deleted, so `/operations` never shows a stale `accountName` or chip.
  evidence: Story 1.6 adds those account writes; today only transaction writes invalidate the cross-account list.
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
- source_spec: `_bmad-output/implementation-artifacts/spec-3-1-first-launch-setup-and-sign-in.md`
  summary: Document in `docs/deployment.md` that `TRUSTED_PROXIES` must list the reverse proxy in front of the container (for instance the Docker network's CIDR), with `BETTER_AUTH_URL` and `BETTER_AUTH_SECRET`.
  evidence: Story 3.1 adds the variables and explains them in `.env.example` only; behind an unlisted proxy every visitor shares the proxy's sign-in limit, so one stranger can slow the owner's sign-in. Story 3.3 writes the deployment page.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-2-sign-out-change-password-reset-from-the-server.md`
  summary: Run `cli/reset-password.ts` through its prompts in a test, covering the mapping from each refusal to its French sentence and the exit code.
  evidence: The spec covers the terminal check only; reaching the prompts needs a pseudo-terminal, a dependency the repository does not have. Swapping two entries of `MESSAGES`, or exiting 0 on a failure, breaks no test today. Every piece of logic behind them is covered separately in `services/password.spec.ts` and `lib/prompt.spec.ts`.
- source_spec: `_bmad-output/implementation-artifacts/spec-3-3-run-archant-from-one-container.md`
  summary: Write the container backup procedure in `docs/deployment.md`: `VACUUM INTO` through the running server's volume, since the image carries no `sqlite3` and copying `archant.db` without its WAL loses the latest writes.
  evidence: The Backups section predates Story 3.3 and names no command; the architecture says backups are documented with `VACUUM INTO`, and a household on the container has no documented way to take a consistent copy.
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
  evidence: medium. Transfer matching leaves the category in place (`services/ledger.ts`) and `countsInCashFlow` counts these outflows by category; `TransactionList.tsx` hides the category of any transfer side. Decide whether a spent transfer outflow shows and edits its category, as Sure lets a loan payment keep one.
- source_spec: `_bmad-output/implementation-artifacts/spec-7-3-property-and-vehicle-accounts.md`
  summary: Group the account form's « Type » select by account type, now that it lists 17 kinds in one flat list.
  evidence: `CreateAccountDialog.tsx` renders `ACCOUNT_KINDS.map` as flat `SelectItem`s since Story 1.1; Story 7.3 raised it from 10 to 17 entries.
- source_spec: `_bmad-output/implementation-artifacts/spec-8-1-create-a-categorisation-rule.md`
  summary: Rule amount conditions store minor units of the reporting currency without the currency code.
  evidence: `getReportingCurrency()` returns a constant today; if it becomes a `settings` row, stored amounts would be read at another scale (EUR to JPY) without warning. Store the currency beside the value or migrate them when the setting ships.
- source_spec: `_bmad-output/implementation-artifacts/spec-9-1-detect-recurring-transactions.md`
  summary: `next_expected_date` lands on the day after the latest row when that row came early across a month end, e.g. rows on 07-01, 08-02 and 08-31 give 09-01 instead of 10-01.
  evidence: medium. `detectRecurring` takes the month after the latest row on the expected day, as Sure's `calculate_next_expected_date` does; a bill paid on the 1st or the 31st is common. Story 9.2 sorts and shows this date: pick the expected-day date nearest to one month after the latest row.
- source_spec: `_bmad-output/implementation-artifacts/spec-9-1-detect-recurring-transactions.md`
  summary: A stored pattern that detection no longer finds stays as it was, so a pattern regrouped under a merchant assigned later leaves its label-keyed twin behind, and a reverted import leaves counts and dates computed on deleted rows.
  evidence: medium. Story 9.1 keeps undetected rows as Sure does; Story 9.2's inactive transition (no occurrence for more than two expected periods) must cover both, or the page lists them as current.
- source_spec: `_bmad-output/implementation-artifacts/spec-9-2-recurring-transactions-page.md`
  summary: A confirmed or inactive pattern that detection does not find again keeps its dates, so its next date slips into the past; a manual add or a confirm on an old row keeps its old dates too.
  evidence: medium. Detection refreshes only the patterns it finds, as Sure's identifier does; Sure runs a separate pass over manual rows. A manual item whose transaction has fewer than three occurrences in three months shows a past « Prochaine échéance » until detection finds it.

- source_spec: `_bmad-output/implementation-artifacts/spec-10-1-connect-a-bank.md`
  summary: The CI `image` job does not check that `docker-compose.yml` passes the Enable Banking variables and `ENCRYPTION_KEY` to the container.
  evidence: The job sets only `BETTER_AUTH_SECRET` and never calls `GET /api/bank-connections/setup`; a typo in one of the three pass-through lines stays green.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-2-link-bank-accounts.md`
  summary: The `current_anchor` is dated today even when it comes from `CLBD`, whose `reference_date` is often yesterday, so today's booked transactions would be subtracted once too many going backward.
  evidence: `balanceSchema` drops `reference_date`; `linkBankAccount` writes `today(deps.timeZone)`. Harmless while only files feed entries; Story 10.3 imports today's transactions and should date the anchor from the balance.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-2-link-bank-accounts.md`
  summary: No test proves that a failure in the middle of `linkBankAccounts`'s write transaction leaves nothing written.
  evidence: Every tested failure happens before the first write; removing the outer transaction keeps all tests green. Only a concurrent request reaches a mid-batch failure today.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-3-sync-transactions-and-balances.md`
  summary: Merging or dismissing a possible duplicate, with its « Doublon possible » marker, moved to Story 10.6.
  evidence: Story 10.3's criterion assumed Epic 2 shipped the merge; `transactions.possible_duplicate` is written but nothing shows or clears it, and `ledger.absorb` arrives with 10.4.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-3-sync-transactions-and-balances.md`
  summary: A button sync on a connection whose consent has ended answers 200 and shows « Synchronisation terminée » although nothing was read.
  evidence: `syncOne` returns `skipped` for both triggers; Story 10.5 adds the « consent expired » status and should refuse the button with it.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-3-sync-transactions-and-balances.md`
  summary: A synced transaction the user deletes comes back on the next sync while its date is inside the 7-day overlap.
  evidence: Deleting an entry deletes its `entry_keys`, so the next read finds no key; keeping a tombstone key for bank-sourced deletions would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-3-sync-transactions-and-balances.md`
  summary: No test covers the « Synchronisation terminée » toast or the silent `SYNC_TOO_RECENT` after linking.
  evidence: The e2e clicks « Synchroniser » only in a refused state; the API paths behind both are covered.

- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: A pending line the bank keeps listing beside its booked version, same line or with new figures and no reference, lives as a second entry counted in the balance until two misses delete it.
  evidence: Step 3 never merges a pending line by amount, so a second purchase of the same amount is never lost; Sure instead drops pending rows that match a booked row by fingerprint or `entry_reference` (`enable_banking_item/importer.rb:466-526`).
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: Two misses an hour apart delete a pending entry, with what the user set on it, when the bank drops the pending line a little before listing the booked one.
  evidence: The one-hour gap between button syncs is the only spacing; a minimum delay between misses would need the intent's « two consecutive syncs » renegotiated.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: Pending entries of a deleted or disconnected connection lose `connection_id` on their keys, so no sync absorbs or deletes them and they stay in the balance.
  evidence: medium. Story 10.5's disconnection should delete or book the connection's pending entries when it turns the anchor into a reconciliation.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: The second of two identical same-day pending lines without a reference is taken for the first once the first is booked, then deleted after two misses and recreated when booked.
  evidence: medium. The fingerprint's occurrence index shifts when the statement loses the first pending line; the booked entry keeps the old pending fingerprint. Fixing it changes AD-7's keys.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-4-pending-transactions.md`
  summary: A `PDNG` line with no `booking_date` and a future `value_date` would be dated in the future, so today's balance would leave it out.
  evidence: unverified. A real bank's pending payload settles it; the fixtures carry `transaction_date` only, and AD-18 fixes the date order.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-5-consent-renewal-and-disconnection.md`
  summary: Disconnect revokes the session before the ledger transaction, so a failed unlink leaves an active connection on a revoked session until the user disconnects again.
  evidence: low. The intent orders revoke, unlink, delete; Sure unlinks first. A retry completes because a second revocation's 404 is ignored.
- source_spec: `_bmad-output/implementation-artifacts/spec-10-6-merge-or-dismiss-a-possible-duplicate.md`
  summary: No end-to-end test drives the sheet's « Doublon possible » block through a merge or dismissal refused because another tab resolved it first.
  evidence: `DuplicateBlock.failed` handles `DUPLICATE_RESOLVED`, `NOT_FOUND` and `VALIDATION_ERROR`, but `e2e/duplicates.spec.ts` only covers the successful paths.
