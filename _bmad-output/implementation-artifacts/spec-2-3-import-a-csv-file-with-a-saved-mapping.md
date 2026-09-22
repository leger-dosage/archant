---
title: 'Story 2.3: Import a CSV file with a saved mapping'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '8cedfc3d79ec482271200029695b7eb21db4c0bc'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Many French banks export only CSV, and every one lays its columns out differently, so Archant cannot read their files and the user falls back to typing lines by hand.

**Approach:** Add the `csv` file source behind the connector port (AD-3), fed by a column mapping the user builds once in a new Colonnes step and that is saved per account at confirm. Lines go through the same preview, fingerprint keys and confirm as OFX; the ledger does not change.

## Boundaries & Constraints

**Always:**
- `CsvMapping` (Zod, `schemas/imports.ts`, type in `packages/data/schema/imports.ts`): `delimiter` `;` | `,` | `\t`; `skipRows` 0–50; `hasHeader` boolean; `dateFormat` `DD/MM/YYYY` | `DD/MM/YY` | `DD-MM-YYYY` | `DD.MM.YYYY` | `YYYY-MM-DD` | `MM/DD/YYYY`; `decimal` `,` | `.`; `sign` `inflows-positive` | `inflows-negative`; `columns`, one role per column index: `date`, `label`, `amount`, `debit`, `credit`, `notes`, `ignore`. Valid when exactly one `date`, at least one `label`, and either one `amount` with no `debit`/`credit`, or no `amount` with at most one `debit` and one `credit`, at least one of them. Otherwise `400 VALIDATION_ERROR`.
- Defaults for a first import: delimiter guessed by `papaparse` (5.7.0, justified in the pull request), falling back to `;`; `skipRows` 0; `hasHeader` true; `DD/MM/YYYY`; comma; `inflows-positive`; every column `ignore`.
- Line mapping in `connectors/csv/csv.ts`: records after `skipRows` and the header; empty records skipped. Several `label` columns join in column order with one space, empty cells dropped, cut at `LABEL_MAX_LENGTH` by code points; same for `notes`, `null` when empty. Amount: spaces, no-break spaces and a leading or trailing `€` or account currency code stripped; the non-decimal separator is accepted only between groups of three digits (`1.234,56` yes, `12.50` with comma decimal is `INVALID_AMOUNT`); then `parseAmount` from `packages/data/money.ts`. `inflows-negative` negates a signed amount. A debit cell gives `-abs`, a credit cell `+abs`, so the sign printed in those columns never matters; both filled or both empty is `INVALID_AMOUNT`. `externalId` is always `null`: keys are the existing `fp:` fingerprints of `domain/keys.ts`, stored at ingest, never recomputed.
- A rejected record's `ref` is its 0-based record index in the whole file, so the dialog's existing `Number(ref) + 1` reads « Ligne N » counting skipped and header rows.
- Decoding through `connectors/decode.ts` `decodeText` as is. Detection by the `.csv` extension, case-insensitive. A file with no record of at least two fields is `400 INVALID_IMPORT_FILE`.
- `FILE_SOURCE_IDS` gains `csv`; migration 0007 rebuilds the `imports` and `entry_keys` source checks and creates `import_mappings (account_id` primary key referencing `accounts` on delete cascade, `mapping` JSON, `updated_at)`. `services/imports.ts` owns the table; confirm upserts the import's mapping in the same database transaction as the ledger write.
- API: `FileSourceOptions` gains `csv?: CsvMapping`; `ImportOptions` stores it and `statementOf` passes it. For a CSV upload, `ImportPreview` gains `csv: { sample: string[][], mapping: CsvMapping | null, saved: boolean }`, `sample` being the first 20 raw records with the chosen delimiter. With a saved mapping whose columns all exist in the file, upload applies it and returns groups; otherwise `mapping` is `null`, groups are empty, and nothing is computed. `POST /api/imports/:id/preview` accepts `csv` beside `moveOpeningDate`.
- Dialog: steps Fichier, Colonnes (CSV only), Aperçu. Colonnes shows the first ten records after `skipRows` in a table with a select above each column (Date, Libellé, Montant, Débit, Crédit, Notes, Ignorer), then delimiter, lines to skip, header checkbox, date format, decimal separator and sign convention; the header row, when present, names the columns. Groups and counts show under the table and refresh 300 ms after the last change; confirm stays disabled while the mapping is invalid. A saved mapping opens Aperçu directly, with « Modifier les colonnes » returning to Colonnes. File input accepts `.ofx,.qfx,.csv`, labelled « Relevé bancaire »; `errors.INVALID_IMPORT_FILE` becomes « Ce fichier n'est pas un relevé bancaire lisible. ».
- Fixtures under `connectors/csv/fixtures/`, synthetic, each naming the bank it imitates in a comment line skipped by `skipRows`: a Société Générale-like file (`windows-1252`, account preamble, signed comma amounts), a Crédit Agricole-like file (debit and credit columns, `1 234,56`), a Boursorama-like file (UTF-8 with BOM, header, signed amounts).

**Never:**
- No currency, category, tag or account column; no id column as `externalId`; no per-bank presets; no automatic date-format guess; no QIF (2.4), history or revert (2.5); no change to `ledger.ts` beyond what a type rename forces.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First import | CSV, no saved mapping | Colonnes step, sample shown, no groups | — |
| Saved mapping | Second CSV into same account | Aperçu directly, mapping applied | — |
| Mapping no longer fits | Saved `date` on column 5, file has 4 | Colonnes step prefilled with the saved mapping | — |
| Twin lines | Two identical lines same day | Both created; both present on re-import | — |
| Edited after import | Label and amount changed since | Still already present | — |
| Debit and credit | `Débit 42,90` / `Crédit 1 200,00` | `-42,90` / `+1 200,00` | — |
| Both cells | Debit and credit filled on one line | Rejected `INVALID_AMOUNT`, « Ligne 7 » | — |
| Bad date | `31/02/2026` in `DD/MM/YYYY` | Rejected `INVALID_DATE` with line number | — |
| Wrong decimal | `12.50` with comma decimal | Rejected `INVALID_AMOUNT` | — |
| Encodings | `windows-1252`, UTF-8 with and without BOM | `Prélèvement Crédit Agricole` intact | — |
| Invalid mapping | Two `date` columns | Nothing computed | `400 VALIDATION_ERROR` |
| Not CSV | `.csv` holding one column of text | Nothing written | `400 INVALID_IMPORT_FILE` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/statement.ts` -- `NormalizedTransaction` (L11) already has `notes`; `RejectionCode` (L28) covers every CSV failure; `rejected` (L50) `{ ref, reason }`.
- `packages/api/src/connectors/file-source.ts` -- `FileSourceOptions` (L11) gains `csv`; `detect`/`parse` (L21–26).
- `packages/api/src/connectors/registry.ts` -- `SOURCES` (L9); `detectFileSource` (L15) picks the first match, OFX first.
- `packages/api/src/connectors/decode.ts` -- `decodeText` (L15): BOM stripped, strict UTF-8 then `windows-1252`. Reuse unchanged.
- `packages/api/src/connectors/ofx/ofx.ts` -- pattern to copy: `toLine` (L134) returns a line or a `RejectionCode`, label cut (L165), `detect` (L244); 5,000-line parser test in `ofx.spec.ts` (L440).
- `packages/data/money.ts` -- `parseAmount` (L238) accepts `.` or `,` and space grouping only; the CSV amount helper normalises before calling it.
- `packages/api/src/domain/keys.ts` -- `lineKeys` (L32): fingerprints and occurrence index, unchanged.
- `packages/data/schema/imports.ts` -- `FILE_SOURCE_IDS` (L11), `ImportOptions` (L20); new `import-mappings.ts`, exported in `package.json` and `types.ts`. Last migration `0006_add_entry_import.sql`; `migrate.spec.ts`.
- `packages/api/src/services/imports.ts` -- `ImportPreview` (L31), `statementOf` (L75), `runPreview` (L82), `createImport` (L121, inserts `options: {}` at L156), `previewImport` (L169), `confirmImport` (L186).
- `packages/api/src/schemas/imports.ts` -- `importPreviewSchema` (L23) gains `csv`.
- `packages/api/src/services/ledger.ts` -- untouched: chunked inserts (L78–96), `updateTransaction` (L898) never touches keys, 5,000-line test in `ledger.spec.ts` (L916).
- `.oxlintrc.json` -- `import-mappings` is on no restricted list; `connectors/**` override (L147) already applies to `csv/`. `vitest.config.ts` (L16) already holds connectors at 100%.
- `packages/web/src/components/ImportDialog.tsx` -- `Steps` (L56) hard-codes two steps; `ImportFlow` (L279), `read` (L298), re-preview (L363), file input (L421); `Number(ref) + 1` line display (L144). `hooks/useImports.ts` `usePreviewImport` (L33). `components/ui/select.tsx`, `table.tsx`, `label.tsx`. `locales/fr.json` `imports` (L276), `imports.file` (L287), `errors.INVALID_IMPORT_FILE` (L349).
- `packages/web/e2e/import-ofx.spec.ts` -- `openImport` (L106), `choose` (L113) finds the input by « Fichier OFX »: update the label there. `e2e/fixtures.ts` `daysAgo`, `openAccount`.
- `TransactionSheet.tsx` (L377) already renders « Import CSV du … ».

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/csv/csv.spec.ts`, `fixtures/` -- tests first: every matrix parser row, each fixture, delimiters, `skipRows` and header, each date format, both decimals and signs, several label columns, empty records, 5,000 lines under 2 s.
- [x] `packages/api/src/connectors/csv/csv.ts`, `connectors/file-source.ts`, `connectors/registry.ts`, `packages/api/package.json` -- `csvSource` with `papaparse` and `@types/papaparse`.
- [x] `packages/data/schema/imports.ts`, `import-mappings.ts`, `types.ts`, `package.json`, `drizzle/0007_*`, `migrate.spec.ts` -- `csv` id, `CsvMapping` type, table, migration.
- [x] `packages/api/src/schemas/imports.ts`, `services/imports.ts`, `app.spec.ts` -- mapping schema; upload with and without saved mapping; preview with mapping; confirm saves the mapping; invalid mapping 400; 5,000-line CSV confirm under 10 s; re-import all present.
- [x] `packages/web/src/components/ImportDialog.tsx`, new `CsvColumns.tsx`, `hooks/useImports.ts`, `lib/import-preview.ts`, `locales/fr.json` -- Colonnes step, three steps, texts.
- [x] `packages/web/e2e/import-csv.spec.ts`, `import-ofx.spec.ts` -- CSV built in the test with `daysAgo`; one test per acceptance criterion below.

**Acceptance Criteria:**
- Given an account with no saved mapping, when I upload a CSV, then Colonnes shows its rows; after I pick Date, Libellé and Montant the counts appear, and confirm writes the lines.
- Given a mapping with a line that fails, when the preview refreshes, then Rejetées lists it with « Ligne N » and its reason.
- Given a confirmed CSV import, when I upload another CSV into that account, then Aperçu opens directly, and « Modifier les colonnes » returns to Colonnes with the saved choices.
- Given the same CSV imported again, when the preview opens, then every line is under Déjà présentes and confirm is disabled.
- Given a Windows-1252 CSV, when the preview opens, then accented labels read correctly.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Implementation Notes

- The CSV preview also carries `prefill`, the mapping the Colonnes step starts from: `mapping` is `null` when the saved mapping no longer fits, and the step must still open prefilled with it.
- The mapping's choice lists live in `packages/data/csv-mapping.ts`, so the interface imports them without Drizzle; the `CsvMapping` type stays in `schema/imports.ts`.
- `ServiceDeps.db` is narrowed to the query methods a transaction also offers, so `confirmImport` runs `ledger.ingest` inside its own transaction (a savepoint there) and saves the mapping atomically without touching `ledger.ts`.
- `papaparse` 5.7.0 pinned; `@types/papaparse` 5.5.2, the latest published, since the architecture's 5.7.0 does not exist.
- The interface re-splits the sample itself when the delimiter changes while the roles are still invalid (`resplit` in `lib/import-preview.ts`), for display only; counts always come from the server.
- `SAMPLE_RECORDS` is `MAX_CSV_SKIP_ROWS + 1 + 10` (61), not the 20 the frozen block states: with `skipRows` up to 50, a 20-record sample left Colonnes empty past 19 skipped rows (review finding #4).
- Live previews are sent one at a time, so the last mapping sent is the one stored and confirmed.
- A file with an unterminated quote is refused with `INVALID_IMPORT_FILE`.
- QA on a throwaway database, Chromium 1280 px, dark: the Société Générale-like fixture opens on Colonnes, three skipped rows and Date, Libellé, Montant give 6 lines under À créer with accents intact and both twins kept; confirm moves the balance from 1 000,00 € to 2 981,48 €; the same file again applies the saved mapping and lists 6 under Déjà présentes.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `csv.ts` `recordsOf` | Unterminated quote swallows the rest of the file, lines vanish without a rejection | medium | `recordsOf` reads `.data` only; papaparse reports `MissingQuotes` and returns one long cell. | patch |
| 2 | blind, edge, verification | `csv.ts` `parse` `ref` | « Ligne N » is the record index, off after a multi-line quoted cell | low | True, but the frozen block defines `ref` as the record index; bank exports rarely break a cell over lines. Comment corrected only. | patch (comment) |
| 3 | blind | `csv.ts` `guessDelimiter` | `preview: 1` guesses from the first line, so any preamble falls back to `;` | low | papaparse sees one row; the three fixtures all start with a comment line. Direct fix. | patch |
| 4 | blind, edge | `csv.ts` `SAMPLE_RECORDS` | `skipRows` up to 50, sample 20: Colonnes goes empty past 19 | medium | The frozen block states both numbers; they contradict. Sample raised to cover the largest skip, noted below. | patch |
| 5 | blind, edge | `services/imports.ts` `createImport` | Database failure logged as `INVALID_IMPORT_FILE` | low | `savedMapping` runs inside the logging `try`. Direct move. | patch |
| 6 | edge | `ImportDialog.tsx` live preview | Out-of-order previews store the older mapping while the newer counts show; confirm writes the older | medium | Client ignores the late answer but the server keeps whichever request committed last; the digest check passes on that mapping. | patch |
| 7 | blind | `fr.json` | `imports.csv.refreshing` unused | low | No component reads it. Deleted. | patch |
| 8 | blind, verification | `services/imports.ts` `savedMapping` | Invalid stored mapping never tested | medium | Pre-verified: only `migrate.spec.ts` writes the table. | patch |
| 9 | blind, verification | `ImportDialog.tsx` confirm | Invalid draft after a preview disabling confirm is untested | medium | Pre-verified: no test edits the draft after the first preview. | patch |
| 10 | edge | `csv.ts` `signedAmount` | A bank writing `0,00` in the unused debit or credit column gets every line rejected | maybe-false | The frozen block rejects both cells filled; real exports would settle whether any French bank zero-fills. | defer |
| 11 | blind | `csv.ts` `amountOf` | Spaces accepted anywhere: `12 50` reads 1 250 | low | Bank exports do not print malformed groups; the fix reworks the pattern. Rejected. | |
| 12 | blind | mapping | A `Devise` column is ignored | false | The intent excludes a currency column. | |
| 13 | blind, edge | `lib/import-preview.ts` `csvTable` | Width from the ten shown rows, wider later rows unmappable | low | Bank exports keep one width; the fix adds a response field. Rejected. | |
| 14 | blind | `mappingFits` | Saved mapping applies to any file as wide | false | The frozen block defines fit as every mapped column existing. | |
| 15 | blind | `csvSource.detect` | `.tsv` and `.txt` refused | false | The frozen block detects by `.csv` only. | |
| 16 | blind | `sameMapping` | Key-order comparison, duplicated in api and web | low | Both objects come from the schema or its spread; a shared comparator adds surface. Rejected. | |
| 17 | edge | `amountOf` | `-€12,50` refused | low | Not a bank export format. Rejected. | |
| 18 | edge | `dateOf` | Date with a time refused | low | No French bank CSV seen with times; a guess would widen the frozen formats. Rejected. | |
| 19 | edge | `ImportDialog.tsx` effect | `opening.date` dependency re-sends a preview | low | At most one extra request, then stable. Rejected. | |
| 20 | edge | `csvPreview` | Saved mapping wider than the file prefills without its date | low | The user picks the date again on Colonnes. Rejected. | |
| 21 | edge | `signedAmount` | `0,00` debit yields `-0` | low | Serialises as `0` in SQL, JSON and the fingerprint. Rejected. | |

## Design Notes

Columns are addressed by index, not header name, because French exports often start with account lines and several have no header at all; `skipRows` and `hasHeader` cover both, as Sure's `rows_to_skip` does. The mapping saved is the whole `CsvMapping`, unlike Sure's `apply_template!`, which forgets the delimiter. Debit and credit take their sign from the column, never from the cell, because banks disagree on whether a debit cell is printed negative. Live preview re-runs the server dry run rather than parsing in the browser, so the counts shown are the ones confirm checks against.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `import-csv.spec.ts` and the existing suite pass.

**Manual checks:**
- Import each fixture on a throwaway database, light and dark, 1280 px: accents readable, balances match the fixtures' sums.
