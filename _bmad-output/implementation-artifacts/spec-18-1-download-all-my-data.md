---
title: 'Story 18.1: Download all my data'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '6495bdeb283b3a74092cebe5dd23e9892b1b377e'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-18-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing takes the household's data out of Archant: leaving, or reading the figures elsewhere, means opening the SQLite file.

**Approach:** `GET /api/export` streams a ZIP built in the request from one read snapshot, in Sure's export format (`data_exporter.rb` at `14638a7`), so Sure's `SureImport` accepts its `all.ndjson`; « Réglages › Données » at `/settings/data` explains it and downloads it. Story 18.1 of `epics.md` is the acceptance contract; this spec adds what reading Sure's importer and Archant's code settled.

## Boundaries & Constraints

**Always:**
- ZIP entries, in order: `version.txt` (`export_version: 2\n`, Sure's), `accounts.csv`, `transactions.csv`, `categories.csv`, `merchants.csv`, `rules.csv`, `all.ndjson`, each deflated by `fflate`'s streaming `Zip`; headers `Content-Type: application/zip`, `Content-Disposition: attachment; filename="archant_export_YYYYMMDD_HHMMSS.zip"` (time in `APP_TIMEZONE`), `Cache-Control: no-store`, never `Content-Encoding`: `/api/export` joins the `compress` exception list.
- One read snapshot: `readSnapshot` in `@archant/data/client` opens `$client.transaction("deferred")` and hands a Drizzle instance over it, because Drizzle's own `transaction` always sends `BEGIN IMMEDIATE` and would hold the write lock for the whole download. Large tables (`entries` with `transactions`, `balances`) are read in keyset pages; the stream is pull-driven, so a page is read only when the client has taken the previous bytes.
- `services/ledger/export.ts` reads every exported table through `EXPORTED_COLUMNS` (TypeScript keys per table) and declares `LEFT_OUT` (a reason per column, or per whole table); `services/export.ts` maps rows to Sure's files. AD-23 is edited to name `services/ledger/export.ts`, the only place AD-2 lets the ledger's tables be read.
- Amounts: decimal strings from `toDecimalString`. Transaction and recurring amounts are negated to Sure's sign (a purchase positive); balances, valuations and budget amounts are stored balances or positive envelopes and keep their sign.
- `all.ndjson`: one `{"type","data"}` per line, `\n`-terminated, types in Sure's order: `Account`, `Balance`, `Category`, `Tag`, `Merchant`, `RecurringTransaction`, `Transaction`, `Transfer`, `RejectedTransfer`, `Valuation`, `Budget`, `BudgetCategory`, `Rule`. Sure's keys carry what Sure can represent; the rest of a row goes under one `archant` object, which Sure's importer ignores. A row Sure would refuse is left out of Sure's files.
- Mappings: account types to Sure's `accountable_type`; subtype `consumer` to `other`, credit card `credit_card`, the original under `archant.subtype`; `status` `active`/`disabled`; loan `initial_balance`, `interest_rate` (percent) in `accountable`, `archant.loan_end_date`. Transaction `kind` from its transfer: outflow `funds_movement`, `cc_payment`, `loan_payment` or `investment_contribution`, inflow `funds_movement`, else `standard`; `archant` holds `pending`, `locked_fields`, `category_origin`, `reference`, `possible_duplicate`. Transfers `confirmed`, `archant.kind`. Recurring status `detected`/`confirmed` to `active`, `inactive`, `dismissed` to `ended`, `archant.status`. Valuation `name` from Sure's `Valuation::Name`; one per account and day, `opening_anchor` before `current_anchor` before `reconciliation`; the opening anchor's amount is the stored balance of its day. Budgets: `start_date`/`end_date` of the month; `BudgetCategory.rolled_over_amount` recomputed by the chain the page reads (`rolloverAmounts` in `services/budgets.ts`), never the stored column, which lags a recategorised transaction.
- Rules: category, merchant and tag operands become the name plus `value_ref {type,id,name}`, tags CSV-encoded names with one `value_ref` or an array; amounts a decimal string in the reporting currency; account ids stay ids, as Sure. `replace_in_transaction_name` goes under `archant.actions`; a rule left without a Sure action is left out of `all.ndjson` and `rules.csv`.
- CSV: papaparse's `unparse`, `\n`, Sure's headers; tags joined with `,`, escaping `\`, `,` and `|`, as Sure.
- Logs: one line at the end with duration and counts; a failure logs its error name only.

**Never:** no job, no stored archive, no import of an archive; no `trades.csv` or `attachments.json` before Epics 19 and 22; no bank connection, bank account, key, token, session, `identification_hash`, `provider_uid`, entry key, raw import file, import mapping, setting or assistant call in the archive; no role check (Epic 20 adds it); no `hc` call for the download.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected |
|---|---|---|
| Signed in | `GET /api/export`, `Accept-Encoding: gzip` | 200, the seven entries in order, no `Content-Encoding` |
| Signed out | no session | 401 envelope, no ZIP |
| Empty household | fresh database | every file with its header; `all.ndjson` holds the seeded categories |
| Sure preflight | rich household | every line passes the test schema: required fields, references, names, subtypes, one valuation per day, transfer signs and dates |
| Stale rollover | budget written, then a transaction recategorised | `rolled_over_amount` is the page's figure |
| Replacement only | rule whose only action replaces in the label | absent from `rules.csv` and `all.ndjson` |
| Secrets | bank credentials saved, an import kept, sessions | no token, key, hash, entry key or file content in any entry |
| Volume | 100,000 transactions | under 10 s (twice on CI), first bytes before half the time |
| Client gone | stream cancelled mid-way | snapshot closed, no unhandled rejection |

</frozen-after-approval>

## Code Map

- `packages/data/client.ts` -- `createDb`, `Database`; add `readSnapshot`. libSQL's `transaction(mode)` takes its own pooled connection (`@libsql/client` 0.18); `deferred` begins a WAL snapshot at the first read without the write lock.
- `packages/api/src/services/ledger/` -- add `export.ts`; reuse `balanceOn`, `openingDateOf` (`ledger/balances.ts`), `chunksOf`, `KEYS_PER_LOOKUP` (`ledger/shared.ts`). Index `entries_kind_date (kind, date, created_at, id)` serves the transaction keyset; `balances` PK `(account_id, date)` its own.
- `packages/api/src/services/budgets.ts:221` `chainOf`, `:247` `refreshRollover`, `setUpMonths`, `treeCategories` -- extract the chain computation into `rolloverAmounts(deps)`, which `refreshRollover` keeps using.
- `packages/data/money.ts:276` `toDecimalString`; `packages/data/account-types.ts` `ACCOUNT_TYPES`, `LoanDetails` (rate in basis points); `packages/data/rules.ts` operand meanings.
- `packages/api/src/services/settings.ts` `getReportingCurrency` -- currency of amount conditions.
- `packages/api/src/app.ts:233` `createApi` chain (add `/export`), `:324` `compress` exceptions; `routes/version.ts` and `version.spec.ts` as patterns; `testing/app.ts` `useSignedInApp`.
- `packages/api/src/services/history-volume.spec.ts` -- seeded 100,000 rows, `MARGIN`, `timed`.
- `packages/api/src/services/auth.spec.ts:699` -- `getTableColumns` loop pattern for the coverage spec.
- `packages/app/src/components/SettingsNav.tsx:16` `SETTINGS_SECTIONS`; `routes/_authed.settings.assistants.tsx` page pattern and docs link; `src/locales/fr.json` `settings.sections`; `e2e/version.spec.ts`, `e2e/fixtures.ts`.
- `docs/deployment.md` (`## Backups`), `docs/security-model.md`, `docs/sure-parity.md:221`, `docs/architecture.md` AD-23, `AGENTS.md` anchors sentence, `docs/tech-stack.md`.
- Sure's code at `14638a7`: `app/models/family/data_exporter.rb`, `app/models/sure_import/preflight.rb`, `app/models/family/data_importer.rb`, `app/models/transfer.rb`, `app/models/valuation/name.rb`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/testing/sure-preflight.ts` -- first: a Zod schema per type and the cross-line checks of `SureImport::Preflight` and `Transfer`'s validations, from Sure's code.
- [x] `packages/api/src/services/ledger/export.spec.ts` -- first: every table and column of a migrated database is exported or left out, never both; then pages and snapshot.
- [x] `packages/api/src/services/export.spec.ts` -- first: each matrix row but volume and the route's, the files' headers and order, each mapping above.
- [x] `packages/data/client.ts` -- `readSnapshot`, with a spec in `client.spec.ts` (a write elsewhere is not seen, and is not blocked).
- [x] `packages/api/package.json` -- `fflate` caret dependency.
- [x] `packages/api/src/services/ledger/export.ts`, `services/budgets.ts`, `services/export.ts` -- reads, `rolloverAmounts`, files and stream.
- [x] `packages/api/src/routes/export.ts`, `routes/export.spec.ts`, `app.ts` -- the route, headers, 401, no gzip.
- [x] `packages/api/src/services/history-volume.spec.ts` -- the volume row.
- [x] `packages/app/src/routes/_authed.settings.data.tsx`, `components/SettingsNav.tsx`, `locales/fr.json`, `e2e/export.spec.ts` -- the page, the nav entry, the download test.
- [x] Docs above, `epics.md` Story 18.1's type list gains `Budget` and `BudgetCategory`.

**Acceptance Criteria:**
- Given Story 18.1 of `epics.md`, when the story ships, then each of its criteria holds, with the revisions this spec records.
- Given the page, when the owner clicks « Exporter mes données », then a file `archant_export_YYYYMMDD_HHMMSS.zip` downloads, and the page lists what it holds and leaves out and says amounts follow Sure's sign.

## Design Notes

Sure's importer reads `all.ndjson` only, refuses an unknown `type`, ignores unknown keys, and fails the whole import on a `Transfer`, `Rule` or `Category` its model refuses: hence the `archant` object and the left-out rows. Without an `opening_anchor` per account it creates one from the current balance, which doubles every movement, so every account carries one. A bank-linked account's opening anchor amount plays no part in Archant (backward computation), so its stored balance on that day replaces it.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, ledger coverage at 100 %
- `pnpm test:e2e` (inside the `/tmp/archant-e2e.lock` wrapper) -- expected: green

## Implementation Notes

- `readSnapshot` hands Drizzle a `Client` adapter over the libSQL transaction (`execute`, `batch`, `executeMultiple`; `transaction`, `migrate`, `sync`, `reconnect` throw), and runs one read at once so the snapshot is the state at the call.
- The stream opens its snapshot at the first pull, not when the route answers: a body never read, such as a `HEAD`, holds no pooled connection.
- `EXPORTED_COLUMNS` is written out as Drizzle selections keyed by TypeScript key, which needs no type assertion; the coverage spec checks each key against `getTableColumns`.
- Keyset pages recurse (`keysetPages`) rather than loop, as `no-await-in-loop` asks. A transaction page also returns the id of the transfer each side sits in, so a transfer Sure would refuse leaves both sides `standard`.
- A Drizzle error reaches the log as `Error`: `DrizzleQueryError` sets no `name`, and its message holds the query's parameters, so only the name is logged.
- Measured locally: 100,000 transactions export in 3.4 s, first bytes after 2 ms; the transaction keyset reads `entries_kind_date` with no sort, which the volume project asserts.
- Self-review after the review loop: the amount helpers of `services/export.ts` take `MinorUnits`, converted with `toMinorUnits` where a row is read (AGENTS.md: no bare `number` for money); transfer gaps use `daysBetween`; the stream errors with a neutral `AppError`; `SURE_RECURRING_STATUSES` is checked against `RecurringStatus`; the volume test asserts both the first bytes before half the time and half the bytes before 80 % of it.

## Spec Change Log

- Review loop 1, thermo layer: Sure refuses any `Entry` dated 30 years or more before the import, and one refusal fails the whole import. Amended, outside the frozen intent, which already asks that Sure's importer accept the file: Sure's lines start at the export day less 29 years, a year of margin for a later import. An older opening anchor moves to that day with the stored balance of that day, its own date under `archant.opening_date`; older `Valuation` and `Transaction` lines, and transfers with an older side, stay out of `all.ndjson`, their effect carried by that balance; `transactions.csv` keeps them. Avoids: an archive of any household with a property bought before 1996 that Sure refuses whole. KEEP: the allowlist, the snapshot, the pull-driven stream, every mapping and test already in place.

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| edge, blind, thermo | An unread body, such as `HEAD`, pulls once with the default `highWaterMark` and opens a snapshot never closed; 20 of them exhaust the libSQL pool | high | Hono answers `HEAD` with `new Response(null, …)` after running the `GET` handler, never cancelling the body; reproduced with 20 unread responses (`TRANSACTION_ACTIVE`) | patched: `highWaterMark: 0`, test waits a macrotask on an unread body |
| edge, blind | A client that stops reading keeps the snapshot open indefinitely, the WAL growing | medium | Same mechanism as the row above, with no deadline between pulls | patched: the snapshot closes after two minutes without a pull; no cap on concurrent exports, each now bounded |
| blind, edge, verification-gap | A transfer Sure would refuse (sides redated more than 30 days apart, which `ledger/edits.ts` allows) loses its link silently, and no test covers the filter | medium | `sureAcceptsTransfer` drops it and nothing under `archant` keeps it; every test transfer is same-day | patched: every transaction in a transfer carries `archant.transfer` (`id`, `kind`, `side`); a test redates a side by 40 days |
| blind | Same-day valuations: only one reaches Sure's lines | low | Only a snapshot on a current anchor's day can collide, and the anchor wins that day in Archant's own computation (`reverseBalances`) | rejected; documented in `docs/deployment.md` |
| blind, edge, thermo | Formula injection: a label from a bank or a sender starting with `=` runs in a spreadsheet opening the CSV | medium | Labels and notes are written as is; a SEPA remittance text is chosen by whoever sends the money | patched: CSV text cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading `'`; `all.ndjson` stays exact |
| blind, edge | A failure before the first byte gives a 200 and a broken ZIP, never the error envelope | low | Deliberate: opening at the first pull is what keeps an unread body from holding a connection; a failure after the first byte cannot be enveloped anyway | rejected |
| blind | No test of a client closing the connection at the HTTP level | low | The thermo layer reproduced it with `serve()`: `@hono/node-server` cancels the reader on close | rejected |
| blind | The volume test's first-bytes check passes even if the transactions were buffered: the first chunk is `version.txt`'s header | medium | The first chunk is written before any page is read | patched: half the bytes must arrive before 80 % of the elapsed time |
| blind | `keysetPages` recursion makes each page cross every earlier generator | low | 50 pages per pass at 100,000 rows: about a thousand generator hops, unmeasurable beside the queries; `no-await-in-loop` asks for recursion | rejected |
| blind | `epic-18-context.md` lists neither `Budget` nor `BudgetCategory` and places the allowlist in `services/export.ts` | low | Written before the spec settled both | patched |
| blind | Spec `in-review` while the sprint status says `in-progress` | false | Mid-workflow states; finalization sets both to `done` | rejected |
| blind | The spec carries session-only paths and orders | low | Its fix edits this build's spec | rejected |
| edge | A stored amount condition that is not an integer throws mid-stream | false | `schemas/rules.ts` refuses any amount `parseAmount` cannot read, and `rule-reader.ts:133` already reads every stored one with `toMinorUnits(Number(value))` | rejected |
| edge | With the `download` attribute, an expired session saves the 401 JSON as a file | low | Needs the session to expire while the page is open; without the attribute the JSON replaces the page instead | rejected |
| edge, blind | On Turso, the snapshot is a remote interactive stream that may expire during a slow download | maybe-false | Needs a Turso database to measure its stream idle timeout | deferred, medium if true |
| edge | A `:memory:` pool has one connection, which the snapshot would hold | false | No target runs on `:memory:`; `createTempDatabase` documents why tests use a file | rejected |
| verification-gap | No export test checks a bank-linked account's opening anchor amount | medium | Every exported opening anchor in the specs belongs to a manual account, where both figures agree | patched: a linked account whose anchor amount differs |
| verification-gap | No export test has a rule naming a deleted merchant, category or tag | medium | `operandOf`'s fallback is never run | patched |
| verification-gap | `tagsOperand`'s several-tags branch is unreachable: Archant's tag action holds one id | low | `TagAction` holds one id | rejected: mirrors Sure's encoding, harmless |
| thermo | Sure refuses an entry 30 years old or more (`Entry.min_supported_date`), so an account opened before then, such as a property bought in 1994, fails the whole import | medium | `entry.rb:30`; Archant accepts opening dates from 1900 | patched: see Spec Change Log |
| thermo | A mid-stream failure reaches `@hono/node-server`'s `console.error` whole, its SQL parameters included | low | `handleResponseError` prints the error; the docs promise the name only | patched: the stream errors with a neutral `Error` after logging the name |
| thermo | Sure's importer ignores a loan's amount and rate, and rules naming an account keep Archant's ids | low | `safe_accountable_attrs`; Sure's own export does the same with account ids | patched: `docs/deployment.md` says so |
