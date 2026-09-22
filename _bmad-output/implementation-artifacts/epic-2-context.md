# Epic 2 Context: Import bank files

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user feeds an existing account from the OFX, CSV or QIF files their bank exports, sees a preview before anything is written, never gets a duplicate from re-importing the same or an overlapping file, and can revert an import. The account balance then matches the bank's, because an OFX closing balance becomes a snapshot. This epic builds the first implementations of the connector port and the keyed ingestion path of the ledger; Epic 10's Enable Banking connector reuses both unchanged, so nothing here may be file-specific inside the ledger.

## Stories

- Story 2.1: Import an OFX file with preview
- Story 2.2: Use the OFX ledger balance
- Story 2.3: Import a CSV file with a saved mapping
- Story 2.4: Import a QIF file
- Story 2.5: Import history and revert

## Requirements & Constraints

- Imports target one existing account. OFX 1.x (SGML) and 2.x (XML): `FITID`, posting date, amount, label from `NAME` and `MEMO`, plus `LEDGERBAL` and its `DTASOF`. CSV: user maps date, label, a signed amount or separate debit and credit columns, optional notes; chooses delimiter, date format (default `DD/MM/YYYY`), decimal separator (default comma) and sign convention; mapping saved per account and reused. QIF: `Bank` and `CCard` types only, fields `D`, `T`/`U`, `P`, `M`, `N`; day-first by default with a month-first choice; other types (`Invst`) refused naming the type.
- Preview before any write, grouped as to create, already present, matched to an existing entry from another source, possible duplicates, and rejected with a reason. Rejected CSV lines carry their line number.
- Lines dated on or before the opening date are rejected with `BEFORE_OPENING_DATE`; the preview offers to move the opening date.
- Re-importing the same file creates nothing. Two identical lines on the same day both survive the first import and are both recognised on re-import. Editing an imported transaction's label or amount never breaks its recognition.
- An import is atomic per account: a failure writes nothing. Confirm writes the transactions, marks the import confirmed with file name, format, date and counts, and recomputes balances in one database transaction.
- Invalid file or larger than 5 MB: `400 INVALID_IMPORT_FILE`, nothing written. Account changed since the preview: `409 IMPORT_PREVIEW_STALE`, and the interface shows the new preview.
- Revert deletes the keys the import wrote, the transactions it created unless another source has confirmed them since, and the snapshot it created, then recomputes balances. A reverted file can be imported again.
- A 5,000-line file imports in under 10 seconds. Windows-1252 and UTF-8 with or without BOM decode accented labels correctly.
- Parsers are tested on committed, anonymised files from French banks (at least three across parsers per the architecture). Parsers, dedup and ledger are covered to 100% of branches. Every acceptance criterion has an automated test: Playwright for the interface, Vitest for the rest. No test reaches the network.
- Logs carry only ids, counts, durations and error codes, never a statement line or an amount.

## Technical Decisions

- Connector port in `domain/statement.ts`: each parser returns a `ParsedStatement` (`transactions` of `NormalizedTransaction`, a nullable `balance` signed as the bank shows it, and `rejected` with `ref` and a `RejectionCode`). A file parser implements `FileSource { id; detect(bytes, fileName); parse(bytes, options) }`; `options` carries the account currency and the CSV mapping. Sources are registered in the static `connectors/registry.ts`. Connector ids `ofx`, `csv`, `qif` are also `entry_keys.source` and `imports.source`. Connectors parse with Zod, never touch the database, never import `drizzle-orm` or `services/**`.
- Pipeline: `ledger.ingest(accountId, statement, { importId, dryRun })` runs in fixed order: opening-date rejection, batched key matching, pending reconciliation, insert and attach keys, rules (no-op), transfer matching (no-op), statement balance, balance recompute. `dryRun` returns the grouped preview and rolls back. The preview stores bytes and options in `imports` with status `previewed` and returns its id; confirm re-runs `ingest` with that id and answers `409` if the groups differ. Previewed imports older than 24 hours are purged at start. Orchestration lives in `services/imports.ts`; only `services/ledger.ts` writes money tables.
- Keys in `entry_keys (entry_id, account_id, source, key, import_id, connection_id)`, unique on `(account_id, source, key)`. Every line gets `fp:<sha256 of date|amount|normalised label|occurrence index within the statement>`, plus `ext:<externalId>` when present (OFX `FITID`). Keys are written at ingest and never recomputed. An exact match on either key means already present. Remaining lines are paired one-to-one with candidates of the same amount at the nearest date within 3 days (entries of the account committed before this ingest, without a key from this source); no candidate means create, a tie means create and flag `possible_duplicate`. Label normalisation (lower case, no accents, collapsed spaces) lives in `domain/normalize-label.ts`, reused later by merchants and recurring detection.
- Revert deletes the import's keys, then deletes an entry only if no key from another source remains, and never deletes a valuation it did not create.
- Statement balance: converted by `toStoredBalance(account, signedBalance)`; no connector negates a balance. It becomes a `reconciliation` valuation carrying `import_id`, unless the user entered one on that date, in which case the user's value stays and the preview shows the gap. A negative credit card ledger balance shows as a positive outstanding debt.
- Entry identity is stable: merges go through `ledger.absorb(survivorId, source)`, which moves keys onto the survivor.
- Decoding: `TextDecoder` strict UTF-8, falling back to `windows-1252`; OFX honours its `CHARSET` header. Parsers receive strings.
- Libraries: `ofx-js` 1.1.1, wrapped: refuse files over 5 MB before parsing (its SGML conversion slows exponentially), a pre-pass closes empty leaf tags such as `<MEMO>`, its output is parsed by Zod, and `TRNAMT` accepts a decimal comma. `papaparse` 5.7.0 for CSV. The QIF parser is written in the repository. No date or money library.
- Uploads are `multipart/form-data` behind a 5 MB `bodyLimit`. New error codes (`INVALID_IMPORT_FILE`, `IMPORT_PREVIEW_STALE`) join the closed `AppError` union; rejection reasons are `RejectionCode`s, not free text.
- Data model adds `imports` (per account, status, source, file name, counts, stored bytes and options) and `import_mappings` (one saved CSV mapping per account).
- Known limit from Epic 1: `ledger.ingest` inserts `entries` and `transactions` in one statement; at about 3,600 lines it exceeds SQLite's 32,766-parameter cap, so inserts must be chunked, as `recomputeBalances` already chunks balance rows.

## UX & Interaction Patterns

- Import dialog over account detail, opened by « Importer » or `i`; steps at the top: Fichier, Colonnes (CSV only), Aperçu. Drop zone or file picker, format detected. It never opens a sheet.
- Preview tabs with counts: À créer, Déjà présentes, Rapprochées, Doublons possibles, Rejetées. Confirm button states the count (« Importer 42 opérations »). Group counts are announced to screen readers.
- CSV mapping: first ten rows as a table with a select above each column (Date, Libellé, Montant, Débit, Crédit, Notes, Ignorer); delimiter, date format, decimal separator and sign convention prefilled with French defaults; preview updates live. A saved mapping skips straight to the preview with a way to change it.
- States: nothing new shows « Toutes les opérations de ce fichier sont déjà présentes. » with confirm disabled; stale shows « Le compte a changé depuis l'aperçu. Vérifiez avant d'importer. »; the Rejetées tab offers « Avancer la date d'ouverture au 3 janvier 2025 »; an unreadable file shows « Ce fichier n'est pas un relevé OFX lisible. ».
- Account detail gains an Imports tab (history, revert with a confirmation stating counts). The empty account state offers « Importer un fichier ». The transaction sheet shows the source (« import OFX du 12 sept. »); imported transactions have a read-only account. Possible duplicates show a warning icon and « Doublon possible ».
- Below 768 px, import shows « Disponible sur ordinateur ». Result toasts give numbers only (« 42 opérations importées, 3 déjà présentes. »).

## Cross-Story Dependencies

- Story 2.1 creates the file connector port, the registry, `imports`, `entry_keys`, key matching, the preview and confirm flow, and the import dialog. Every other story builds on it.
- Story 2.2 extends 2.1's OFX parser and the pipeline's statement-balance step, and relies on Epic 1's `reconciliation` valuations.
- Stories 2.3 and 2.4 plug new `FileSource`s into the same pipeline; 2.4 reuses 2.3's fingerprint path for lines without an id. 2.3 adds `import_mappings` and the Colonnes step.
- Story 2.5 needs imports and keys from 2.1, and the snapshot link from 2.2.
- Builds on Epic 1's `ledger.ingest`, opening anchor, `balanceOn` and balance recompute. Epic 10 reuses the port, keys, pipeline and `absorb`; Epic 5 and Epic 8 fill the pipeline's no-op steps.
