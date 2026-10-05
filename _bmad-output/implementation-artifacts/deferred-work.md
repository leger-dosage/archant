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
- source_spec: `_bmad-output/implementation-artifacts/spec-11-1-opening-dates-that-accept-today-and-survive-a-revert.md`
  summary: Reverting the older of two imports that both moved the opening date first leaves the date where the newer one found it, so re-importing the older file counts its lines past that date on top.
  evidence: medium, traced in `restoreOpening`: the older revert is blocked by the newer import's lines, and the newer revert restores its own `previous_opening_date`. Reverting newest first restores fully. A complete fix stores each import's shift or moved-to date, a migration.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-1-opening-dates-that-accept-today-and-survive-a-revert.md`
  summary: A moved-in line whose amount the user edited before the revert gives the edited amount back to the opening anchor, so the old opening day's balance drifts by the edit.
  evidence: medium, pre-existing since Spec 2.5: `revertImport` sums the current amounts of the deleted lines. Storing the shift on `imports` at confirm would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-5-pending-and-booked-versions-never-count-twice.md`
  summary: A new pending purchase with an `entry_reference` the ledger does not know, whose fingerprint names a booked entry holding another reference, is taken as that entry listed again, so the purchase never counts.
  evidence: medium, pre-existing: before Story 11.5 a pending line was looked up by fingerprint first. Creating such a line with `keepExisting` keys, as Story 11.5 does when the fingerprint names a pending entry, would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-9-a-first-start-that-says-what-is-wrong.md`
  summary: No automated test reaches the API server's `error` handler (`EADDRINUSE` or another listen failure) in `packages/api/src/index.ts`.
  evidence: The loopback probe always stops the process first in tests; removing the handler keeps the suite green. A portable way to make the bind fail after the probe (non-loopback address on Linux, privileged port) was not found.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-12-create-tags-merchants-and-categories-where-they-are-picked.md`
  summary: Test that a category created from the rule dialog's picker shows its name on the picker's button before the categories list is refetched.
  evidence: Removing the `setQueryData` call of `useCreateCategory` breaks no test: Playwright retries the button text until the refetch lands.

- source_spec: `_bmad-output/implementation-artifacts/spec-11-13-no-command-palette-and-no-single-key-shortcuts.md`
  summary: Add a « Aller au contenu » skip link before the sidebar, so a keyboard user reaches the page without tabbing through every account.
  evidence: With the `g` keys gone, reaching a transaction row at full width took over 100 `Tab` presses in the shared e2e database; `keyboard.spec.ts` runs at 900 px to stay under that.

- source_spec: `_bmad-output/implementation-artifacts/spec-11-14-enable-banking-set-up-from-the-interface.md`
  summary: With a bank still connected, credentials that no longer resolve (an `ENCRYPTION_KEY` lost or changed, or the `ENABLE_BANKING_*` variables removed) leave the page locked and every bank route at 503, disconnection included, so nothing unlocks it.
  evidence: medium, pre-existing since Spec 10.5: `disconnectConnection` needs a connector and a readable session id. Story 11.14 adds the environment-to-interface path to it. Disconnecting without revoking at the provider when no connector resolves would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-11-14-enable-banking-set-up-from-the-interface.md`
  summary: An unknown application ID may be answered by `GET /application` with a 4xx other than 401 or 403, which would show as `BANK_PROVIDER_ERROR` instead of `BANK_CREDENTIALS_REFUSED`.
  evidence: medium, unverified: the fake and the fixtures only return 401. One save against the sandbox with a mistyped application ID would settle it.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 13)
  summary: Scheduled, off-site backups of the database, for a machine at home that can die or be stolen.
  evidence: Deferred by the owner on 2026-09-27 as too much for the project's maturity. Compared: Litestream v0.5 (continuous to S3-compatible storage, no code, but no client-side encryption since v0.5, so the storage provider could read the transaction history) and offen/docker-volume-backup (nightly, GPG-encrypted, rotation and failure notifications, needing the server to write a nightly `VACUUM INTO` copy since copying a live WAL database can yield a broken file). The recommendation was offen/docker-volume-backup.
- source_spec: `_bmad-output/implementation-artifacts/spec-13-1-the-first-administrator-needs-a-setup-token.md`
  summary: The end-to-end section of `AGENTS.md` does not say that `start-api.ts` reads the setup token from the API's stdout into `e2e/.auth/setup-token` for the `setup` project.
  evidence: Reverting `stdio` to `"inherit"` in `start-api.ts` would leave the setup project reading a missing file, with nothing in the agent guide pointing at why.

- source_spec: `_bmad-output/implementation-artifacts/spec-13-4-two-factor-sign-in.md`
  summary: `reset-password`'s output lines, including the new « La double authentification a été désactivée. », have no test that runs the script to its end.
  evidence: `cli/reset-password.spec.ts` only checks the refusal without a terminal; covering the output needs a pseudo-terminal for the password prompt.
- source_spec: `_bmad-output/implementation-artifacts/spec-13-5-versioned-images.md`
  summary: « Upgrading » in docs/deployment.md still describes `git pull` and `up --build`; image users need `docker compose pull` and going back to a previous `ARCHANT_VERSION`.
  evidence: Story 13.5 review; the epic assigns the « Upgrading » and « Backups » rewrite to Story 13.6, whose acceptance criteria name `docker compose pull`.
- source_spec: `_bmad-output/implementation-artifacts/spec-13-5-versioned-images.md`
  summary: The `ghcr.io/leger-dosage/archant` package stays private, so pulling the image needs `docker login ghcr.io`; making it public is deferred by the owner.
  evidence: v0.1.0 was published on 2026-09-27 and an anonymous pull answers `401 Unauthorized`. `docs/deployment.md` describes an anonymous `docker compose up`, which fails until the package is public. Settle it in Package settings › Change visibility before Story 13.7's guide relies on the pull.
- source_spec: `_bmad-output/implementation-artifacts/spec-13-6-a-copy-before-every-migration.md`
  summary: The Deployment section of `AGENTS.md` does not list the `image` job's pending-migration restart check, nor that `packages/data/testing/migrations.ts` must import no dev dependency because that job runs it inside the production image.
  evidence: Story 13.6 review. Adding vitest or another dev-only import to that helper would break the CI `image` job with a resolution error the agent guide does not explain.
- source_spec: `_bmad-output/implementation-artifacts/spec-13-7-hosting-at-home-behind-tailscale.md`
  summary: `docs/hosting.md` asks for `docker login ghcr.io` because the `ghcr.io/leger-dosage/archant` package is still private; making it public removes that step and fixes the anonymous pull `docs/deployment.md` describes.
  evidence: `docker manifest inspect ghcr.io/leger-dosage/archant:latest` answered `unauthorized` on 2026-09-27 during Story 13.7's review.

- source_spec: `_bmad-output/implementation-artifacts/spec-13-12-a-bank-that-sends-no-account-currency.md`
  summary: A renewal whose session drops an account as unreadable marks its stored row unlisted, so a linked account stops syncing.
  evidence: `completeConnection` unlists every stored hash missing from `session.accounts`; a dropped account is missing too. Pre-existing since Epic 10; Story 13.12 only logs the drop.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-1-report-a-vulnerability-privately-protect-the-default-branch.md`
  summary: Check in CI that the job names of `ci.yml` match the required status checks of the ruleset « main: pull request and CI ».
  evidence: The ruleset lists contexts by name; an added job is silently not required, and only `AGENTS.md` and a comment in `ci.yml` say so. A step reading `repos/leger-dosage/archant/rulesets` fits Story 15.2 or 15.7, which edit the workflows.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-2-a-pinned-updated-and-attested-supply-chain.md`
  summary: Pin by digest the images the release job pulls through action inputs: `tonistiigi/binfmt` (setup-qemu-action `image`), `moby/buildkit` (setup-buildx-action `driver-opts`) and the BuildKit SBOM scanner.
  evidence: They run in the job holding `packages: write` under movable tags; Dependabot does not update action inputs, so a pin needs its own update path.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-2-a-pinned-updated-and-attested-supply-chain.md`
  summary: Keep `docker://rhysd/actionlint` current: Dependabot does not update a `docker://` action.
  evidence: The first `github_actions` run (36776315577) opened no pull request for `rhysd/actionlint:1.7.11` while `v1.7.12` is released. Replacing the step with a SHA-pinned action, or a `docker` ecosystem entry that reads it, would let Dependabot see it.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-2-a-pinned-updated-and-attested-supply-chain.md`
  summary: Ignore `@types/node` majors in `.github/dependabot.yml`, so the types follow the Node major of `.node-version`.
  evidence: Dependabot's first npm run opened #104, `@types/node` 24.13.6 to 26.6.3, types for a Node the image and CI do not run.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-4-a-sign-in-that-cannot-be-held-hostage.md`
  summary: Renew the `archant.device` cookie from a live session, so a browser kept signed in for months still holds a valid one when it next has to sign in.
  evidence: The cookie is set only when a sign-in creates a session; a session from before the upgrade, or one kept alive past 365 days, leaves the browser without an exemption at its next sign-in.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-5-fast-at-ten-years-of-history.md`
  summary: A lazy chunk that no longer exists after an upgrade drops the whole page to `RootError` instead of reloading or failing only the chart or dialog.
  evidence: No `vite:preloadError` handler and no error boundary around `LazyBalanceChart`, `CashFlowChart` or `LazyCreateAccountDialog`; route chunks have failed the same way since `autoCodeSplitting`, so a stale tab after an image upgrade already meets it.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-5-fast-at-ten-years-of-history.md`
  summary: Test that a refused `ANALYZE` at startup logs a code-only warning and the server still listens.
  evidence: `index.spec.ts` starts against a local file where `ANALYZE` always succeeds; the catch in `index.ts` is untested there, though `imports.spec.ts` tests the same catch on the import path.
- source_spec: `_bmad-output/implementation-artifacts/spec-15-7-fewer-home-made-parts.md`
  summary: Test that `noDrizzleInBundle` in `packages/app/vite.config.ts` refuses a bundle holding a `drizzle-orm` module and passes one without.
  evidence: The refusal was checked once by hand during Story 15.7; `test:e2e` and `image` only ever build a clean bundle, so a typo in the guard would go unnoticed.
- source_spec: `_bmad-output/implementation-artifacts/spec-16-1-connect-an-assistant.md`
  summary: Refuse a `tools/call` outside the token's scopes with `insufficient_scope`, and record calls the SDK refuses before a tool runs (unknown tool, invalid arguments), once Story 16.2 brings write tools and arguments.
  evidence: Today an out-of-scope tool is only absent from `tools/list`; a direct call gets the SDK's unknown-tool answer and no `assistant_calls` row, and the SDK validates arguments before `call()` in `mcp/server.ts`, so its `validationError` branch never runs. No 16.1 tool takes an argument or needs `archant:write`.
- source_spec: `_bmad-output/implementation-artifacts/spec-16-1-connect-an-assistant.md`
  summary: Purge `oauth_clients` rows that never received a consent, or were disconnected, after some time.
  evidence: `allowUnauthenticatedClientRegistration` lets anyone who reaches the host register a client, and `disconnectAssistant` keeps the client row, since Better Auth refuses deleting an ownerless client; nothing bounds the table. Only the tailnet reaches the owner's instance.
- source_spec: `_bmad-output/implementation-artifacts/spec-16-1-connect-an-assistant.md`
  summary: Tell the owner on the consent page whether the assistant's name comes from a Client ID Metadata Document at an `https://` address or was declared by a self-registered client.
  evidence: A dynamically registered client chooses its own `client_name`, such as « Claude Code »; only the return host shown beside it tells two apart.
- source_spec: `_bmad-output/implementation-artifacts/spec-16-1-connect-an-assistant.md`
  summary: Test that `/api/mcp` refuses a server-signed token carrying `cnf`.
  evidence: `authenticate` in `mcp/server.ts` refuses DPoP-bound tokens, but no spec builds one; none is issued today, so the test matters once DPoP is configured.

- source_spec: `_bmad-output/implementation-artifacts/spec-16-2-ask-an-assistant-to-write-my-rules.md`
  summary: Measure `group_transactions_by_label` at ten years of history and cap or page `sumTransactionsByLabel` if needed.
  evidence: The query returns one row per exact label, currency, sign and category with no limit; with mostly distinct bank labels a call loads about one row per transaction. Settle it with a case in `history-volume.spec.ts` over the 100,000-transaction seed.

- source_spec: `_bmad-output/implementation-artifacts/spec-16-2-ask-an-assistant-to-write-my-rules.md`
  summary: Fix the race in `packages/app/e2e/bank-connections.spec.ts` where the connection page's heading stays « Banques » after a bank's callback.
  evidence: The trace shows `GET /api/bank-connections` starting 7 ms after `POST /api/bank-connections/callback` and returning without the new connection, which is never fetched again; the file failed on commit 94f652c too (2 of 37 in one of three runs), and on this branch 1 of 37 in three of six runs.
- source_spec: `_bmad-output/implementation-artifacts/spec-17-2-spread-the-budget-over-categories.md`
  summary: No end-to-end test checks the budget categories' filter in a month where no card is over (hidden toggle, `?filter=` ignored).
  evidence: The only filter test runs in February 2024, where « Cadeaux » is always over; removing `anyOver &&` passes every test.
- source_spec: `_bmad-output/implementation-artifacts/spec-17-4-carry-what-is-left-to-next-month.md`
  summary: No end-to-end step proves that saving a category amount or moving money stales a later month's cached budget page, whose carry changed.
  evidence: `showMonth` in `useBudget.ts` invalidates the other months; only the rollover switch path is exercised by `e2e/budgets.spec.ts`, and the gap heals within the 30 s `staleTime`.
- source_spec: `_bmad-output/implementation-artifacts/spec-17-4-carry-what-is-left-to-next-month.md`
  summary: No test observes that a budget write in a household without rollover skips the history read in `refreshRollover`.
  evidence: The volume test runs no budget write; removing the early return breaks no test. Settling it needs a query count, which the repository has nowhere.
- source_spec: `_bmad-output/implementation-artifacts/spec-18-1-download-all-my-data.md`
  summary: On a Turso database, the export's read snapshot is a remote interactive stream that may expire during a slow download.
  evidence: unverified, medium if true; `readSnapshot` opens `$client.transaction("deferred")`, which over `libsql://` holds a Hrana stream between pulls. Settle it by exporting a large history from a Turso database through a throttled client and watching for a stream expiry.
- source_spec: `_bmad-output/implementation-artifacts/spec-19-2-split-from-the-interface.md`
  summary: EXPERIENCE.md says a sheet never opens a dialog except a confirmation, while the transfer, duplicate and split pickers all open one from the transaction sheet.
  evidence: `TransferDialog` and `DuplicateDialog` predate Story 19.2, which asks for a split dialog from the sheet; the rule or the sheet's pickers need reconciling in the UX document.
- source_spec: `_bmad-output/implementation-artifacts/spec-19-2-split-from-the-interface.md`
  summary: The volume test never times or plans the list's read of split parents by id.
  evidence: medium, unverified: `history-volume.spec.ts` seeds no split, so `listTransactionsById` returns early there; a seeded page of lines timed under `PAGE_MS` with a primary-key search in its plan would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-19-3-attach-a-receipt-to-a-transaction.md`
  summary: On a Turso database, serving an attachment near 10 MiB may fail, since Turso refuses a response over 10 MB and its HTTP protocol carries a blob in base64.
  evidence: medium, unverified: `readAttachment` selects the whole `content` in one statement; libsql-client-ts issue 191 reports `RESPONSE_TOO_LARGE` past 10 MB. Settle it by uploading and opening a 9 MB PDF against a Turso database; a fix reads the blob in slices with `substr`.
- source_spec: `_bmad-output/implementation-artifacts/spec-19-3-attach-a-receipt-to-a-transaction.md`
  summary: No automated check shows a PDF attachment in a browser under the sandboxed policy; Chromium was checked by hand, Firefox and Safari not at all.
  evidence: medium, unverified for Firefox and Safari: the end-to-end suite runs Chromium's headless shell, which downloads a PDF rather than showing it, and headless Firefox would not start on the build machine. Settle it by opening a PDF attachment in both browsers.
- source_spec: `_bmad-output/implementation-artifacts/spec-20-3-members-and-what-a-viewer-sees.md`
  summary: Two administrators who both authorise the same assistant client each see the other's last call date in « Réglages › Assistants IA ».
  evidence: `listAssistants` filters consents by user, but its `lastCalls` subquery groups `assistant_calls` by `client_id` alone, and that table has no user column; settling it adds `user_id` to `assistant_calls` through a migration and filters on it.
- source_spec: `_bmad-output/implementation-artifacts/spec-22-1-securities-and-their-prices.md`
  summary: A listing that Yahoo answers with a provider-wide failure every day, a 5xx or a body the schema refuses, stops each run before the securities after it and never goes offline.
  evidence: medium, unverified: no such symbol was seen; once trades hold real securities, the run's logs (`code` per `securityId`) would show it. A fix moves on after one `PRICE_PROVIDER_ERROR` and stops after two in a row.
- source_spec: `_bmad-output/implementation-artifacts/spec-22-2-record-trades.md`
  summary: An API client can still store the same listing twice, as `MC`/XPAR beside `MC.PA`/XPAR, since a listing's ticker is stored as sent, upper-cased.
  evidence: medium, unverified: the interface only sends Yahoo's suffixed symbol, as its search returns it, but `POST /api/accounts/:id/trades` takes any ticker. Settle it by normalising a listing's ticker through the provider's symbol rule, `yahooSymbol`, before it is looked up and stored.
- source_spec: `_bmad-output/implementation-artifacts/spec-22-2-record-trades.md`
  summary: AD-15 says request schemas import only `zod` and `@archant/data`, while `schemas/rules.ts`, `schemas/transactions.ts` and now `schemas/trades.ts` import `domain/`.
  evidence: low; the rule or the three files need reconciling: move the shared pure helpers to `@archant/data`, or amend AD-15 to allow pure `domain/` modules that import no Drizzle.
- source_spec: `_bmad-output/implementation-artifacts/spec-22-3-holdings-and-an-investment-accounts-value.md`
  summary: No test pins that a `Holding` line at quantity zero writes `cost_basis` and `cost_basis_source` both null.
  evidence: low; the export household sells no security in full, so writing `cost_basis_source: "calculated"` on every line fails neither the assertion nor `surePreflight`. Settle it with a full sale in the export fixture, or with Story 22.4's holdings screen.
- source_spec: `_bmad-output/implementation-artifacts/spec-22-4-see-my-holdings.md`
  summary: No Playwright test opens the sheet of a provider security set offline and finds « Saisir un cours ».
  evidence: low; `PositionSheet` shows the form for `provider === null || offline`, and only the first branch has an end-to-end test, since the suite keeps price fetching off and no fixture sets `offline`. Settle it with an e2e helper that fails a stubbed fetch five times, or a test-only seed.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23)
  summary: A loan's bank debits should move its balance by themselves, each payment carrying its principal, interest and borrower insurance, instead of the balance following snapshots and payments paired by hand.
  evidence: Explored on 2026-10-03 while planning Epic 23. Today Archant pairs a loan payment only with a counterpart that already exists on the loan account (Epic 5, Story 7.1), so a mortgage debited from a checking account leaves the loan balance unchanged until a snapshot; Epic 19 refuses to split a transfer side (`NOT_SPLITTABLE`), so a payment cannot carry its interest and insurance. Epic 24 is the base: its pure engine in `domain/loans/` (AD-25) already gives each scheduled payment's principal, interest and premium from the loan's terms, and its projection already starts from the recorded balance, as Sure's; Sure goes no further, and no bank debit moves its loan balance or is split. What remains: write the principal side onto the loan account when a debit is matched (Epic 23's matcher can name the instalment), and split the debit into principal, interest and insurance. References: Wealthfolio PR #1868, a pure schedule engine fed by stored loan parameters plus dated events, where a confirmed balance overrides the estimate; beanschedule's stateful mode, which splits an imported bank debit into principal, interest and fees from the loan's actual balance; GnuCash's loan assistant for the fields a loan needs (amount, rate, term, start date, payment frequency, the accounts paid from and to, and the escrow or insurance parts of a payment). Decide against AD-8, AD-11 and AD-20 whether a transfer side may be split before any story.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23, Sure review)
  summary: Port Sure's loan overview: down payment, start date, borrower insurance, amortisation schedule, payoff projection and the chart of the contract schedule beside the recorded balance.
  evidence: Sure #2984 (2026-09-09), #3473 (2026-09-15), #3474 (2026-09-27) and #3327 (2026-09-30). Story 7.1 keeps original amount, rate in basis points and end date only.
  planned: Epic 24 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23, Sure review)
  summary: Accept Enable Banking's booked balance types `OPBD` and `PRCD` after `CLBD`, used only when no other balance has a newer `reference_date`.
  evidence: Sure #3739 (2026-09-27). `BALANCE_TYPES = ["ITBD", "CLBD"]` in `packages/api/src/connectors/enable-banking/client.ts`; a bank that sends only `OPBD` or `PRCD` fails every sync with `BANK_BALANCE_UNAVAILABLE`. Both are booked balances, so AD-18's reason holds; amend AD-18 with the change.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23, Sure review)
  summary: Ask for a new consent as soon as Enable Banking rejects a session with 401 or 404 before its stored expiry.
  evidence: Sure #3854 (2026-09-29). `connectionAlert` in `packages/api/src/domain/bank-connection-alert.ts` knows only a local expiry, an expiry within 14 days and a sync older than 48 hours, so a consent revoked at the bank shows as `BANK_PROVIDER_ERROR` failures for two days before « Renouveler » appears.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23, Sure review)
  summary: Accept each TOTP code once, by storing the last accepted time step and claiming it with a conditional update.
  evidence: Sure #3830 (2026-09-29). Better Auth's `verifyTOTP` keeps no used step, so a code read over a shoulder or relayed by a phishing page works again within its window, the password still required. Do it through a Better Auth hook on `/two-factor/verify-totp` or upstream, never by hand (AD-13, NFR6); until then `docs/security-model.md` should name the limit.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23)
  summary: The bills calendar: a month grid of due dates, and an iCal feed a phone calendar subscribes to.
  evidence: Sure #3202 (`bills/calendar.html.erb`, `bills_feeds_controller.rb`). Left out of Epic 23 to keep it buildable: the grid repeats the bills list. The feed is served at a secret URL without a session, which AD-13's list of unguarded routes does not allow, and the owner's instance is reachable only through Tailscale; it needs its own AD.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23)
  summary: Sure's income plan: declared paydays slice time, and each bill is funded from the paycheck before it, with cash on hand for the days before the next payday.
  evidence: Sure `recurring_transaction/paycheck_planner.rb` and `get_paycheck_plan`. It rests on declared income series, which Story 23.2 brings, and on cash on hand, which Epics 17 and 21 left out; Sure reworked it in #3879, #3917 and #3928 within two days, so wait until it settles.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23)
  summary: Subscription dates on a bill (trial end, renewal, cancellation) and the notices they raise on the bills page and in `get_bill_audit`.
  evidence: Sure's `renews_on`, `trial_ends_on` and `cancelled_on` (#3201), shown by `bills/_state_chips.html.erb` and `BillsController#collect_notices`. Left out of Epic 23 to keep it buildable; nothing in matching or detection reads them.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23)
  summary: Recurring transfers between two of the household's accounts, such as a standing order to a savings account, declared from a matched transfer.
  evidence: Sure's `RecurringTransaction.create_from_transfer` and `destination_account_id`; its bills page lists only those into a card or a loan. Archant already treats loan payments and contributions as series (Spec 9.1, AD-9); Sure's own matching of recurring transfers is an open issue (#1590).
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23)
  summary: A transaction picker with search in the declare-a-bill dialog, and applying a payment link to the other series of the same merchant.
  evidence: Sure's `recurring_transactions#new` with `picker` and `apply_payment_url_to_siblings`. Story 23.2 reaches any transaction through the sheet's « Créer une facture » instead.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23, Sure review)
  summary: Story 22.1's spec should send Yahoo price requests without cookie or crumb, retry with authentication on 401, and copy Sure's exchange suffixes for European venues.
  evidence: Sure #3795 and #3769 (2026-09-28), which ended persistent 429 answers and priced XETRA and Euronext listings.
  planned: Story 22.1 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 23, Sure review)
  summary: Story 18.1's schema test should follow Sure's import preflight as of #3671, where a dangling `merchant_id` is a warning, and Sure's import now reuses categories, tags and merchants by name.
  evidence: Sure #3671 and #3725 (2026-09-25).
  planned: Story 18.1 in `_bmad-output/planning-artifacts/epics.md`.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 24)
  summary: A loan's first payment date apart from its drawdown, with the broken-period interest a French lender charges in the first instalment.
  evidence: The owner's ING mortgage was drawn on 2020-12-03 and repaid from 2021-01-05; its first instalment of 584,25 € holds 12,96 € of interest for the two days from the 3rd to the 5th, at actual/365. Sure dates every payment on the origination day and charges whole months, so Epic 24 records the origination as 2020-12-05 and shows 571,29 €; every later figure matches ING's table to the cent. Sure also numbers the 2026-10-05 instalment 70 where ING's statement says 71; check that statement before deciding whether numbering needs anything.
- source_spec: `_bmad-output/planning-artifacts/epics.md` (Epic 5, transfer matching)
  summary: Transfer matching pairs unrelated lines of the same amount: two outflows of the same sign, a card purchase with a refund from another merchant, a card payment with a friend's transfer.
  evidence: Seen on the owner's instance on 2026-10-03: BoursoBank sent three `immediat_debit` card accounts whose lines copy the checking account's card payments, and 8 pairs formed, among them « LA POSTE.FR » −5.49 on the checking account paired as `credit_card_payment` with its own copy −5.49 on a card account, « DECATHLON » −29.99 paired with « AVOIR VERTBAUDET » +29.99, and « BOULANGERIE MADE » −5.00 with a +5.00 transfer from a person. Check the sign test of `domain/transfer-matching.ts` for liability accounts, and compare Sure's matcher, which also weighs the label, before trusting an amount and a date alone.
- source_spec: `_bmad-output/implementation-artifacts/spec-hide-inactive-account-transactions.md`
  summary: Decide whether rules apply to lines a file import or a manual entry creates on a deactivated account, now that applying rules to history leaves those rows out.
  evidence: `ingest` in `services/ledger/ingest.ts` runs the enabled rules on every created line whatever the account's state; syncs skip deactivated accounts, so only an import or a manual entry reaches it.
- source_spec: `_bmad-output/implementation-artifacts/spec-hide-inactive-account-transactions.md`
  summary: A deactivated account kept in `/transactions` filters by an old link now lists nothing without saying why.
  evidence: `TransactionFilters.tsx` keeps the chip of an inactive account in `?account=`; Sure lists nothing either. Dropping the chip or a sentence would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-hide-inactive-account-transactions.md`
  summary: Assert the query plan of `/api/transactions?account=<one>` with the active-account predicate.
  evidence: maybe-false, medium if true: one named account drops the `+` hint and now meets a second `in` on `account_id`; a case in `history-volume.spec.ts` would settle it.
- source_spec: `_bmad-output/implementation-artifacts/spec-23-1-find-recurring-payments-as-sure-does-today.md`
  summary: The transaction sheet and « Ajouter aux récurrences » pick a series of the row's key by exact amount, else the latest, rather than the tier the identifier would claim.
  evidence: maybe-false, low to medium if true. `seriesOfTransaction` in `services/recurring/series.ts` predates Story 23.1 (Spec 11.8). With two tiers of one merchant a row may name the wrong one; settle it with a two-tier test once Story 23.3's matcher links a payment to its occurrence.
