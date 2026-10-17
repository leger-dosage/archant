---
title: "Story 29.6: Settle pending lines as Sure"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'f520e0560f096bc1a38460c0d74ba5d132cb0f06'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-29-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure's `Account::ProviderImportAdapter` (at `00dd977fb`) lets a booked line no external id finds claim a pending entry of the same account, source, amount and currency dated 0 to 8 days before it, the most recent first (`find_pending_transaction`, `date_window: 8`, `order(date: :desc)`), and the claimed entry keeps the pending date (`effective_date`). It never deletes a pending entry the bank stops listing. `Setting.syncs_include_pending`, on by default and shown as « Inclure les transactions en attente » under « Paramètres de synchronisation », makes `EnableBankingItem::Importer#fetch_and_store_transactions` read only `BOOK` lines and drop the `PDNG` ones a booked read returns. Archant pairs within 5 days either way, gives the entry the booked date, deletes a pending entry missing from syncs on two different days (Story 11.5), extends each bank account's window back to its oldest pending entry, and has no switch.

**Approach:** Step 3 of the ingest pairs a booked line by amount with a pending entry dated 0 to 8 days before it, the latest first, and keeps that entry's date. The miss count, its two columns and the window's extension go. A household setting, on by default, read by the sync before each run, makes the Enable Banking connector ask `transaction_status=BOOK` and drop `PDNG` lines; « Réglages › Banques » shows Sure's switch.

## Boundaries & Constraints

**Always:**
- Pairing by amount (`absorbPending`): same amount in minor units on the account (one currency per account, AD-6), candidate date `d` with `0 ≤ line.date − d ≤ 8` days; latest candidate date first, then oldest created, then id; one entry per line. A candidate dated after the line is never taken.
- The entry absorbed by amount keeps its own date: `absorb` is told to keep it; locks still apply. A booked line found by its reference on a pending entry takes the booked date, as Sure's same-`external_id` path assigns `date`.
- Pending entries are never deleted by a sync. `countMissedSyncs`, `MAX_MISSED_SYNCS`, `IngestSource.missesFrom`, `Groups.named` and the refused-key lookup that fed it go; migration `0086` drops `transactions.pending_missed_syncs` and `transactions.pending_missed_on`.
- `windowStart` no longer reads the oldest pending entry; `oldestPendingDate` goes. `BankStatement.from` stays for the « window shortened » log only.
- Setting row `syncs_include_pending` in `settings`, value `"false"` when off, absent or anything else on. `GET /api/bank-connections/settings` (admin only, `requireRole("admin")`) and `PUT /api/bank-connections/settings` `{ includePending: boolean }` (viewer refused by `viewerReadOnly`) both answer `{ data: { includePending } }`.
- `BankConnector.fetchStatement` takes `includePending`; off, every page asks `transaction_status=BOOK` and lines whose status is `PDNG` are dropped before mapping. On, the read is unchanged.
- Switching off leaves stored pending entries alone; a booked line still claims them by key or amount, as Sure's adapter runs regardless of the setting.
- « Réglages › Banques », once credentials are set: a section « Paramètres de synchronisation » with a `Switch` « Inclure les transactions en attente », described by Sure's `include_pending_description`; a change toasts « Paramètres mis à jour », Sure's `update.success`.
- The transaction sheet's attachments note that a pending line « sera supprimée avec ses pièces jointes » goes, as nothing deletes it any more.
- AD-17 and AD-18 state Sure's window, date and keeping; `docs/sure-parity.md` « Pending lines », « Sync window » and « Pagination » change.

**Never:** no fuzzy pairing, duplicate suggestion or merge (Story 29.7); no second `PDNG` read when on; no deletion of stored pending entries when switched off; no environment variable; no change to the `withoutSettledPending` drop or the group recognition of identical pending lines; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Same day | pending 09-12, booked 09-12, same amount | absorbed, date 09-12 | none |
| 8 days | pending 09-04, booked 09-12 | absorbed, date 09-04 | none |
| 9 days | pending 09-03, booked 09-12 | booked created, pending kept | none |
| Pending after | pending 09-13, booked 09-12 | booked created, pending kept | none |
| Two candidates | pending 09-05 and 09-10, booked 09-12 | the 09-10 one absorbed | none |
| Same reference | pending `ref-1` 09-10, booked `ref-1` 09-12 | absorbed, date 09-12 | none |
| Locked date | pending date locked by the user | date unchanged | none |
| Stale pending | pending line absent from several syncs on several days | entry kept | none |
| Window | pending entry older than last sync − 7 days | window from last sync − 7 days | none |
| Switch off | sync | query carries `transaction_status=BOOK`, `PDNG` lines dropped | none |
| Switch off, stored pending | booked line of the same amount 2 days later | still absorbed | none |
| Viewer writes setting | `PUT /settings` | refused | `FORBIDDEN` |
| Bad body | `{ includePending: "no" }` | refused | `VALIDATION_ERROR` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/pending.ts` -- `absorbPending` window 0 to 8 days before, latest first; `MAX_MISSED_SYNCS` goes.
- `packages/api/src/services/ledger/pending.ts` -- `absorb` takes `keepDate`; `countMissedSyncs` and the missed fields go.
- `packages/api/src/services/ledger/ingest.ts` -- `IngestSource` without `missesFrom`; the miss step, `named` and refused keys go; amount-paired lines absorb keeping the date.
- `packages/api/src/services/ledger/snapshots.ts` -- `oldestPendingDate` goes.
- `packages/api/src/services/sync.ts` -- `windowStart` without pending; reads the setting and passes it to `fetchStatement`.
- `packages/api/src/services/bank-settings.ts` (new) -- read and write `syncs_include_pending`.
- `packages/api/src/routes/bank-connections.ts`, `packages/api/src/schemas/bank-connections.ts` -- `GET` and `PUT /settings`.
- `packages/api/src/connectors/bank-connector.ts`, `connectors/enable-banking/client.ts` -- `includePending`, `transaction_status=BOOK`, `PDNG` dropped.
- `packages/api/src/services/ledger/export.ts` -- the two columns leave the excluded list.
- `packages/data/schema/transactions.ts`, `packages/data/drizzle/0086_*.sql` -- columns dropped.
- `packages/app/src/hooks/useBankConnections.ts`, `routes/_authed.settings.banks.tsx`, `locales/fr.json`, `components/TransactionAttachments.tsx` -- switch, note removed.
- `packages/app/e2e/bank-connections.spec.ts`, `e2e/fake-enable-banking.ts` -- the switch off then on; the fake honours `transaction_status`.
- Specs: `domain/pending.spec.ts`, `services/ledger/pending.spec.ts`, `services/sync.spec.ts`, `connectors/enable-banking/client.spec.ts`, `routes/bank-connections.spec.ts`, `packages/data/migrate.spec.ts`.
- Docs: `docs/architecture.md` AD-17, AD-18; `docs/sure-parity.md`.
- Sure, read-only, at `00dd977fb`: `app/models/account/provider_import_adapter.rb` (`find_pending_transaction`, `effective_date`), `app/models/enable_banking_item/importer.rb` (`include_pending?`, `fetch_and_store_transactions`), `app/views/settings/hostings/_sync_settings.html.erb`, `config/locales/views/settings/hostings/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: `absorbPending` 0 and 8 day bounds, 9 days, a pending dated after, latest first; ingest keeping the pending date, the booked date on a reference hit, a locked date, a stale pending kept over syncs on several days; `windowStart` ignoring pending; the connector asking `transaction_status=BOOK` and dropping `PDNG` when off; the sync passing the setting; the routes reading, writing, refusing a viewer and a bad body; the migration dropping the columns.
- [x] Domain, ledger, migration, sync, connector, setting service and routes.
- [x] Interface switch, attachments note, Playwright off then on.
- [x] AD-17, AD-18 and parity rows.

**Acceptance Criteria:**
- Given a booked line no key matches, when a pending entry of the same account has the same amount and currency, dated 0 to 8 days before it, then the booked line takes that entry, which keeps the pending date; a pending entry dated after is not taken.
- Given a pending entry the bank stops listing, when syncs run on later days, then it stays, and the window is no longer extended back to it.
- Given « Inclure les transactions en attente » turned off, when the next sync runs, then it asks for no `PDNG` line and drops the pending ones a booked read returns.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then both pass with no request reaching Enable Banking.

### Review Findings

Second pass, `bmad-code-review` (four layers) over the committed branch.

- [x] [Review][Patch] The `pending` column's comment said a pending line counts in balances, which it has not since Story 11.7 [packages/data/schema/transactions.ts]
- [x] [Review][Patch] The export's note on `settings` did not name the new switch it leaves out [packages/api/src/services/ledger/export.ts]
- [x] [Review][Patch] `fetchStatement`'s doc said « without `includePending` » for a required flag [packages/api/src/connectors/bank-connector.ts]
- [x] [Review][Patch] The rule « on unless `"false"` » was documented on the constant, not on `includesPending`; `bankSyncSettings` had no doc [packages/api/src/services/bank-settings.ts]
- [x] [Review][Patch] No test that a page retried after a refused period still asks `transaction_status=BOOK` [packages/api/src/connectors/enable-banking/client.spec.ts]
- [x] [Review][Patch] No test of a date the user locked when the booked line comes by amount [packages/api/src/services/ledger/pending.spec.ts]

Rejected:
- `low` `includePending` as a fifth positional boolean: one caller, the sync; an options object for one flag adds shape.
- `low` The single read when on rests on Enable Banking returning every status without the filter: its API documents `transaction_status` as an optional filter; the parity row names the difference.
- `low` No troubleshooting section for a pending line that never goes: Sure keeps it the same way, and Story 29.7 brings the merge.
- `low` Playwright's fake bank filters by status itself, so the end-to-end test does not prove the client's own drop: `client.spec.ts` and `sync.spec.ts` prove it against a bank that ignores the filter.
- `low` No Playwright test of the 8-day pairing or a stale pending line: the story asks Playwright for the switch only; Vitest covers both.
- `low` The switch hides while credentials no longer resolve: nothing syncs then.
- `low` A pending line paired by amount keeps a date up to 8 days before a later file's booked line, outside the file's 3-day pairing: Sure keeps the pending date too, and files and syncs rarely overlap on fresh lines.
- `low` An old pending entry whose booked line is dated before the window is never booked: Sure reads from its last sync too.
- `low` A cancelled pre-authorisation may be claimed by an unrelated purchase of the same amount within 8 days: Sure's `find_pending_transaction` does the same.
- `false` A pending line dated after its booked line stays beside it: the story asks it, as Sure's `(date - 8.days)..date`.
- `false` Spec and sprint status at `done` before the pull request: this repository closes the story in its own pull request.

## Design Notes

Assumptions taken alone, each settled by Sure. Among several candidates the latest pending date wins, as Sure's `order(date: :desc)`; created time and id only break a tie Sure leaves to the database. A booked line found by its reference on a pending entry takes the booked date: Sure keeps the pending date only on the amount claim, and a same-`external_id` hit assigns `date`. The candidates stay the connection's pending entries, Sure's `where(source:)`. The switch sits on « Réglages › Banques », Archant's only bank settings page, where Sure puts it on its self-hosting page; it shows once credentials are set, since nothing syncs before. When on, the single read without status stays: Enable Banking returns every status without the filter, so Sure's second `PDNG` read only doubles the bank's unattended calls. Switching off deletes nothing: Sure only empties its raw payload, and its entries stay. The sheet's note that a pending line goes with its attachments goes, being false now.

## Spec Change Log

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A pending entry kept forever counts twice in balances when it is never booked or booked at another amount | false | reject | Pending entries count in no balance (`docs/sure-parity.md` « Pending transactions », Story 11.7); a stale one only stays listed, as in Sure. |
| 2 | `docs/security-model.md` omits the new admin-only read | low | patch | The viewer paragraph now names the Enable Banking sync settings beside the credentials. |
| 3 | `docs/deployment.md` and `docs/troubleshooting.md` say nothing of the switch | low | reject | The switch explains itself on its page with Sure's text; no self-hoster action or symptom depends on it. |
| 4 | Sprint status `in-progress` while the spec reads `in-review` | false | reject | Both move to `done` at the workflow's end. |
| 5 | AD-17 still says `absorb(survivorId, source)` deletes the absorbed row, and its « Binds » omits Epic 29 | low | reject | Pre-existing wording covering the duplicate merge, which does delete its row; not changed by this story. |
| 6 | Each raw line parsed up to four times, `isPending` adding one | low | reject | A statement holds a few hundred lines; one more `safeParse` each is negligible. |
| 7 | Parity rows keep history (« no pending miss is counted any more », « no extension back ») | low | patch | Status cells now state the current parity only. |
| 8 | Migration tests for 0029 and 0084 lost their checks on the missed-sync columns | medium | patch | They now migrate to just before 0086 and assert the columns as before; 0086 has its own test. |
| 9 | A rollback to an older image fails once 0086 dropped the columns | low | reject | Every migration is one-way; the server copies the database to `backups/` before migrating, as `docs/deployment.md` « Upgrading » says. Named in the pull request. |
| 10 | No test of a setting value other than absent or `"false"`, nor of the setting read once per run | low | reject | `row?.value !== "false"` is one comparison; the sync tests cover on and off. |
| 11 | With the switch off, a `PDNG` line that fails the schema is kept and refused rather than dropped | low | reject | `transactionSchema` catches each field; only a non-object fails, refused whatever the switch, as before. |
| 12 | A pending line dated after its booked line is never paired, and stays | false | reject | The story asks for it, as Sure's `(date - 8.days)..date`. |
| 13 | Nothing clears an unclaimed pending entry once the bank cancels it | false | reject | The story asks to keep it, as Sure; Story 29.7 brings the merge. |
| 14 | A pending entry older than the window is no longer refreshed by its reference | low | reject | Sure reads from its last sync too; the amount match still covers 8 days. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
