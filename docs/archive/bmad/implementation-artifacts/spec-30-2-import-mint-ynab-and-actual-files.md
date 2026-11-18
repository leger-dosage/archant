---
title: "Story 30.2: Import Mint, YNAB and Actual files"
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_commit: '8a112936c409eb305289adc67549ab26afed6fb3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-30-4-map-currency-category-tags-account-and-a-type-column-sures-date-formats.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) imports a Mint, YNAB or Actual Budget export with its columns already mapped: `MintImport`, `YnabImport` and `ActualImport` are `Import`s whose `DEFAULT_COLUMN_MAPPINGS` fill the form, each with its own reading of the amount, the name and the category, then Sure's category, tag and account mapping steps. Archant offers none of the three; a user leaving one of these tools maps every column by hand through « Importer les opérations ».

**Approach:** « Importer depuis Mint », « Importer depuis Actual » and « Importer depuis YNAB » join « Importer depuis Sure » under « Sources », in Sure's « Outils financiers et fichiers » order. Each is a kind of Story 30.4's stateless `/api/csv-imports` path and `/settings/imports/$kind` page (`mint`, `ynab`, `actual`), always multi-account as Sure's: « Téléverser », « Configurer » preset from Sure's `DEFAULT_COLUMN_MAPPINGS` under Sure's notice, « Mapper » with Sure's `mapping_steps`, « Confirmer ». Publishing is 30.4's: mapped categories, tags and accounts created, each account's lines through `ingest()` under an `imports` row of its own.

## Boundaries & Constraints

**Always:**
- Presets, applied when the file has the header (folded as Sure's `header_for`), else « Laisser vide »: Mint `Date` `%m/%d/%Y`, `Description` name, `Amount`, `Currency`, `Account Name`, `Category`, `Labels` tags, `Notes`; YNAB `Date` `%m/%d/%Y`, `Payee` name, `Account`, `Category`, `Memo` notes; Actual `Date` `%Y-%m-%d`, `Payee` name, `Amount`, `Account`, `Category`, `Notes`. Incomes positive for all three. The date format is the preset, not a guess; « Format de date » offers Sure's 11 `Family::DATE_FORMATS`, without `DD/MM/YY`.
- Forms in Sure's order: Mint date + format, amount + « Convention de signe », currency + « Format numérique », account, name, category, tags; YNAB date + format, Sure's amount notice, account, name, category, notes; Actual date + format, amount + « Convention de signe », account, name, category, notes. Date and amount required (YNAB date only).
- Amounts: Mint, Sure's `signed_csv_amount`, the amount as written when `Transaction Type` reads exactly `credit`, negated otherwise; YNAB, a non-blank `Amount` cell, else `Inflow` minus the absolute `Outflow` (a blank side is zero), `required` when the file has none of the three columns; Actual, the amount as written. Each then signed by the signage convention, in Archant's sign (AD-5). Every decimal through `sanitizeNumber` then `parseDecimalAmount` in the line's currency.
- Names: YNAB and Actual fall back to the notes, then to « Opération importée »; Mint to « Opération importée ».
- Categories: YNAB `combined_category` (`Category Group/Category`, else `Category Group` + the category column, else `Master Category` + `Sub Category`, else the category column); Actual `Category_Group` + the category column; joined as `Group: Category`, which 30.4's `Parent:Child` mapping files under its parent.
- Currency: Mint's currency column as 30.4; YNAB and Actual write in the line's account currency.
- Mapping steps: Mint categories, tags, accounts; YNAB and Actual categories, accounts.

**Never:** no account chosen at upload; no change to « Importer les opérations »; no « Nettoyer » step (Story 30.5); no migration; no new dependency; no tool logo shipped.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Mint debit | `01/15/2026,…,8.55,debit` | -855 | none |
| Mint credit | `2000,credit` | +200000 | none |
| YNAB flows | `Outflow $4.25`, `Inflow $0.00` | -425 | none |
| YNAB signed | `Amount -12.00` beside flows | -1200 | none |
| YNAB no amount column | no `Amount`, `Inflow`, `Outflow` | not written | `required` amount per line |
| YNAB category | `Category Group` `Dining Out`, `Category` `Coffee` | key `Dining Out: Coffee`, child under parent | none |
| Actual | `2026-01-03,Coffee Shop,,Food,Coffee,-4.25` | -425, `Food: Coffee` | none |
| Blank payee | YNAB `Payee` blank, `Memo` `Starting Balance` | label `Starting Balance` | none |

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/csv-imports.ts` -- `mint`, `ynab`, `actual` in `CSV_IMPORT_TYPES`, `TOOL_IMPORT_TYPES` and `isToolImport`; their `COLUMN_KEYS`; `dateFormatsOf` already leaves `DD/MM/YY` to transactions and accounts.
- New `packages/api/src/services/csv-import-tools.ts` -- Sure's `DEFAULT_COLUMN_MAPPINGS` per tool, the Mint and YNAB amount terms, YNAB's `combined_category`, Actual's category, the name fallback.
- `packages/api/src/services/csv-import.ts` `resolveConfiguration` -- tool presets (columns, date format, multi-account, `signed_amount`, YNAB incomes positive); `analysisOf` routes the tools to `analyseTransactions`.
- `packages/api/src/services/csv-import-transactions.ts` -- amount, name and category read through the tool, the category mapping keyed on that category.
- App: `routes/_authed.settings.imports.tsx` (three sources under « Sources »), `routes/_authed.settings.imports_.$kind.tsx` (no account at upload, templates, preset notice and tool forms, mapping steps), `locales/fr.json`.
- Tests: new `services/csv-import-tools.spec.ts` (each tool's fixture published: dates, integer amounts and signs, categories, accounts); `routes/csv-imports.spec.ts` accepts a tool type; e2e `packages/app/e2e/csv-import.spec.ts` lists the sources and imports a YNAB file.
- Docs: `docs/sure-parity.md` « File import » « Formats » row; `docs/deployment.md` « Importing CSV files ».

## Tasks & Acceptance

**Execution:**
- [x] Vitest first: presets resolved from the headers, each tool's sign, YNAB's amount sources and missing-amount refusal, combined categories, name fallback, publish of each fixture into mapped and new accounts with categories under their parents.
- [x] Schemas, presets, readers, configuration.
- [x] Interface: sources, upload without account, notice and forms, mapping steps, locale strings.
- [x] Playwright: list the sources, import a YNAB file into a new account and category, find the transaction.
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given « Réglages › Importations », then « Importer depuis Mint », « Importer depuis Actual » and « Importer depuis YNAB » follow « Importer depuis Sure » under « Sources ».
- Given a Mint, YNAB or Actual export, then « Configurer » shows its columns already chosen with Sure's notice, and publishing writes each line once in its mapped account with its date, integer amount, sign and category.

## Design Notes

Assumptions taken alone, owner unavailable, settled by Sure or Archant's model:

- Sure's sources are « Outils financiers et fichiers » and « Données brutes »; Archant's first group, « Sources », holds the Sure archive, so the three tools join it in Sure's order (Sure, Mint, Actual, YNAB; QIF stays in each account's « Importer »).
- « Importer depuis Actual »: Sure's French « Importer à partir du budget réel » translates the product's name; Archant names it, as the epic says. The notice reads « Nous avons préconfiguré votre importation Actual pour vous. Veuillez passer à l'étape suivante. » for the same reason.
- Sure shows Mint's and YNAB's logos as images; Archant ships no third-party logo and gives each a Lucide icon, Actual's `wallet` as Sure's.
- « Format numérique » is offered on all three forms where Sure offers it on Mint's only: Sure reads YNAB's and Actual's amounts in `1,234.56`, so a euro export written `4,25` would land a hundred times too large. Money as integers, read right, settles it; the default stays Sure's `1,234.56`.
- Labels: « Bénéficiaire (facultatif) » for the payee as Sure; « Notes (facultatif) » and « Étiquettes (facultatif) » where Sure reads « Remarques », « Mémo » and « Balises », Archant's words; « Convention de signe » where Sure's Actual form reads « Convention de signalétique », a mistranslation, as 30.3's trade form.
- A YNAB `Inflow` or `Outflow` cell that reads as no number is `invalid_number` on its line, where Sure counts it zero: a line written at a wrong amount is worse than a refusal.
- Mint's amount goes through `sanitizeNumber` with the form's « Format numérique », where Sure's `to_d` reads `1,234.56` as 1: the form offers the format, so the amount honours it.
- Sure's tool imports write every row, no deduplication; Archant's lines go through `ingest()` as any import (AD-4, AD-7), and a line found again takes the row's category, tags and notes, as 30.4.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

## Implementation Notes

Decisions taken alone during implementation, the owner unavailable, each settled by Sure or by Archant's model:

- Implemented in this session rather than by a dispatched agent, the investigation being already loaded, as Story 30.4.
- The tools' readers live in a new `services/csv-import-tools.ts` (`TOOL_PRESETS`, `amountTermsOf`, `rawLabelOf`, `categoryOf`); `analyseTransactions` reads every kind through them, so the tools publish exactly as « Importer les opérations ». A row's amount is a list of terms summed in minor units (`sumOf`), YNAB's outflow counted by its size.
- A tool's configuration ignores `accountId`, `rowsToSkip` and the type-column strategy a client may send, and YNAB's signage, since their forms offer none: Sure's tools have no such field.
- Mint's form shows no notes column, as Sure's; its `Notes` preset is still read, as Sure's `DEFAULT_COLUMN_MAPPINGS`.
- The Mint sample file writes its debit unsigned, as Mint exports do: Sure's sample writes `-8.55` with `debit`, which its own `signed_csv_amount` reads as income.
- Labels per tool: `csvImport.configure.mint`, `.ynab`, `.actual` in `fr.json`, each holding only the keys its form reads.

## Review Triage Log

First pass, the three `bmad-build` review layers over the WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| B1, E3 | YNAB file with an `Amount` header, blank cells everywhere, lands at zero; the comment says no line does | low | patch | Sure's `amount_source_columns?` does the same (a row of blank flows is zero in YNAB); the comment now says the guard is for a file that is no YNAB register. |
| B2, E2 | Two unreadable flows give two identical `invalid_number` | low | patch | `Outflow` is read only once `Inflow` reads; test added. |
| B3 | Mint without `Transaction Type` reads every line as an expense | false | reject | Sure's `signed_csv_amount` negates every row whose type is not `credit`. |
| B4 | Mint reads `Notes` but its form does not show it | false | reject | Sure's `_mint_import` form has no notes field, its preset maps `Notes`. |
| B5 | YNAB date format fixed to `MM/DD/YYYY`; docs silent on it | low | patch | Sure's preset kept; `docs/deployment.md` now says to change « Format de date » for a day-first export. |
| B6 | A `$` amount lands in the account's currency | false | reject | Sure's `YnabImport` and `ActualImport` write `account.currency`; Archant converts none. |
| B7 | Parity row omits Mint's number format and deduplication | low | patch | `docs/sure-parity.md` « Formats » row states both. |
| B8 | Locale keys nothing reads | low | patch | `useColumnLabel` reads each tool's own keys; the unused ones are removed. |
| B9 | Mint notice words « import », the others « importation » | false | reject | Sure's `fr.yml` wording for each. |
| B10 | YNAB notice omits the signed `Amount` | false | reject | Sure's `amount_notice`, word for word. |
| B11 | Tests missing for Mint's currency column, `Category Group` + `Category` | medium | patch | Tests added: a Mint currency column refused against a USD account; YNAB's group joined to its category. |
| B12 | Mint sample in USD refused for a EUR household | low | reject | Sure's sample, as 30.4's transactions sample; the refusal names the line. |
| B13 | Tasks unticked, status not done, Code Map names a change the diff lacks | low | patch | Ticked and set at the end; Code Map corrected. |
| E1 | YNAB inflow and outflow near the bound can sum past `MAX_MINOR_UNITS` | low | reject | Needs amounts of a quadrillion minor units in one row; a guard adds a branch for no real file. |
| E4 | `Credit` or ` credit` read as a debit | false | reject | Sure compares `type == "credit"` exactly. |
| E5 | Blank payee with notes unmapped gets the default label | false | reject | Sure's `csv_value` with a blank label returns nil too. |
| E6 | A colon inside a group or category name splits wrongly | false | reject | Sure's `CategoryMapping` splits on the first colon too. |
| V1 | YNAB ignoring a sent signage untested | medium | patch | Test publishes with `inflows_negative` and reads the inflow-positive signs. |
| V2 | Tools forcing `signed_amount` untested | medium | patch | Mint test sends a custom column and reads `signed_amount`. |
| V3 | YNAB `Category Group` + `Category` branch untested | medium | patch | As B11. |
| V4 | Negative `Outflow` untested | medium | patch | Test reads `-4.25` in `Outflow` as -425. |
| V5 | Mint and Actual forms not driven from the page | low | defer | Logged in `deferred-work.md`; the server side of both is covered by `csv-import-tools.spec.ts`, YNAB by Playwright. |

Second pass, `bmad-code-review` (four layers) over the amended WIP commit; every patch applied, the owner unavailable.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1, A3 | « Laisser vide » on the category keeps YNAB's combined category and Actual's group | false | reject | Sure's `combined_category` reads its literal columns whatever the label, and Actual's `row[nil]` leaves the group alone, as here. |
| 2 | The preset `MM/DD/YYYY` can read a day-first YNAB file wrong | low | reject | Sure's preset; « Première date analysée » shows the first date and `docs/deployment.md` says to change « Format de date ». |
| 3 | Route test sends an account named as the file's, proving nothing | low | patch | The account sent is « Compte joint »; the line lands in « Checking ». |
| 4 | No tool file published twice | medium | patch | Test publishes an Actual file twice and finds one line. |
| 5, V1 | Choices over the presets, case-folded headers and Actual's convention untested | medium | patch | Tests send a date format and a name column over YNAB's presets with lower-case headers, and Actual's `inflows_negative`. |
| 6 | Docs silent on the account's currency | low | patch | `docs/deployment.md` says each line is written in its account's currency. |
| 7 | Docs silent on new accounts being depository | low | reject | As Story 30.4's new accounts, already documented there. |
| 8, A1 | Docs give Mint a payee fallback it lacks | low | patch | The sentence names YNAB and Actual only. |
| A2 | Docs say YNAB's `Amount` wins per file, the code per row | low | patch | Reworded: « its `Amount` when that cell is filled ». |
| 9 | `csvImport.configure.mint.notes` read by no form; `COLUMN_KEYS` comment says notes are shown | low | patch | Comment corrected; the key stays, since `useColumnLabel` types every key of `COLUMN_KEYS.mint`. |
| 10 | A tool's configuration echoes a type column's identifier and treatment | low | patch | Both are `null` for a tool; asserted. |
| 11 | Import history shows a tool's import as a CSV | low | reject | The history names the file, `ynab.csv` or the user's; a distinct source needs a schema change for a label. |
| 12 | Actual's `Split_Amount` unread | false | reject | Sure's `ActualImport` reads no split column either. |
| E1 | `sumOf` may pass `MAX_MINOR_UNITS` | low | reject | carried: first pass E1. |
| E2 | JPY decimals rounded per side | false | reject | `parseDecimalAmount` refuses more decimals than the currency holds (`invalid_number`); nothing is rounded. |
| E3 | YNAB name and notes miss Sure's `payee` and `memo` aliases | low | reject | Only reached when the user picks another column and its cell is blank; Sure's alias then reads the Payee the user moved away from. |
| E4 | Mint or Actual blank amount falls back to a `Balance` column alias | low | reject | Neither tool's export has a `Balance` column; a blank amount is otherwise `required`. |
| A4 | Playwright does not check the parent group | low | reject | The story asks Playwright to import one YNAB file; the parent is covered by Vitest. |
