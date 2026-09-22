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
