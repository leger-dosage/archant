# Epic 18 Context: Export all my data

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The owner downloads every figure Archant holds in one archive, in Sure's export format, so their data is never locked in and they can leave for Sure if they ever want to. Archant writes the same files as Sure's exporter (`app/models/family/data_exporter.rb`), under the same names and columns, so that Sure's `SureImport` accepts the `all.ndjson`. It departs from Sure only where Archant's earlier choices force it. There is no background job and no stored archive, fields come from an allowlist, and an archive cannot be imported back.

## Stories

- Story 18.1: Download all my data

## Requirements & Constraints

- The archive holds every account, transaction, balance, category, merchant, tag, rule and recurring item, without any secret.
- Files: `version.txt`, `accounts.csv`, `transactions.csv`, `categories.csv`, `merchants.csv`, `rules.csv` and `all.ndjson`, under Sure's names and in Sure's column order. The file is named `archant_export_YYYYMMDD_HHMMSS.zip`.
- `all.ndjson` has one `{"type", "data"}` object per line, using Sure's types (`Account`, `Balance`, `Category`, `Tag`, `Merchant`, `RecurringTransaction`, `Transaction`, `Transfer`, `RejectedTransfer`, `Valuation`, `Budget`, `BudgetCategory`, `Rule`). Each line carries every field Sure's `SureImport::Preflight` requires. Rule operands are names with a `value_ref`, as in Sure. A test checks every line against a schema written from that preflight.
- Amounts in the files follow Sure's sign, a purchase positive, written as decimal strings. This is the reverse of Archant's own sign convention, and the interface says so.
- Fields Archant has and Sure lacks, such as locked fields, transfer kinds, dismissed recurring items and loan details, go in `all.ndjson` under Archant names that Sure's importer ignores.
- Never exported: authentication tables, bank sessions, keys, tokens, `identification_hash`, `provider_uid`, deduplication keys and raw import files. Sure's `Account#as_json` leaks provider ids, so whole rows are never serialised.
- No import of an archive. A full restore is the `VACUUM INTO` copy described in `docs/deployment.md`, and Sure's own importer duplicates accounts on a second run.
- With 100,000 transactions the export streams without holding the archive in memory, and the volume Vitest project measures it under 10 seconds.
- Only an administrator may export. Epic 20's viewer gets `403` on `/api/export`.
- One new dependency at most, a maintained streaming ZIP library, justified in the pull request.
- Every acceptance criterion has a test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- `GET /api/export` builds the ZIP inside the request and streams it. There is no queue and no job (one process, no broker), so Sure's statuses, polling, cancellation, stuck-export reaper and list of past exports have no equivalent. Nothing is written to `/data`.
- The response is a ZIP outside the `{ data }` envelope, like `/api/auth/*` and `/api/mcp`, with `Content-Disposition: attachment`. The compression middleware leaves it alone. The interface downloads it through a plain link, never through the `hc` client.
- Code lives in `services/export.ts`, and the route calls one service function. Each table is read through an allowlist of exported columns, `EXPORTED_COLUMNS` in `services/ledger/export.ts`, the only place AD-2 lets the ledger's tables be read, beside `LEFT_OUT`. A spec fails when a schema column is neither exported nor listed as left out. That spec covers every table that exists today, the Epic 17 budget tables included.
- Amounts are integer minor units in the database. Converting them to Sure's signed decimal strings uses the currency's minor-unit count and never goes through a float.
- Secrets and logs: nothing encrypted (Enable Banking session ids, private key, tokens) ever leaves in the archive. Log lines for the export carry only ids, counts, durations and error codes, never an amount, a label or an IBAN. Any failure is a sanitised `AppError`.

## UX & Interaction Patterns

- « Réglages › Données » lives at `/settings/data`, among the settings sections, and only an administrator sees it.
- The page lists what the archive holds and what it leaves out, says that amounts follow Sure's sign, and offers « Exporter mes données », which downloads the ZIP.
- Visible strings go through i18next in French. URLs stay in English.

## Cross-Story Dependencies

- `docs/deployment.md`, `docs/security-model.md` and `docs/sure-parity.md` must say that the archive is portable but is not a backup, that it holds amounts and labels in clear, and how to move to Sure with it.
- Every later epic that adds a table adds it to the export, or to the left-out list, in the same story, as Sure's exporter covers budgets, splits, trades and holdings. Epic 19 nests split lines under their parent in `all.ndjson`, lists the children in `transactions.csv` and adds `attachments.json` without file contents. Epic 20 refuses the export to viewers. Epic 21 adds goals and their links. Epic 22 adds `trades.csv` and `Security` lines carrying the ISIN.
