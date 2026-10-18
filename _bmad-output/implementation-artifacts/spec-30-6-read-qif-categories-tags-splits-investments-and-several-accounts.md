---
title: "Story 30.6: Read QIF categories, tags, splits, investments and several accounts"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: 'c78fc78dfa2e03b1f8510bfcf38b7f32e63dfa08'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-30-5-fix-rows-before-publishing-and-sures-confirm-step.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) imports a Quicken file whole through `QifImport` and `QifParser`: every `Bank`, `CCard`, `Cash`, `Oth A`, `Oth L` and `Invst` section, each `!Account` of the file, the `L` field's category and `/tags`, split lines (`S`, `$`, `E`), and investment records (`Buy`, `Sell`, `Div`, `IntInc`…), through « Téléverser », « Sélectionner » (`qif_category_selections/show`: date format, categories and tags to keep), « Nettoyer », « Mapper », « Confirmer ». Archant reads a QIF file only in an account's « Importer » dialog: `Bank` and `CCard` records of one account, no category, tag, split or investment.

**Approach:** Add a `qif` kind to Story 30.3's stateless path (`POST /api/csv-imports(/preview)`, « Réglages › Importations »): a new reader ports `QifParser`, its records become Sure's rows (`generate_transaction_rows`, `generate_investment_rows`) as a table the existing sheet, « Nettoyer », mappings and counts read, and publishing writes lines through `ingest` under a `qif` import (splits as AD-20 children), trades through `insertCsvTrades`.

## Boundaries & Constraints

**Always:**
- Upload: « Compte » optional; a file with no `!Account` and no account chosen is refused (`QIF_ACCOUNT_REQUIRED`, Sure's `qif_account_required`); a file without `!Type:` is `QIF_INVALID`. Rows with a blank account go to the chosen account, as `account_for_row`.
- « Configurer et sélectionner »: Sure's date formats that read the first date between 1970 and five years ahead, the detected one preselected (`detect_date_format`, fallback `%m/%d/%Y`), « Première date analysée »; each category and tag of the rows and split lines with its row count, all checked; a split category marked « scindée »; « Transactions scindées détectées » when the file has one; « Continuer vers la revue ». An unchecked category or tag is cleared from rows and split lines, as `QifCategorySelectionsController#update`.
- Rows: Sure's fields and order, transaction rows then investment rows; dates read with the chosen format (QIF apostrophe, spaces and two-digit years normalised as `normalize_qif_date`); « Nettoyer » columns are Sure's QIF `column_keys`. Opening Balance records are not rows.
- Amounts are integer minor units, read with Archant's QIF reading (`12,50` is 12.50). Investment cash rows are signed by action (`INFLOW_TRANSACTION_ACTIONS` positive), trades by side: quantity negative for `Sell`/`ShtSell`, the `T` total as the trade's amount, its difference to `quantity × price` the fee.
- Splits: lines summing exactly to the row's amount become children with their own categories, tags (else the row's) and memo, the parent excluded and locked (AD-20); otherwise one line at the total.
- « Mapper »: categories, tags, and the file's accounts when it names some; an account preselected by name among manual accounts, else « Ajouter comme nouveau compte », created with Sure's type (`CCard` card, `Invst` investment, `Oth A`, `Oth L`, else depository) and its Opening Balance record as opening, else zero the day before its first line. A trade on an account that takes none is refused on its row.
- Lines go through `ingest` per account under an import `source: "qif"`, deduplicated, revertible, the anchor moved as Sure's `adjust_opening_anchor_if_needed!`.

**Never:** no stored upload or row (AD-14); no migration; no new dependency; no change to the account dialog's QIF reading or the assistant's `import_statement_file`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Categories and tags | `LAlimentation/Vacances:Été` | category `Alimentation`, tags `Vacances`, `Été` | none |
| Transfer category | `L[Livret A]` | no category | none |
| Split sums | T-100, splits -60 Courses, -40 Essence | parent excluded, two children | none |
| Split mismatch | T-100, splits -60, -30 | one line at -100 | none |
| Investment | `NBuy`, `YApple`, `Q10`, `I15`, `T155` | buy of 10 AAPL, amount -155, fee 5 | none |
| Dividend | `NDiv`, `T12,50` | transaction +12.50 on the investment account | none |
| Two accounts | `!Account` Courant then Carte | each maps to its account, its lines there | none |
| Unchecked category | `Loisirs` unchecked | its rows import uncategorised | none |
| No account | single section, no account chosen | refused at upload | `QIF_ACCOUNT_REQUIRED` |

</frozen-after-approval>

## Code Map

- New `packages/api/src/services/qif-reader.ts` -- Sure's `QifParser`: sections, accounts, records, splits, securities, opening balances, date samples, `normalizeQifDate`; amount via a decimal-text variant of `amountOf` in `connectors/qif/qif.ts`.
- New `packages/api/src/services/qif-import.ts` -- QIF sheet (table of Sure's rows plus per-line metadata), `qif` preview block, `analyseQif` (accounts, rows, splits, trades, counts, write).
- `packages/api/src/services/csv-import-transactions.ts` -- export `readRows`, `createCategory`, category and tag mapping helpers for reuse; behaviour unchanged.
- `packages/api/src/services/csv-import.ts` -- `readTable`/`analyse`/`previewCsvImport` route `qif`; statistics refresh after a QIF import.
- `packages/api/src/services/ledger/csv-transactions.ts` -- `ingestCsvStatements` takes the import source.
- `packages/api/src/services/ledger/ingest.ts`, `domain/statement.ts` -- `splitLines` on a created line: children inserted, parent excluded and locked.
- `packages/api/src/services/ledger/csv-trades.ts` -- `CsvTrade.fee`.
- `packages/api/src/schemas/csv-imports.ts` -- `qif` type, `qifCategories`/`qifTags` selection, QIF clean columns, `trades_not_supported` issue; `csv-import-format.ts` `detectDateFormat` fallback.
- `packages/api/src/lib/errors.ts` -- `QIF_INVALID`, `QIF_ACCOUNT_REQUIRED`.
- App: `routes/_authed.settings.imports.tsx` (source « Importer depuis Quicken (QIF) » after Actual, Sure's order), `routes/_authed.settings.imports_.$kind.tsx` (QIF upload, new `components/QifSelectStep.tsx`, map steps), `locales/fr.json`.
- Tests: `services/qif-reader.spec.ts`, `services/qif-import.spec.ts`, `ledger/ingest.spec.ts` (split lines); e2e `packages/app/e2e/qif-settings-import.spec.ts`.
- Docs: `docs/sure-parity.md` « QIF », « Formats », « Preview »; `docs/deployment.md` imports section; `docs/architecture.md` AD-4 / AD-20 sentence.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first: reader (sections, accounts, `L` parsing, splits, investment, dates), then import fixtures with categories, tags, splits, investment records and two accounts, every amount in minor units.
- [x] Reader, schema, sheet and analysis, ledger splits and fees.
- [x] Interface: source entry, upload, « Configurer et sélectionner », map steps, locale strings.
- [x] Playwright: upload a QIF file, uncheck a category, publish, read the lines back.
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given a QIF file with categories and tags, when uploaded, then « Configurer et sélectionner » lists them with their counts and the detected date format, and « Continuer vers la revue » reaches « Nettoyer ».
- Given the fixtures, when published, then lines, children, trades and accounts match Sure's import, amounts exact.

## Implementation Notes

Decisions taken alone during implementation, the owner unavailable, each settled by Sure or by Archant's model:

- Implemented in this session rather than by a dispatched agent, the investigation being already loaded, as Story 30.5 was.
- QIF is a tenth type of the stateless `/api/csv-imports` path: `readQifSheet` turns the file into Sure's rows as a `CsvTable` whose headers are Sure's row fields, so `cellOf`, edits, « Nettoyer », the category and tag mappings and `readRows` serve it unchanged. What the rows do not show (the row kind, the account's QIF type, the split groups) rides beside them by line.
- The category and tag mappings and their writes moved out of `analyseTransactions` into `classificationsOf`, shared by both imports; the CSV behaviour is unchanged and its tests pass as before.
- A row's date is ISO once read, as Sure's `%Y-%m-%d` row format; the QIF format travels as the preview's `configuration.dateFormat`, the selection as `qifCategories` and `qifTags`.
- `ingest` writes a line's `splitLines` as children after the parents, the parent excluded and its `excluded` locked as AD-20 asks; the children lock as the import's origin does, so nothing, as any imported line. Rules skip the parent.
- A trade's fee is what the `T` total adds to `quantity × price` (`conversionFee`), its amount then the total exactly.
- `I` and `Q` read commas as Sure strips them, but a lone comma that splits no group of three digits is a French decimal mark.
- A new account's « Opening Balance » goes through `toStoredBalance`: Quicken writes a card's debt below zero.
- A cash action without a total (`ShrsIn`, `StkSplit`…) is a line at zero, as Sure's `"".to_d`.
- The account dialog's QIF reader keeps its own parser: it reads one bank statement into the grouped preview and the assistant's `import_statement_file`, and its tests stay as they were.
- Labels of investment cash lines and trade names are Sure's English ones in French: « Dividende : X », « Intérêts : X », « Virement entrant », « Achat de 10 actions AAPL ».

## Spec Change Log

## Review Triage Log

First pass, the three `bmad-build` review layers (Blind B, Edge E, Verification V).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| B1, E1, E2 | Rows of a section before any `!Account`, no account chosen: the blank key's mapping ignored, lines dropped | medium | patch | `targetOf` follows the blank key's mapping when no account is chosen; test maps it to an existing account. |
| B2, E8 | A file opening on a bank section hides its trades' columns, so a refused trade cannot be fixed | medium | patch | `QifShape.trades` adds ticker, qty and price after Sure's bank columns; test. |
| B3 | A new card's negative « Opening Balance » stored as an asset's sign | medium | patch | `toStoredBalance`; test opens a card owing 500. |
| B4 | An unreadable opening record leaves the new account at zero silently | low | reject | Rare, and the record is no row Sure lets the user edit either. |
| B5 | Docs say the total is the trade's amount when the fee falls back to zero | low | patch | `docs/deployment.md` names the fallback. |
| B6 | Cash actions without a total (`ShrsIn`…) block the file on a required amount | medium | patch | Written at zero, as Sure's `"".to_d`; test. |
| B7, E5 | A split edited in « Nettoyer » lands whole, uncategorised | low | reject | Sure's `import_split_lines!` compares with the entry's amount the same way; the frozen intent says « otherwise one line at the total ». |
| B8 | Revert leaves trades and created accounts; docs silent | low | patch | `docs/deployment.md` says they stay, as « Importer les investissements »'s. |
| B9, V2 | No test for revert with children, the anchor move, split tag inheritance and the label fallback | medium | patch | Tests added in `qif-import.spec.ts`. |
| B10 | Upload offers linked accounts | false | reject | Same as « Importer les opérations », Sure's `accessible_accounts.visible` at upload. |
| B11 | « 0 opération » and the « Transactions » header | false | reject | Sure's own `txn_count` and `transactions_col` words. |
| B12 | A zero-quantity trade skipped silently | low | reject | As `trades.csv` imports, Story 30.3. |
| B13, E9 | The first date unreadable leaves no format offered | medium | patch | The sample is the first date some format reads. |
| E3 | `Q1,000` read as one share | high | patch | A comma splitting a group of three is a thousands separator; reader test and a trade of 1000. |
| E4, V-other | Split lines' tags never checked against the limit | medium | patch | `checkTags` on each split line; test. |
| E6 | Imported split children carry no lock | false | reject | Imported lines lock nothing (AD-10); AD-20 locks the parent's exclusion, which the code does. |
| E7 | An `Invst` section under a `Port` account refuses every trade | medium | patch | An account with investment rows is an investment one; test. |
| E10 | An edited account cell with spaces skips the currency check | false | reject | `editsOf` trims every edit and the file's names are trimmed. |
| E11 | Existing accounts ignore the file's « Opening Balance » | low | defer | Design Notes record it; logged in `deferred-work.md`. |
| E12 | Grouped `I`/`Q` differ from Sure | high | patch | Same root cause as E3. |
| V1 | No QIF test that a linked account is never offered | medium | patch | Test added. |

Second pass, `bmad-code-review` (Blind B, Edge E, Verification V, Acceptance A).

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| B1, E9 | `I`/`Q` written `1.234,5678` read as 1.2345678 | medium | patch | A dot before the last comma makes that comma the decimal mark; reader test. `12,345` stays twelve thousand, as Sure strips commas. |
| B2, V1 | A total below quantity × price, or none, silently leaves the fee at zero, untested | medium | patch | Documented decision; test of both cases. A refusal would block every rounded Quicken price. |
| B3 | `RtrnCap`, `BuyX`, `ReinvInt`… become outflows; a `ShrsIn` with a total a spending | low | reject | Sure's `import_investment_rows!` signs every non-inflow action so and makes trades only of its five actions. |
| B4 | `ReinvDiv` buys without a dividend line | low | reject | Sure's `BUY_LIKE_ACTIONS` does the same. |
| B5 | A security without `!Type:Security` takes its name as ticker | low | reject | Sure's `ticker_by_name[security_name] \|\| security_name`. |
| B6 | Trades not deduplicated on a second import | low | patch | As « Importer les investissements »; `docs/deployment.md` says so. |
| B7, E6, E7 | A split left whole without notice (duplicate, sum, over 50 lines) | low | reject | Sure's sum check; the intent says « otherwise one line at the total ». |
| B8 | No rule runs on split children | medium | patch | AD-20 counts the children in rules: `ingest` plans them beside the other lines; test. |
| B9, A3 | An unchecked category changes a split line's label; unchecked tags fall back to the line's | low | patch | Label from the category as written, tags from the file's own; `KeptSplit`; test. |
| B10 | AutoSwitch section without its own `!Account` goes to the list's first account | low | reject | Sure's `transaction_sections` does the same. |
| B11 | Two-digit years past this year read last century | low | reject | Sure's `normalize_qif_date`. |
| B12 | `readTrades` duplicates the CSV trade reader | low | reject | Fees, sides and the account rule differ; no shared defect named. |
| B13 | `isQifImport` and `ReadRow` exported unused | low | patch | Removed. |
| B14 | « Transactions » beside « opérations » | false | reject | Sure's `transactions_col` and `txn_count`. |
| B15 | `qifCategories` bounds large | low | reject | Same bounds as the edits, parsed by Zod, never logged. |
| B16 | Missing tests listed | medium | patch | Fee zero, other assets and liabilities, unchecked split category added. |
| E1, A2 | Existing or chosen accounts ignore the file's « Opening Balance » | low | defer | carried: logged in `deferred-work.md` at the first pass. |
| E2, E3, E5 | Lines or trades before a new or existing account's opening | false | reject | A line before the opening goes in from every source (AD-4), as Sure's balances start at the oldest entry. |
| E4 | Imported split children locked as sync | false | reject | carried: AD-10, imported lines lock nothing. |
| E8 | An edited account cell with spaces | false | reject | carried: `editsOf` trims. |
| E10 | The detected format absent from the offered ones | low | patch | The guess falls back to the first offered format. |
| E11 | First date outside the range disables submit | low | reject | Needs a first date before 1970 or five years ahead with later valid ones. |
| V2 | `Oth A` and `Oth L` untested | medium | patch | Test creates both, signs the liability's opening. |
| A1 | An account the file names without lines is never created | medium | patch | Every `!Account` name is a key to map, created as Sure's `apply_opening_balances_or_adjust_anchors!`; test. |
| A4 | « Opening Balance » in an investment section dropped where Sure keeps it | low | patch | Only non-investment sections drop it. |

## Design Notes

Assumptions taken alone, the owner unavailable, settled by Sure or by Archant's model:

- QIF joins « Réglages › Importations » as Sure's `QifImport`; the account dialog keeps reading a single bank statement QIF, as it reads OFX, so the assistant's `import_statement_file` keeps working.
- Dividends, interest and other cash actions become transactions on the investment account, as Sure's `import_investment_rows!`; the story's wording « trade » for them yields to Sure's code. Their labels are Sure's in French (« Dividende : X »…).
- « Attribuez vos comptes » is shown for a file naming accounts, the story asking each account mapped; its preselection is Sure's `find_or_create_qif_account`.
- A date or amount the chosen format cannot read stays on its row, red in « Nettoyer », where Sure drops the record silently.
- A trade whose `T` is below `quantity × price` (a rounded price) takes fee zero and `quantity × price`, Archant's fee being never negative.
- An existing account's anchor amount is not set from the file's Opening Balance; only a new account takes it.
- Category counts are rows only, as Sure's `@category_counts`.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
