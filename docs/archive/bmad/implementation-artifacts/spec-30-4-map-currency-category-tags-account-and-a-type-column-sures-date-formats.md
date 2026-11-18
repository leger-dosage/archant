---
title: "Story 30.4: Map currency, category, tags, account and a type column; Sure's date formats"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'c2628948a26234a6b5357abdda0f0518385e99d7'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-30-3-import-accounts-categories-merchants-rules-and-trades-from-csv.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) imports transactions from a CSV by header (`TransactionImport`): date, amount, name, currency, category, tags, account and notes, `rows_to_skip`, the sign from the amount or from a type column, its 12 date formats, then « Attribuez vos catégories », « Attribuez vos étiquettes » and « Attribuez vos comptes », and a line already present takes the row's category, tags and notes. Archant's transaction CSV import maps columns by index into one account and reads neither currency, category, tags, account nor a type column, with six date formats and no guess.

**Approach:** « Importer les opérations » (Sure's « Importer les transactions », in Archant's word for transactions) joins « Données brutes » as Sure's first raw-data source, a `transactions` kind of Story 30.3's stateless `/api/csv-imports` path and `/settings/imports/$kind` page: « Téléverser » (« Compte (facultatif) » or « Importation multi-comptes »), « Configurer » with Sure's `_transaction_import` form, « Mapper » with Sure's three mapping steps, « Confirmer » with Sure's `dry_run`. Publishing writes, in one immediate transaction, the mapped categories, tags and accounts, then each account's lines through `ingest()` under an `imports` row of its own, so dedup (AD-7), rules, transfers, history and revert work as for any import.

## Boundaries & Constraints

**Always:**
- Configuration (Sure's form order): « Ignorer les n premières lignes » (`rowsToSkip`, raw lines dropped before parsing; changing it reads the file again), « Date » + « Format de date » (Sure's 11 `Family::DATE_FORMATS` plus `DD/MM/YY`, preselected by `detectDateFormat`, « Première date analysée » or « Impossible de détecter le format de date »), « Montant » + « Devise » (« Par défaut ») + « Format » (Sure's `NUMBER_FORMATS`), « Stratégie de type de montant » « Montant signé » (« Les revenus sont positifs / négatifs ») or « Colonne personnalisée » (the type column, the identifier value among the column's values, « Revenu (entrée) » or « Dépense (sortie) »), then « Compte » (multi-account only), « Nom », « Catégorie », « Étiquettes », « Notes ». Columns start empty, as Sure's selects; date and amount are required, and a custom column needs its column, value and treatment.
- Sign: Sure's `apply_transaction_signage_convention`, then negated into Archant's sign (AD-5): incomes positive.
- Amount through `sanitizeNumber` then `parseDecimalAmount` in the line's currency; a currency cell `isCurrencyCode` refuses is `invalid_currency`; a row in another currency than its account is `CURRENCY_MISMATCH`; dates as Sure's `date_valid`. Every refusal is an issue on its line; any issue blocks publishing.
- Tags split as Sure's `split_tags` (`,` or `|`, backslash escapes); a row with more than `MAX_TAGS_PER_TRANSACTION` mapped tags is `too_many_tags`.
- Mapping steps as Sure's `CategoryMapping`, `TagMapping`, `AccountMapping`: one entry per distinct value, blank included as « (non attribué) », with its row count; preselected to the category, tag or account of that name (folded as Archant compares names; a category key `Parent:Child` looks up `Child`), else « Ajouter comme nouvelle catégorie / étiquette / nouveau compte » for a non-blank key; a category or tag may be left unassigned, an account may not (`unmapped_account`). Accounts offered: active ones without a bank link, as Sure's `accounts.manual`.
- Creating: a category through `newCategory`, `Parent:Child` under a root parent found or created, the child taking its colour and kind; a tag by name; an account as a depository in the reporting currency with a zero opening balance the day before its first line.
- Lines: label the row's name, else « Opération importée »; notes the row's; category and tags the mapped ones, origin `sync` (no lock, AD-10), rules run after as for any import. A line `present` or `matched` takes the row's category, tags and notes when the row has them, unless the user locked that field.
- Summary keys: `transactions` (rows), `categories`, `tags`, and `accounts` for a multi-account file (the mapped values to create).

**Never:** no change to the account's own import dialog (index mapping, saved mapping, grouped preview); no « Nettoyer » step (Story 30.5); no Mint, YNAB or Actual preset (Story 30.2); no stored upload between steps; no migration; no new dependency; no currency conversion.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Type column | `Type` = `Credit`/`Debit`, `Credit` as « Revenu (entrée) », `12.50` both | +1250 and -1250 | none |
| Signed, incomes negative | `-30.00` | +3000 | none |
| French date | `15/03/2026` | `%d/%m/%Y` preselected, first date 2026-03-15 | none |
| No format reads | `March 5th` | `%Y-%m-%d`, « Impossible de détecter… » | `invalid_date` per line |
| Rows to skip | 2 preamble lines, skip 2 | headers on line 3, issues name file lines | `CSV_INVALID` when nothing is left |
| Currency | USD row, EUR account | not written | `CURRENCY_MISMATCH` on its line |
| Matched line | same date, amount, label as a synced entry, row has `Food` | entry categorised `Food` | locked category kept |
| Account blank | multi-account, blank account cell | must be mapped | publish disabled |

</frozen-after-approval>

## Code Map

- `packages/api/src/schemas/csv-imports.ts` -- add `transactions` first in `CSV_IMPORT_TYPES`; `COLUMN_KEYS.transactions` (`account`, `date`, `amount`, `name`, `currency`, `category`, `tags`, `notes`, `entity_type`); `AMOUNT_TYPE_STRATEGIES`; configuration gains `rowsToSkip`, `amountTypeStrategy`, `amountTypeIdentifier`, `amountTypeInflow`; mappings gain `categories`, `tags`; `CREATE_NEW_ACCOUNT` becomes Sure's `CREATE_NEW_KEY`; `dateFormatsOf` offers `DD/MM/YY` to transactions; new issue codes `too_many_tags`, `custom_column_requires_inflow`.
- `packages/api/src/services/csv-import-format.ts` `parseCsv` -- take `rowsToSkip`, keep file line numbers; add `splitTags`.
- `packages/api/src/services/csv-import.ts` -- `readTable`, `resolveConfiguration` (no preselection for transactions), `datesOf`, `analysisOf`, preview `mappings`; transactions analysis in a new `services/csv-import-transactions.ts`, as rules live in `csv-import-rules.ts`.
- `packages/api/src/domain/statement.ts` `NormalizedTransaction` -- optional `categoryId`, `tagIds`.
- `packages/api/src/services/ledger/ingest.ts` -- created rows take the line's category and tags (beside an assistant's classification); option `stateless` skips the stored-preview digest check; option `updateMatched` classifies `present`/`matched` entries through `changeOf`/`detailOf` (origin `sync`, locks honoured), taggings rewritten.
- `packages/api/src/services/imports.ts` -- reuse `ORIGIN`, `STATISTICS_REFRESH_LINES`, `refreshAfterImport`, `detectAfterImport` (export them) after a transactions publish.
- `packages/api/src/services/ledger/accounts.ts` `createAccount`; `@archant/data/category-presets` `newCategory`; `services/sure-import-preflight.ts` `foldName`; `services/sure-import-plan.ts` `cut`.
- App: `routes/_authed.settings.imports.tsx` (source, `FileSpreadsheetIcon`, needs an account), `routes/_authed.settings.imports_.$kind.tsx` (upload account list, transaction configuration, three mapping sub-steps, counts), `locales/fr.json`.
- Tests: `services/csv-import-format.spec.ts`, new `services/csv-import-transactions.spec.ts`, `services/ledger/ingest.spec.ts` (matched classification), `routes/csv-imports.spec.ts`; e2e `packages/app/e2e/csv-import.spec.ts` (sources list) and a transactions test mapping a category.
- Docs: `docs/sure-parity.md` « CSV mapping », « CSV formats », « Deduplication » rows; `docs/deployment.md` « Importing CSV files ».

## Tasks & Acceptance

**Execution:**
- [x] Vitest first: type-column and signed signs, `rowsToSkip` lines, tag splitting, date guess for transactions, issues (currency mismatch, unmapped account, too many tags, custom column incomplete), mapping preselection and counts, publish into one account and into mapped/new accounts with new categories (`Parent:Child`) and tags, imports rows in history, matched line classified with a user lock kept.
- [x] Schemas, format, transactions analysis and write, ingest options, imports helpers.
- [x] Interface: source, upload account, configuration form, mapping sub-steps, summary; locale strings.
- [x] Playwright: import a transactions file into an account, map its category to a new one, find the transaction categorised.
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given « Réglages › Importations », then « Importer les opérations » is the first source of « Données brutes », disabled without an account.
- Given a published transactions file, then each line lands once in its account with its category and tags, the account's import history lists it and reverting it removes its lines.

## Design Notes

Assumptions taken alone, owner unavailable, settled by Sure or Archant's model:

- Sure's TransactionImport is reached from « Données brutes » and from the account page; Archant's account dialog keeps its index mapping (files without header, several label columns, debit and credit columns, recorded in `docs/sure-parity.md`), and the by-header import is the settings source. Story 30.5 brings both to Sure's clean and confirm steps.
- Columns are not preselected, as Sure's form; Sure's « Modèle trouvé » (`suggested_template`) is left out (deferred).
- An `imports` row per account at publish, so Archant's history and revert apply; its file bytes are not kept (AD-14), as a confirmed import's.
- Sure's dedup (exact date, amount, name) stays Archant's keys and 3-day pairing (we-promise/sure#3779); only the classification of a matched line follows Sure.
- « Notes » and « Étiquettes » are Archant's words where Sure's French reads « Remarques » and « Balises »; « Définir » replaces Sure's « Ensemble » (a mistranslation of « Set »).

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

## Implementation Notes

Decisions taken alone during implementation, the owner unavailable, each settled by Sure or by Archant's model:

- Implemented in this session rather than by a dispatched agent, the investigation being already loaded.
- The source reads « Importer les opérations »: « Opérations » is Archant's word for transactions in its navigation and lists, where Sure's French reads « Importer les transactions »; the summary's « Opérations » is Sure's own `dry_run_resources` word.
- The helpers every raw-data kind shares (`Sheet`, `Analysis`, `cellOf`, `dateOf`, `numberOf`, `currencyOf`, `keysOf`, the aliases) moved to `services/csv-import-sheet.ts`, so `services/csv-import-transactions.ts` uses them without an import cycle; `csv-import.ts` stays under its former size. The write that inserts `imports` rows and calls `ingest` lives in `services/ledger/csv-transactions.ts`, since only the ledger confirms imports (AD-2, AD-4).
- `Analysis.committed` runs after the transaction commits: a transactions import refreshes statistics past `STATISTICS_REFRESH_LINES` and runs recurring detection once, as `confirmImport` does.
- The preview returns `typeValues`, Sure's `selectable_amount_type_values`, the chosen type column's distinct values in file order; choosing the type column, the date column or the lines to skip reads the file again at once, as Sure's form refreshes, so the date guess and « Première date analysée » show before « Appliquer la configuration ». The date-column reread applies to every kind.
- « Mapper » shows Sure's steps one at a time, « Suivant » moving to the next and the last posting the preview; the generic step is `components/CsvMapStep.tsx`, which replaces the page's account-type and account step.
- A currency cell left blank takes the line's account currency, where Sure takes the import's default currency; a multi-account file would otherwise refuse every blank cell of a foreign account.
- A category key with a blank side (`Maison:`) is read as its non-blank side, where Sure fails the whole import on an empty name.
- The labels « Format numérique », « Format de date », « Colonne de type de montant », « Valeur d'identifiant », « Traiter « … » comme » replace Sure's « Formater » and « Ensemble … comme … », which read as mistranslations.
- With lines skipped, a row's line counts the skipped lines and the blank lines after them, so it names the line the user sees.

## Spec Change Log

- 2026-10-17, review finding B8: the frozen intent named the source « Importer les transactions », Sure's wording. Decided alone, the owner being unavailable, on the rule that Archant's own word for the same thing wins: « Importer les opérations ». Amended the Approach and the first acceptance criterion. Known-bad state avoided: the only place in the interface calling transactions « transactions ». KEEP: Sure's order, first of « Données brutes ».

## Review Triage Log

First pass, the three `bmad-build` review layers over the WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| B1, E3 | A key `Maison:` or `:Jardin` creates a category with an empty name | medium | patch | `splitCategory` now reads a key with a blank side as its other side; test added. |
| B2, E4 | `Parent:Child` whose parent is a child files under the grandparent | false | reject | Sure's `create_mappable!` does the same (`existing&.subcategory?` then `existing.parent`). |
| B3, E7 | Line numbers off when blank lines follow the skipped ones | low | patch | `parseCsv` counts them once lines are skipped; test added. |
| B4, E8 | « Ignorer les n premières lignes » accepts more than the schema's 1,000 | low | patch | `max` on the input and the commit refuses above `MAX_ROWS_TO_SKIP`. |
| B5 | A `matched` line (3-day pairing) is reclassified, Sure only updates exact duplicates | false | reject | Archant's dedup deems the row that entry and writes no line for it (AD-7); classifying it is the epic's decision for this story. |
| B6 | Revert keeps created accounts, categories, tags and matched lines' new classification | low | defer | Archant's revert deletes only the entries an import created, for every import; logged in `deferred-work.md`. |
| B7 | « Confirmer » does not count the lines reclassified | false | reject | Sure's `dry_run` counts `rows_count`, not the duplicates it updates. |
| B8 | Source label differs from the frozen intent | low | patch | Spec Change Log: Archant's word « Opérations » kept, spec amended. |
| B9 | Spec and sprint status disagree | false | reject | Both read done together at the end of the pull request. |
| B10, B11 | `ingest` options untested directly | false | reject | `ledger/csv-transactions.spec.ts` drives `stateless` and `updateMatched`, the service spec a user lock; the assistant path is unchanged and covered by its own tests. |
| B12 | Playwright covers one account and one category | low | reject | The story asks Playwright to map a category; multi-account, type column and skipped lines are covered by Vitest. |
| B13 | No way back from one mapping sub-step to the previous | low | reject | « Mapper » restarts at its first step from the nav; adding sub-step navigation is new surface. |
| B14 | `typeValues` may list many values | low | reject | Bounded by the file's 10,000 rows; a wrong column is visible at once. |
| E1 | A blank type value crashes the select (`""` item value) | high | patch | A sentinel stands for the blank value both ways. |
| B15 | `CsvMapStep` repeats `ErrorLine` markup | low | reject | Four lines; sharing it needs a new module. |
| B16 | `committed` logs the first import id only | low | reject | Detection runs once for the household; the id only tags its log line. |
| E2 | A field changed during a reread is lost | low | reject | The reread lasts milliseconds on a local server; the choice shows reset and can be made again. |
| E5 | Counts differ when new keys fold alike or a parent is created | false | reject | Sure's `dry_run` counts creational mappings the same way. |
| E6 | Per-row array copy is quadratic under the write lock | low | patch | Lines are pushed in place. |
| E9 | Label differs from Sure's « Importer les transactions » | low | patch | As B8. |
| V1 | `typeValues` untested | medium | patch | Test added in the `type column values` block. |
| V2 | Recurring detection after a transactions import untested | medium | patch | Test publishes three monthly lines and reads the series. |
| V3 | Two new keys differing by case untested | medium | patch | Test publishes `Courses`/`courses` and `Maison`/`maison`, one row each. |
| V-other | `typeValues` reads the raw column, the sign reads through aliases | false | reject | Sure's `selectable_amount_type_values` reads the raw column and `entity_type` reads `csv_value` with aliases too. |

Second pass, `bmad-code-review` (four layers) over the amended WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 25 | Spec `done`, sprint `review` | false | reject | Both read done in the pull request. |
| 26 | Account names compared exactly, the spec says folded; `Livret`/`livret` create two accounts | medium | patch | Preselection folds; new accounts are one per folded name, named as first spelt; test added. |
| 27 | A new account may repeat the name of a linked or inactive one | low | reject | Archant account names are not unique; the user sees « Ajouter comme nouveau compte » for that value. |
| 28 | `valueMappings` and the trades' `accountMappings` duplicate one rule | medium | patch | `valueMappings` lives in `csv-import-sheet.ts`; trades call it with an exact-name finder. |
| 29 | `updateMatched` queries row by row under the write lock | low | reject | Only lines found again with a category, tags or notes; a local SQLite read per line. |
| 30 | Each republish adds an empty import to the history | false | reject | The same holds for every statement import confirmed with nothing new; consistent. |
| 31 | Locks on tags and notes untested under `updateMatched` | low | reject | `changeOf` applies one rule to every field, covered by its own tests; the category lock is tested here. |
| 32 | Route tested for one account only | low | reject | The service spec covers multi-account mappings; the route only parses the form. |
| 33 | `docs/sure-parity.md` « Revert » silent on the departure | low | patch | Row now states it, pointing to deferred work. |
| 34 | Template account column removed by position | low | patch | Found by its header. |
| 35 | Leading blank lines without skipped lines shift numbers | false | reject | Story 30.3 numbers rows from the header as line 1, kept. |
| 36, E-f | « Ignorer les n premières lignes » keeps a value the file refused | low | patch | The choice is kept only once the file reads with it; the field resets on reread. |
| E-a | A key `:` creates a category with an empty name | medium | patch | `valueMappings` takes a `named` test; a category key naming nothing is never « nouvelle »; test added. |
| E-b | Parent named is a child | false | reject | As triage B2, Sure's own behaviour. |
| E-c | Blank identifier falls back to an alias column | false | reject | Sure's `entity_type` reads `csv_value` with the same aliases. |
| E-d | `too_many_tags` counts a new key folding to a mapped tag twice | low | reject | Needs a user overriding the preselection, which finds that tag already. |
| E-e | Counts per key, not per created row | false | reject | As triage E5, Sure's `dry_run`. |
| V-a | Multi-account line in a foreign account's currency untested | medium | patch | Test maps a USD account, reads a blank cell in USD and refuses EUR. |
| V-b | Linked account refused in « Attribuez vos comptes » untested | medium | patch | Test links an account and maps to it: `unmapped_account`. |
| V-c | Custom column and skipped lines not driven from the page | medium | patch | The Playwright test skips a preamble and signs from « Sens ». |
| V-d | Account mapping and non-default choices not driven from the page | low | defer | Logged in `deferred-work.md`, as 30.3's account mapping. |
| A-1 | Account folding differs from Sure's exact `find_by` | low | patch | As 26; the spec's folded rule kept. |
