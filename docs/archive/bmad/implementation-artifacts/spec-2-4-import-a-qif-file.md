---
title: 'Story 2.4: Import a QIF file'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: 'aba1b0e772d5074079dde3c0226ff980265dd45e'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Some banks and older tools (Quicken, Microsoft Money) export only QIF, so Archant cannot read those files and the user types the lines by hand.

**Approach:** Add the `qif` file source behind the connector port (AD-3), written in the repository. Records go through the same preview, `fp:` fingerprint keys and confirm as a CSV line; the only new choice is the date order, offered in Aperçu when the file's dates read both ways. The QIF `N` number lands in a new `reference` column, as the architecture's `NormalizedTransaction` already plans.

## Boundaries & Constraints

**Always:**
- Reading, in `connectors/qif/qif.ts`: text from `decodeText`; CRLF and CR become LF; each line is trimmed, its first character is the field code. A record ends at `^`; a last record without `^` is kept; empty records are skipped. Headers match case-insensitively: `!Type:Bank` and `!Type:CCard` open a transaction section; list sections (`!Type:Cat`, `Class`, `Memorized`, `Security`, `Prices`) are skipped with their records; `!Option:` and `!Clear:` lines are ignored.
- Refusals, `400 INVALID_IMPORT_FILE`, nothing stored: no transaction section; any other transaction type, whose English message and interface text name it (`Invst`, `Cash`, `Oth A`, `Oth L`); more than one transaction section or more than one `!Account` block, since an import targets one account.
- Fields: `D` date; `T` amount, `U` only when `T` is absent; `P` label, falling back to `M` when `P` is empty; `M` in `notes` when it differs from the label; `N` in `reference`. Label and notes collapse spaces and cut at `LABEL_MAX_LENGTH` and `NOTES_MAX_LENGTH`; `reference` cuts at 50 code points, `null` when empty. `L`, `C`, `A` and split lines (`S`, `E`, `$`) are ignored: the record's total is imported. `externalId` is always `null`.
- Dates: separators `/`, `.`, `-` and `'`, spaces removed (`1/ 5'24`); a two-digit year is `20YY`, as in CSV; a leading four-digit year reads `YYYY-MM-DD` whatever the order; otherwise day then month, or month then day per `dateOrder`, through `providerDate`. Month names are not read.
- Amounts: spaces and no-break spaces stripped; the last `.` or `,` followed by one or two digits to the end is the decimal mark, any other separator must split groups of three digits; then `parseAmount` in the account currency. Sign as printed, negative leaves the account.
- Line rejections, `ref` being the 0-based transaction record index: no or unreadable `D` is `INVALID_DATE`, no or unreadable `T`/`U` is `INVALID_AMOUNT`, no `P` nor `M` is `MISSING_LABEL`. A record whose `P` is `Opening Balance` (case-insensitive) is rejected with a new `OPENING_BALANCE` code, « Solde d'ouverture, non importé » : it is Quicken's starting balance, not a movement.
- Date order: `ImportOptions` and `FileSourceOptions` gain `qif?: { dateOrder: "day-first" | "month-first" }`. Without a stored choice, the order that reads every dated record wins; when both or neither do, `day-first`. `ImportPreview` gains `qif: { dateOrder, ambiguous } | null`, `ambiguous` meaning both orders read every date. `POST /api/imports/:id/preview` accepts `qif` beside `moveOpeningDate`. The choice is not saved per account.
- Dialog: for QIF, Aperçu shows « Ordre des dates » with « Jour d'abord (31/01/2026) » and « Mois d'abord (01/31/2026) » only when `ambiguous`; a change re-previews. Every re-preview, including after `IMPORT_PREVIEW_STALE` and « Avancer la date d'ouverture », keeps the choice. File input accepts `.qif`; `imports.description` names QIF.
- Detection: `.qif` extension case-insensitive, or a first non-empty line starting with `!Type:`, `!Account` or `!Option:`.
- `FILE_SOURCE_IDS` gains `qif`. Migration 0008 rebuilds the `imports` and `entry_keys` source checks as 0007 did, and adds nullable `transactions.reference`. `NormalizedTransaction` gains `reference: string | null`: OFX, CSV and manual entry pass `null`; the ledger writes it; the transaction sheet's description shows « Import QIF du 12 sept., n° 1234567 » when set.
- The error envelope gains optional `params: Record<string, string>`, kept by the web's `ApiError`; the refused type travels as `params.type` and the dialog shows « Les relevés QIF de type Invst ne sont pas pris en charge. »
- Synthetic fixtures under `connectors/qif/fixtures/`, each file name saying what it imitates, since QIF has no comment syntax: a French bank export (`windows-1252`, `DD/MM/YYYY`, decimal comma, `N` cheque numbers), a card export (`!Type:CCard`, UTF-8 with BOM, decimal point), a Quicken-like file (`!Account` block, `Cat` list, `'` dates, `Opening Balance`, splits, `U` and `T` both present), an `Invst` file.

**Never:**
- No categories, tags, transfers or splits from `L`/`S`; no opening-anchor change from `Opening Balance`; no month-name dates; no multi-account import; no saved date order; no `reference` from OFX `CHECKNUM` (same column, separate change); no history or revert (2.5); no ledger change beyond writing `reference`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Bank file | `!Type:Bank`, `D12/03/2026`, `T-42,90`, `PCARTE MONOP`, `N1234567` | Line `2026-03-12`, `-42,90`, label `CARTE MONOP`, reference `1234567` | — |
| Ambiguous dates | Every date has a day ≤ 12 | Day-first, choice shown | — |
| Unambiguous | One date `03/29/2026` | Month-first, no choice | — |
| Re-import | Same file again | Every line under Déjà présentes | — |
| Twin records | Two identical records | Both created, both present on re-import | — |
| `U` and `T` | `U-28,500.00`, `T-28,500.00` | `-28 500,00` | — |
| Grouped comma | `T1.234,56` / `T1,234.56` | `1 234,56` both | — |
| Bad amount | `T12,5,0` | Rejected `INVALID_AMOUNT`, « Opération n° 4 du fichier » | — |
| Opening balance | `POpening Balance` | Rejected `OPENING_BALANCE` | — |
| Unsupported type | `!Type:Invst` | Nothing stored | `400 INVALID_IMPORT_FILE`, type named |
| Two accounts | Two `!Account` blocks | Nothing stored | `400 INVALID_IMPORT_FILE` |
| No section | `.qif` of plain text | Nothing stored | `400 INVALID_IMPORT_FILE` |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/statement.ts` -- `NormalizedTransaction` (L13) gains `reference`, its doc comment (L9) already says so; `RejectionCode` (L30) gains `OPENING_BALANCE`.
- `packages/api/src/connectors/file-source.ts` -- `FileSourceOptions` (L11) gains `qif`. `registry.ts` `SOURCES` (L11): a `Record<FileSourceId, …>`, so `qif` must be registered once the id exists.
- `packages/api/src/connectors/csv/csv.ts` -- patterns to copy, not to import: `dateOf` (L172) builds digits for `providerDate` (`domain/provider-date.ts:16`), `amountOf` (L201), label and notes cut (L314–329), `detect` (L371); 5,000-line test in `csv.spec.ts`.
- `packages/api/src/connectors/decode.ts` -- `decodeText` (L15), reuse as is. `packages/data/money.ts` `parseAmount` (L238).
- `packages/api/src/domain/keys.ts` -- `lineKeys` (L32), unchanged: `fp:` only when `externalId` is `null`.
- `packages/api/src/lib/errors.ts` -- `AppError` (L26), `ErrorBody` (L20) gain `params`; `app.onError` serialises through `toJSON`.
- `packages/data/schema/imports.ts` -- `FILE_SOURCE_IDS` (L19, comment « QIF joins with its story »), `ImportOptions` (L45). `schema/entry-keys.ts` (L33) check. `schema/transactions.ts` gains `reference`. Last migration `drizzle/0007_add_csv_imports.sql` shows the check rebuild; `migrate.spec.ts` (L189, L200) asserts `qif` is refused today: flip them.
- `packages/api/src/services/ledger.ts` -- transactions insert (L796) writes `reference`; `TransactionRecord` (L1075) and `transactionColumns` (L1090) gain it; `filledFields` (L358) unchanged, `reference` is not lockable.
- `packages/api/src/services/imports.ts` -- `ImportPreview` (L59) gains `qif`; `statementOf` (L105), `createImport` (L230, non-CSV branch), `previewImport` (L296) mirror the `csv` handling; the date-order detection is an exported helper of `qif.ts`, as `csvLayout` is for CSV. `schemas/imports.ts` `importPreviewSchema` (L71) gains `qif`.
- `packages/api/src/services/transactions.ts` -- source (L71) already generic: « Import QIF du … » needs no change.
- `packages/web/src/lib/api.ts` -- envelope schema (L20) and `ApiError` (L29) keep `params`.
- `packages/web/src/components/ImportDialog.tsx` -- re-preview body (L354), `moveOpening` (L409), refusal text (L402, L533), file input `accept` (L521), Aperçu (L564). `TransactionSheet.tsx` description (L377). `locales/fr.json`: `imports.description` (L279), `imports.reasons` (L313), `errors` (L395).
- `packages/web/e2e/import-csv.spec.ts` -- model for `import-qif.spec.ts`: a file built in the test with `daysAgo`, `openImport`, `choose` by « Relevé bancaire ».
- `packages/api/vitest.config.ts` (L16) holds `connectors/**` at 100%; `.oxlintrc.json` connector override already covers `qif/`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/connectors/qif/qif.spec.ts`, `fixtures/` -- tests first: every matrix parser row, each fixture, headers and list sections, missing final `^`, each date shape and both orders, detection of the order, both decimal marks, `U`/`T`, splits ignored, 5,000 records under 2 s.
- [x] `packages/api/src/connectors/qif/qif.ts`, `file-source.ts`, `registry.ts`, `domain/statement.ts` -- `qifSource`, date-order helper, `reference`, `OPENING_BALANCE`.
- [x] `packages/data/schema/imports.ts`, `transactions.ts`, `drizzle/0008_*`, `migrate.spec.ts` -- `qif` id, `reference` column, migration.
- [x] `packages/api/src/lib/errors.ts`, `services/ledger.ts`, `services/imports.ts`, `schemas/imports.ts`, `connectors/ofx/ofx.ts`, `connectors/csv/csv.ts`, `app.spec.ts` -- `params`; `reference` written and read, `null` from OFX, CSV and manual; upload, ambiguous and unambiguous files, preview with `qif`, confirm, re-import all present, refusals with `params.type`.
- [x] `packages/web/src/lib/api.ts`, `components/ImportDialog.tsx`, `TransactionSheet.tsx`, `locales/fr.json` -- `params`, date-order select, `.qif`, texts, reference in the description.
- [x] `packages/web/e2e/import-qif.spec.ts` -- one test per acceptance criterion below.

**Acceptance Criteria:**
- Given an account, when I upload a QIF bank file, then Aperçu lists its records, and confirm writes them and moves the balance.
- Given a QIF file whose dates all read both ways, when Aperçu opens, then « Jour d'abord » is selected, and choosing « Mois d'abord » changes the dates shown.
- Given the same QIF file imported again, when Aperçu opens, then every line is under Déjà présentes and confirm is disabled.
- Given a `!Type:Invst` file, when I upload it, then the dialog shows « Les relevés QIF de type Invst ne sont pas pris en charge. » and nothing is stored.
- Given an imported record with `N`, when I open its sheet, then the description shows its number.
- Given the verification gate of `AGENTS.md` and `pnpm test:e2e`, when they run, then every command passes and no tracked file changes.

## Implementation Notes

- `ambiguous` also requires one date to read differently in the two orders: a file of `05/05/2026` or `2026-03-04` dates would otherwise offer a choice that changes nothing. Dates neither order reads are left out of the decision (review finding #4).
- An empty `T` counts as absent, so `U` is read in its place.
- A `!` header the parser does not know opens a skipped section; only an unknown `!Type:` is refused.
- The refusal text lives in `imports.qif.unsupportedType`, not under `errors`: every key of `errors` is typed as an API error code in the interface.
- `ChoiceField` moved out of `CsvColumns.tsx` into its own file, reused by Aperçu's date-order select, which is disabled while a re-preview runs.
- `AGENTS.md` API contract now names `fields` and `params`; AD-15 of the architecture spine still shows `{ code, message, fields? }`.
- QA on a throwaway database, Chromium 1280 px: an `Invst` file shows « Les relevés QIF de type Invst ne sont pas pris en charge. »; the La Banque Postale-like fixture lists 6 lines under À créer with accents intact and day-first detected without a choice, confirm moves the balance from 1 000,00 € to 2 866,48 € (the 28 September line is future-dated), and the cheque's sheet reads « Import QIF du 22 sept. 2026, n° 1234567 »; a two-line file dated `09/08/2026` and `08/09/2026` shows « Ordre des dates », and « Mois d'abord » swaps the two dates.

## Spec Change Log

## Review Triage Log

| # | Source | Location | Finding | Verdict | Evidence | Route |
|---|--------|----------|---------|---------|----------|-------|
| 1 | blind, edge | `qif.ts` `recordsOf` | Empty or huge `!Type:` echoed in message and `params.type` | low | `!Type:` alone gives « type  »; length bounded only by 5 MB. Direct fix. | patch |
| 2 | edge | `qif.ts` `LIST_TYPES` | `!Type:Tag`, `Invitem`, `Template` refuse the whole file | medium | Sure parses `!Type:Tag`; any unknown `!Type:` throws. | patch |
| 3 | blind, edge | `qif.ts` accounts counter | Quicken export with its AutoSwitch account list refused as two accounts | medium | Counter counts `!Account` headers, the list adds one. | patch |
| 4 | edge | `qif.ts` `orderOf` | One unreadable date hides the order choice for an otherwise ambiguous file | low | Both flags go false; `ambiguous` needs both true. Ignoring dates neither order reads is a direct fix. | patch |
| 5 | blind | `ImportDialog.tsx` select | Select active during re-preview, shown and stored order can differ | low | `ChoiceField` gets no disabled state; CSV serialises its previews for the same reason. | patch |
| 6 | verification | `import-ofx.spec.ts` sheet text | Substring match lets « n° » without reference pass | medium | Pre-verified by the layer. | patch |
| 7 | verification | `ImportDialog.tsx` `accept` | Nothing checks `.qif` is accepted | medium | Pre-verified: `setInputFiles` ignores `accept`. | patch |
| 8 | blind, edge | `qif.ts` `dateOf` | `/` two-digit year means 19YY in Quicken, read 20YY | low | Frozen block sets 20YY; such lines land in Rejetées as `DATE_TOO_LATE`, not silently wrong. Rejected. | |
| 9 | edge | `qif.ts` `dateOf` | `' 4` one-digit padded year refused | maybe-false | Would need a Quicken export dated 2000–2009; only low if true. Rejected. | |
| 10 | edge | `qif.ts` `orderOf` | Mixed-order file falls back to day-first silently | low | Frozen block decides it; the other records show as `INVALID_DATE`. Rejected. | |
| 11 | blind, edge | `qif.ts` `amountOf` | Three-decimal currencies misread `12.345` | low | Frozen block fixes one or two decimals; household accounts are EUR. Rejected. | |
| 12 | blind, edge | `qif.ts` opening balance | French « Solde d'ouverture » not recognised | maybe-false | Would be medium: the line would be created and shift the balance. A French Quicken or Money export would settle it. | defer |
| 13 | blind | `keys.ts` | `N` not used as a key | low | Frozen block keeps `externalId` null; needs reordered twin cheques. Rejected. | |
| 14 | blind, edge | `ledger.ts` `ingest` | `reference` not written on matched lines | low | Frozen block limits the ledger to writing it on insert; adding an update branch. Rejected. | |
| 15 | blind | `ofx.ts` | `CHECKNUM` ignored | false | The intent excludes it explicitly. | |
| 16 | blind | `qif.ts` `toLine` | `N` holding `ATM`, `DEP` shows « n° ATM » | low | Cosmetic; a filter list adds surface. Rejected. | |
| 17 | blind | `ledger.ts` search | `reference` not searchable | false | Not asked by the intent. | |
| 18 | blind | `services/imports.ts` `qifPreview` | File parsed twice per preview | low | A few ms on 5 MB; the fix changes the port. Rejected. | |
| 19 | blind | `qif.ts` | Empty transaction section gives an empty import | false | Same as an OFX file with no line; confirm is disabled with nothing new. | |
| 20 | edge | `ImportOptions.qif` | Re-importing an ambiguous file confirmed month-first reads it day-first | low | Needs every day ≤ 12, and the select shows again; saving the order per account is excluded by the intent. Rejected. | |
| 21 | verification | `ImportDialog.tsx` `kept` | Redundant with the server's stored choice | low | Harmless and explicit. Rejected. | |

## Design Notes

The parser is written in the repository, as the architecture decided: no maintained QIF library exists and the format is a line per field. It follows Sure's `qif_parser.rb` for `T` before `U`, `P` as label and `M` as notes, apostrophe years and skipped list sections, and departs from it where Sure loses data silently: Sure drops unreadable records without a word, reads `12,50` as 1 250, keeps a BOM that hides the first header, imports only the first of several sections, and never deduplicates. Here unreadable records are rejected with a reason, the decimal mark is inferred per amount, `decodeText` strips the BOM, a multi-account file is refused, and fingerprints make a re-import create nothing.

The date order is detected rather than always asked, because a monthly statement almost always holds a day above 12, which settles it; the choice appears only when it cannot be settled.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- all pass, `git status` clean afterwards.
- `pnpm test:e2e` -- `import-qif.spec.ts` and the existing suite pass.

**Manual checks:**
- Import each fixture on a throwaway database, 1280 px: accents readable, balances match the fixtures' sums, the Quicken-like file shows one `OPENING_BALANCE` rejection.
