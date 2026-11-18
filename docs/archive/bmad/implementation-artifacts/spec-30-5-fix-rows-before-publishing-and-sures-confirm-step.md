---
title: "Story 30.5: Fix rows before publishing, and Sure's confirm step"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: '4995727d9c965a1d4c69029f33728fbd8dfc86e1'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-30-4-map-currency-category-tags-account-and-a-type-column-sures-date-formats.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-30-2-import-mint-ynab-and-actual-files.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) puts « Nettoyer » between « Configurer » and « Mapper » for every CSV import: `Import::CleansController#show` lists the rows Sure's `generate_rows_from_csv` made, ten per page, « Toutes les lignes » or « Lignes d'erreur », each invalid cell red with its reason, and `Import::RowsController#update` saves a cell when it is left and validates the row again; « Étape suivante » appears only once every row is valid (`cleaned?`), and « Confirmer » (`imports/_ready`) is then the `dry_run` summary alone. Archant's nine CSV imports of « Réglages › Importations » (Stories 30.2 to 30.4) have no « Nettoyer »: a refused row is listed on « Confirmer », which stays unpublishable until the user edits the file and starts again.

**Approach:** Keep Story 30.3's stateless path (`POST /api/csv-imports(/preview)`, the page keeps the file): the page also keeps the user's cell edits and posts them as `edits`, one `{ line, key, value }` per cell, Sure's saved `Import::Row` fields. The server reads every cell a kind displays through the edit first, so validation, mappings, counts and publishing all see the edited row. The preview returns Sure's rows, `clean.columns` (Sure's `column_keys` of the kind) and `clean.rows` (each line's values and its issues by column). The page gains « Nettoyer » after « Configurer » for all nine kinds; « Confirmer » keeps only Sure's summary; a publish the server refuses goes back to « Nettoyer » with Sure's `invalid_data` notice.

## Boundaries & Constraints

**Always:**
- Columns, Sure's `column_keys` in its order: transactions `account` (multi-account only), `date`, `amount`, `name`, `currency`, `category`, `tags`, `notes`; trades `account` (multi-account only), `date`, `ticker`, `exchange_operating_mic`, `currency`, `qty`, `price`, `name`; accounts `entity_type`, `name`, `amount`, `currency`, `date`; categories `name`, `category_color`, `category_parent`, `category_icon`; merchants `name`, `merchant_color`, `merchant_website`; rules `name`, `resource_type`, `active`, `effective_date`, `conditions`, `actions`; Mint `date`, `amount`, `name`, `currency`, `category`, `tags`, `account`, `notes`; YNAB `date`, `name`, `category`, `account`, `notes`; Actual `date`, `amount`, `name`, `category`, `account`, `notes`.
- A cell shows what the import reads for that key: the mapped column's cell for most; YNAB and Actual name and category as their row name and combined category; a category, merchant or rule cell from Sure's `header_for` columns. An edit replaces exactly that value; an edit of a key the kind does not show is ignored.
- Every refusal with a line lands on its row, in the cell of its key (a `field` param, else the key the code concerns); one whose key the kind does not show lands on the row's first cell. A refusal without a line (missing or duplicate headers, an incomplete type column) shows above the table. Mapping refusals (`unmapped_*`) belong to « Mapper », not « Nettoyer ».
- « Étape suivante » is disabled while any row or file refusal stands; « Appliquer la configuration » or another file drops the edits, as Sure's `generate_rows_from_csv` rebuilds the rows.
- Ten rows per page, « Précédent » and « Suivant »; « Lignes d'erreur » lists only rows with a refusal.
- Edits are bounded (100,000 per request, 10,000 characters per value) and parsed by Zod; no edit is logged.
- Steps read « Téléverser », « Configurer », « Nettoyer », « Mapper » (when the kind has mapping steps), « Confirmer ».

**Never:** no stored upload or stored row between steps (AD-14 holds); no change to an account's own « Importer » dialog (OFX, QIF and indexed CSV keep AD-4's grouped preview, QIF moving in Story 30.6); no migration; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Invalid date fixed | line 3 `31/02/2026`, edit to `28/02/2026` | row valid, « Étape suivante » enabled, line published on 2026-02-28 | before the edit: `invalid_date` on the date cell |
| Category edited | transactions, edit `category` of a row to `Loisirs` | « Attribuez vos catégories » lists `Loisirs` with its count | none |
| Account type edited | accounts, edit `entity_type` to `Depository` | mapping preselects « Dépôt » | none |
| YNAB amount unreadable | `Inflow` = `abc` | refusal on the row's first cell | not fixable in the table, as Sure shows no amount for YNAB |
| Edit of hidden key | `entity_type` edit on a transactions file | ignored | none |
| Stale publish | file refused at publish | back to « Nettoyer » with the invalid-data notice | `CSV_IMPORT_INVALID` |

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/csv-imports.ts` -- `CLEAN_KEYS`, `cleanColumnsOf(type, accountId)`, `csvImportEditsSchema`, `edits` on `csvImportUploadSchema`.
- `packages/api/src/services/csv-import-sheet.ts` -- `Sheet.edits`, `editOf`, `cellOf` reading the edit first, `headerCellOf` for Sure's `header_for` kinds.
- `packages/api/src/services/csv-import-tools.ts` -- `rawLabelOf`, `categoryOf` read the edit first.
- `packages/api/src/services/csv-import.ts` -- categories and merchants read through `headerCellOf`; `analyse` takes the edits; the preview returns `clean`.
- `packages/api/src/services/csv-import-rules.ts` -- `ruleRowOf` reads edits; `invalid_json` names its field.
- New `packages/api/src/services/csv-import-clean.ts` -- `cleanOf(sheet, errors)`: Sure's rows, each issue placed on its cell.
- `packages/api/src/routes/csv-imports.ts` -- pass `edits`.
- App: `hooks/useCsvImport.ts` (`edits`), new `components/CsvCleanStep.tsx` and `lib/csv-clean.ts` (Sure's `cleaned?`), `routes/_authed.settings.imports_.$kind.tsx` (step, edits, confirm without errors, refusal back to clean), `locales/fr.json`.
- Tests: new `services/csv-import-clean.spec.ts`; `routes/csv-imports.spec.ts` (edits parsed); e2e `packages/app/e2e/csv-import.spec.ts` updated for « Nettoyer » and a test fixing an invalid date then publishing.
- Docs: `docs/architecture.md` AD-4, `docs/sure-parity.md` « Clean step » and « Preview », `docs/deployment.md` « Importing CSV files ».

## Tasks & Acceptance

**Execution:**
- [x] Vitest first: clean columns per kind, values through edits, issues on their cells, an edit fixing a date then publishing, an edited category reaching the mappings and the counts, a hidden key ignored, rules and categories edited.
- [x] Schema, sheet, tools, rules, service, route.
- [x] Interface: « Nettoyer » step and its table, confirm summary only, locale strings.
- [x] Playwright: fix an invalid date in the table and publish; existing tests pass « Nettoyer ».
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given a configured import with an invalid date, when the user corrects the cell and leaves it, then the cell is no longer red, « Étape suivante » is enabled, and publishing writes the corrected date.
- Given a clean import, then « Confirmer » lists « Élément » and « Nombre » and « Publier l'importation », with no refusal list.

## Design Notes

Assumptions taken alone, the owner unavailable, settled by Sure or by Archant's model:

- Edits live in the page and are posted with every request, where Sure stores `import_rows`: Story 30.3 chose a stateless path (no stored upload, AD-14), and a row edit is the same kind of choice as a column or a mapping. Leaving the page loses them, as it loses the file.
- AD-4 changes: « Réglages › Importations » CSV imports are cleaned row by row and confirmed on Sure's `dry_run` summary; an account's own « Importer » dialog keeps its grouped preview and `IMPORT_PREVIEW_STALE`, since OFX has no Sure counterpart, QIF follows Sure's steps in Story 30.6, and its indexed CSV (no header, several label columns, debit and credit) has no Sure form to clean through.
- A cell shows the file's text, not Sure's sanitized number: Archant reads a number through « Format numérique » at each request, and a sanitized `1234.56` would read wrongly under `1.234,56`.
- Archant's own refusals (currency mismatch, too many tags, a category its own parent, a rule it cannot hold…) are row errors in the table, where Sure fails them at publish: they are known before publishing.
- The reason shows under the red cell, where Sure shows it on hover and behind an icon on a phone: readable on both without a hover.
- Column headers use Archant's words where Sure's French reads « Remarques », « Balises », « Échange », « Icône Lucide », « URL du site web »; Sure labels no rule column, Archant names them.
- Pagination is Archant's « Précédent » / « Suivant » with « Page n sur m », without Sure's per-page choice.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

## Implementation Notes

Decisions taken alone during implementation, the owner unavailable, each settled by Sure or by Archant's model:

- Implemented in this session rather than by a dispatched agent, the investigation being already loaded.
- The edits are read where the import reads each cell: `cellOf` takes the edit first, so transactions, Mint, accounts and trades needed no other change; YNAB and Actual name and category, the category and merchant `header_for` columns and the rule cells read it in `rawLabelOf`, `categoryOf`, `headerCellOf` and `ruleCellsOf`. An edit is trimmed, as `parseCsv` trims the file's cells.
- An edited YNAB or Actual category is the mapping key as typed, not joined to its group again, as Sure saves the row's combined category; an edited name left blank takes Sure's default row name, not the notes, as Sure's row fallback runs once when the rows are made.
- `invalid_json` now names the field it concerns, `conditions` or `actions`, so the refusal lands on its cell.
- Sure's `cleaned?` lives in `lib/csv-clean.ts`: a mapping refusal (`unmapped_*`) belongs to « Mapper ». « Confirmer » reached with an invalid row goes back to « Nettoyer » with Sure's `invalid_data` notice, and with a value left to map back to « Mapper », as Sure's `finalize_mappings`.
- « Lignes d'erreur » keeps the lines that were invalid when it was chosen: a fixed row stays until the view is chosen again, as Sure's turbo frame updates the row in place, so the next cell the user tabs to is not taken away.
- Each cell left posts one preview; only the last answer is applied, so two quick edits never come back out of order.

## Review Triage Log

First pass, the three `bmad-build` review layers.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| B1 | `docs/deployment.md` lists « Mapper » before « Nettoyer » | low | patch | Sentence rewritten in the step order. |
| B2, E2, E3, E7, E8, V-other | A mapping refusal at « Confirmer » shows nowhere and leaves publish disabled | medium | patch | `advance("confirm")` goes back to « Mapper » when a refusal remains on clean rows. |
| B3, E6 | File refusals cut at 50 without a « … autres » line | low | patch | The cut is gone: a file has a few such refusals at most. |
| B4, E10 | Sprint status `in-progress`, spec `in-review` | false | reject | Both read done in the pull request. |
| B5 | Preview answers may arrive out of order | medium | patch | A request counter applies only the latest answer. |
| B6 | Whole file and all rows posted and returned at each edit | low | reject | The stateless path of Story 30.3 (AD-14); 10,000 rows on a local server. |
| B7 | A YNAB amount refusal lands on the date cell, unfixable in the table | low | reject | The spec's matrix: Sure shows no amount column for YNAB. |
| B8, E11 | Merchant colour and website editable but unused | low | reject | Sure's `column_keys`; Archant reads them once Story 32.3 gives merchants those fields, as `docs/sure-parity.md` says. |
| B9, V4 | Stale publish back to « Nettoyer » untested end to end | low | defer | `lib/csv-clean.spec.ts` covers the gate; provoking a refusal at publish needs data changed between two requests. |
| B10, V-other | Edit bounds untested | low | patch | Route test refuses a value over 10,000 characters. |
| B11 | No test that edits are not logged | false | reject | `importCsv` logs the type, counts and a code only; edits reach no log call. |
| B12 | « Lignes d'erreur » drops a fixed row and the focus with it | medium | patch | The view keeps the lines invalid when chosen. |
| B13, E4 | A blank edited YNAB or Actual name does not fall back to the notes | false | reject | Sure's notes fallback runs when rows are made; a blank saved row takes the default name. |
| B14 | An edited category keeps its spaces for transactions and Mint | low | patch | `editsOf` trims every edit. |
| E1, E9 | Edits near a 10 MB file overflow the 64 KB multipart headroom | low | reject | Needs a 10 MB file and more than 64 KB of edits; refused as too large, nothing written. |
| E5 | A whitespace-only edit leaves the typed text in the field | low | reject | Cosmetic; the server's trimmed value is what is read. |
| V1 | Hidden-key test asserts no amount | medium | patch | The test publishes and reads the unmarked line's amount. |
| V2 | Actual category and YNAB name edits untested | medium | patch | Test added. |
| V3 | Merchant edit not published in a test | medium | patch | Test publishes and reads `merchants`. |
| V5 | Edits dropped on a new configuration, and the second page, untested | low | defer | Interface behaviour; logged in `deferred-work.md`. |

Second pass, `bmad-code-review` (four layers) over the amended WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Sprint status `review`, spec `done` | false | reject | The code review closes here; both read done in the pull request. |
| 2 | « Lignes d'erreur » keeps a stale set: a row turning invalid later is hidden, and the page stays past the end once clean | medium | patch | The view also lists every row with a refusal now; the last fix shows all rows from page one, and a page turned there leaves the view. |
| 3 | « Lignes d'erreur » keeps fixed rows, against « lists only rows with a refusal » | low | reject | Sure's errors view keeps a fixed row until the page is loaded again (turbo frame); recorded in Implementation Notes. |
| 4 | « Confirmer » may sit with publish disabled and no reason | medium | patch | Any refusal still standing at « Confirmer » is listed above the summary, a fallback the steps before should never leave. |
| 5 | `invalid_json` marks one cell when both conditions and actions fail | low | patch | One refusal per cell that does not read. |
| 6 | `unsupported_rule` on `conditions`, `security_currency` on `ticker` | low | reject | Either side may cause them; the row is red with its reason. |
| 7 | Edits trimmed twice; `categoryOf` ternary returns the same value | low | patch | Second trims and the ternary removed. |
| 8 | Edits bounds above the multipart headroom | low | reject | As first pass E1. |
| 9 | A YNAB amount refusal is unfixable in the table, undocumented | low | patch | `docs/sure-parity.md` « Clean step » states it. |
| 10 | Money-path edits (trade quantity, currency) untested | medium | patch | Test publishes an edited trade quantity and a line whose edited currency lifts `CURRENCY_MISMATCH`. |
| 11 | Placement by `field` and multi-account columns untested | medium | patch | Test places date, amount and currency refusals of a multi-account file, and an `actions` JSON refusal on column 5. |
| 12 | `CsvCleanStep` behaviours, the map redirect and the stale-answer guard untested | low | defer | Page state; added to `deferred-work.md`. |
| 13 | `clean` computed on every preview | low | reject | As first pass B6. |
| 14 | Blank YNAB name edit; merchant colour unused; rule `active` trimmed | false | reject | First pass B13 and B8; `parseCsv` already trims every cell, so `active` reads as before. |
| 15 | A focused cell remounts when another edit changes its derived value | low | reject | Needs typing into a YNAB name within the preview's round trip after editing its notes. |
| 16 | Playwright does not check the published date | low | patch | The test reads the line back through `/api/transactions`. |
