---
title: "Story 30.3: Import accounts, categories, merchants, rules and trades from CSV"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: '453241243d976949d1535fa454ea8bc1c9c216e3'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-30-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-30-1-import-a-sure-archive.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) offers, under « Données brutes » of `imports/new.html.erb`, « Importer les comptes » (`AccountImport`), « Importer les catégories » (`CategoryImport`), « Importer des commerçants » (`MerchantImport`), « Importer les règles » (`RuleImport`) and « Importer les investissements » (`TradeImport`): a CSV goes through upload, configuration by header, a mapping step where the type needs one, a summary, then `import!` in one transaction. Archant writes `accounts.csv`, `categories.csv`, `merchants.csv`, `rules.csv` and `trades.csv` in its export but reads none of them back, and has no way to load a household's accounts, categories, merchants, rules or trades from a file.

**Approach:** Five more sources in « Réglages › Importations », each opening one page that walks Sure's steps « Téléverser », « Configurer », « Mapper » (accounts and multi-account trades only) and « Confirmer »; the page keeps the file and its choices and posts them to a stateless preview route that returns the headers, the sample, the mapping keys, the row errors and Sure's `dry_run` counts, then to an import route that checks everything again and writes in one immediate transaction.

## Boundaries & Constraints

**Always:**
- Routes: `POST /api/csv-imports/preview` and `POST /api/csv-imports`, `multipart/form-data` with `type` (`accounts`, `categories`, `merchants`, `rules`, `trades`), `file`, and `configuration` and `mappings` as JSON text parsed by Zod. Limits are Sure's: `Import::MAX_CSV_SIZE` 10 MB (`IMPORT_FILE_TOO_LARGE`, refused before reading), `max_row_count` 50 rows for accounts and 10,000 for the others (`IMPORT_TOO_MANY_ROWS`). A file that does not parse into headers and at least one data row with the chosen separator is `CSV_INVALID` (« Doit être un CSV valide avec des en-têtes et au moins une ligne de données »). An import posted while the preview finds an error is `CSV_IMPORT_INVALID` and writes nothing.
- Parsing is Sure's `Import.parse_csv_str`: the text decoded as the account CSV import decodes it, trimmed, headers on the first line, every cell trimmed, separator `,` or `;` (« Séparateur de colonnes », `,` by default). Headers are compared as Sure's `normalize_header` (trim, lower case, `*` removed, spaces and dashes to `_`); two headers equal after it are an error (`duplicate_headers`). A column picked in « Configurer » falls back to Sure's aliases (`csv_value`): `entity_type`/`account_type`/`type`, `amount`/`balance`, `qty`/`quantity`, `account`/`account_name`.
- Numbers go through Sure's `sanitize_number` for the chosen `NUMBER_FORMATS` key (« 1,234.56 » by default), then `parseDecimalAmount`, `parseQuantity` or `parseTradePrice`: never a float. Dates through the chosen strptime format among Sure's 11 `Family::DATE_FORMATS` (plus `DD/MM/YY` for accounts), preselected by Sure's `Import.detect_date_format` on the column's values; a row date that does not read, is 30 years old or more, or is after today is an error on its line, as `Import::Row#date_valid`.
- Every refusal is an issue `{ code, params }` naming its line (the CSV line, header being line 1), as Story 30.1's list: the page shows the first 50 and disables « Publier l'importation ». No amount, label or name in a log line.
- Accounts (`AccountImport`): columns « Type d'entité », « Nom » (required), « Solde » (required), « Devise » (« Par défaut », the reporting currency), « Date du solde » with « Format des dates », and « Format numérique ». « Attribuez vos types de comptes » maps each distinct type value, the empty one included, to an Archant type, or a type and subtype for a loan or a property, whose subtype Archant requires; a key equal to a Sure accountable class or an Archant type is preselected. Each account is created as the ledger's `createAccount` writes it, with its balance as its opening anchor on the row's date, else two years before today, as `OpeningBalanceManager#default_date`. A currency `isCurrencyCode` refuses is an error.
- Categories (`CategoryImport`): `name` required (`missing_columns` otherwise), `color`, `parent_category`, `lucide_icon`. A category is found by name folded as `assertNameFree` compares names, else created as an expense; its colour becomes the file's when it is `#rrggbb`, its icon the file's when Archant has it; its parent becomes the file's parent, found or created as a placeholder (`newCategory`), none when the column is blank. A child takes its parent's kind and colour. A category its own parent (`own_parent`) or a tree deeper than two levels (`nested_category`) is an error.
- Merchants (`MerchantImport`): `name` required; a blank name is skipped; a name that exists, folded, is kept; any other is created. Colour and website wait for Story 32.3.
- Rules (`RuleImport`): `name`, `resource_type`, `active`, `effective_date`, `conditions`, `actions`, read by Sure's `normalize_rule_row` and `parse_json_safely`. A `resource_type` other than `transaction` (`unsupported_resource_type`), JSON that does not parse (`invalid_json`), no action (`min_actions`), or a rule Archant cannot hold (`unsupported_rule`: a condition Archant lacks, no action left, or `ruleSchema` refusing it) is an error. Operands resolve as Story 30.1's rules do: names to the category, merchant or tag of that name, created when missing. A named rule updates the household's rule of that exact name, else is created; `active` reads Sure's `parse_boolean`, `effective_date` an ISO date or none.
- Trades (`TradeImport`): « Téléverser » offers « Compte (facultatif) » among the accounts that `supportsTrades`, or « Importation multi-comptes »; « Configurer » maps « Date » with « Format de date », « Quantité » with « Les achats sont en quantité positive » or « négative », « Devise », « Formater », « Ticker », « Code de bourse », « Prix », « Compte » (multi-account) and « Nom ». « Attribuez vos comptes » maps each account name to an account that supports trades, preselected by exact name, or to « Ajouter comme nouveau compte » (an investment account, reporting currency, opening balance zero the day before its first trade). A row in another currency than its account is `CURRENCY_MISMATCH`. A quantity of zero, a negative price or an amount past `tradeAmount`'s limit is an error. Each trade is a buy or a sale of `quantity × price`, fee zero, its security found by upper-cased ticker and MIC or created as a Yahoo listing in the account's currency; written in bulk by the ledger, balances and holdings recomputed once per account.
- Summary « Confirmez vos données d'importation »: « Élément » and « Nombre », Sure's `dry_run` keys (`accounts`, `categories`, `merchants`, `rules`, trades as `trades` plus the accounts the mapping creates); « Publier l'importation »; then « Importation réussie ». After commit, trades refresh statistics as Story 30.1 does. Administrators only.

**Never:** no stored upload, import row, import list or revert; no « Nettoyer » step (Story 30.5); no transaction CSV changes (Story 30.4); no merchant colour or website (Story 32.3); no network call; no migration; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Export round trip | `categories.csv`, `rules.csv` of an export into the same household | nothing duplicated; colours, parents, rules unchanged | none |
| Account | `Checking,Main,1000.00,EUR,2024-01-01`, type → depository | account, opening 100000 on 2024-01-01 | none |
| Loan type | key `Loan` | must pick a loan subtype | publish disabled until mapped |
| Trade sign | qty `-5`, « négative » | buy of 5, amount negative | none |
| Trade currency | USD row on a EUR account | not written | `CURRENCY_MISMATCH` on the line |
| Bad date | `2024-13-01` | not written | `invalid_date` on the line |
| Own parent | `Food,,Food,` | not written | `own_parent` |
| Rule JSON | `conditions` `[{` | not written | `invalid_json` on the line |
| Too many | 51 account rows | refused | `IMPORT_TOO_MANY_ROWS`, `max` 50 |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/sure-import.ts` -- private rule helpers (`operandOf`, `referenceId`, `createMissing`, `conditionOf`, `actionOf`, `ruleInputOf`, `Taxonomy`, `nameBook`): move them to a shared `services/sure-rules.ts` and use them from both importers.
- `packages/api/src/services/ledger/sure-import.ts` -- `securityResolver`, `existingSecurity`, `clock`, `insertAll`: export what trades need; the CSV trades writer lives beside it as `services/ledger/csv-trades.ts` (only `services/ledger/**` may import `entries`/`trades`).
- `packages/api/src/services/ledger/accounts.ts` `createAccount` -- run inside the import transaction (`{ ...deps, db: tx }` becomes a savepoint).
- `packages/api/src/services/rules.ts` `createRule`, `updateRule`, `setRuleEnabled`, `listRules` -- rule writes inside the transaction.
- `packages/api/src/domain/trades.ts` `tradeAmount`, `buyCostFits`; `@archant/data/decimals` `parseQuantity`, `parseTradePrice`; `@archant/data/money` `parseDecimalAmount`, `isCurrencyCode`; `@archant/data/account-types` `ACCOUNT_TYPES`, `isSubtypeOf`, `supportsTrades`.
- `packages/api/src/connectors/decode.ts` `decodeText` -- file text.
- `packages/api/src/lib/errors.ts` -- add `CSV_INVALID`, `CSV_IMPORT_INVALID`; reuse `IMPORT_FILE_TOO_LARGE`, `IMPORT_TOO_MANY_ROWS`.
- `packages/api/src/app.ts` -- mount `/csv-imports`, add both paths to the 64 KB body-limit exceptions, as `/api/sure-imports`.
- `packages/api/src/routes/sure-imports.ts` -- pattern for the routes; `services/sure-import-preflight.ts` `foldName`, `issue`, `tooLarge`.
- New: `services/csv-import-format.ts` (parse, headers, `sanitize_number`, strptime formats, `detectDateFormat`), `services/csv-import.ts` (per type: read rows, issues, counts, write), `routes/csv-imports.ts`, `schemas/csv-imports.ts`.
- App: `routes/_authed.settings.imports.tsx` (five sources, Sure's icons `building`, `shapes`, `store`, `workflow`, `square-percent`), new `routes/_authed.settings.imports_.$kind.tsx`, `hooks/useCsvImport.ts`, `locales/fr.json`, `lib/error-toast.ts` for the new codes; reuse the drop zone and summary look of `_authed.settings.imports_.sure.tsx`.
- Tests: `services/csv-import-format.spec.ts`, `services/csv-import.spec.ts`, `routes/csv-imports.spec.ts` (`useSignedInApp`, `sendOwn`), export round trip through `exportArchive`; e2e `packages/app/e2e/csv-import.spec.ts` (categories file).
- Docs: `docs/sure-parity.md` rows naming Story 30.3, `docs/architecture.md` AD-23 paragraph, `docs/deployment.md` « Importing an archive » neighbour paragraph.
- Sure, read-only at `00dd977fb`: `app/models/{import,account_import,category_import,merchant_import,rule_import,trade_import}.rb`, `app/models/import/{row,account_type_mapping,account_mapping}.rb`, `app/views/import/{uploads,configurations,confirms}/*`, `app/views/imports/{new,_ready,_success,_nav}.html.erb`, `config/locales/views/imports/fr.yml`, `config/locales/models/{category,merchant,rule}_import/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: `sanitize_number` per format, each strptime format and `detectDateFormat`; each kind's rows, issues and counts; the export's `categories.csv` and `rules.csv` reimported without duplicates; accounts with opening balances; trades in minor units with both sign conventions and a new account; routes' refusals (size, rows, CSV, viewer, import with errors).
- [x] `services/sure-rules.ts` extraction; format module; service; ledger trades writer; schemas, errors, routes, app wiring.
- [x] Interface: sources, the step page, mapping steps, summary, success; locale strings.
- [x] Playwright: import a categories file and find the category.
- [x] Docs; story and sprint status to done.

**Acceptance Criteria:**
- Given « Réglages › Importations », then « Importer les comptes », « Importer les catégories », « Importer des marchands », « Importer les règles » and « Importer les investissements » appear.
- Given each kind's file, when it is published, then rows land as the Boundaries say, all or nothing, and the summary counts what is written.

## Design Notes

Assumptions taken alone, owner unavailable, settled by Sure or Archant's model:

- Stateless, as Story 30.1: Sure stores the `Import` and its rows for its background job; Archant imports in the request and keeps no copy of the file.
- No « Nettoyer » step yet: row errors are listed on the summary and block publishing, as Sure's clean step blocks « Étape suivante »; Story 30.5 brings the editable table.
- « Configurer » preselects a column whose header matches the key or one of Sure's aliases, and the detected date format, so an export's own files need no mapping. Sure leaves the selects blank; prefilling changes nothing a user could not choose.
- « Format numérique » is offered for accounts too: Sure's account form has none and reads every balance as « 1,234.56 », which turns a French « 1 234,56 » into 123 456.
- A loan or a property maps to a type and subtype: Archant's accounts require one for those types (`accounts_subtype_check`), where Sure's allow none.
- Trades: « négative » negates the quantity as well as the amount, so a buy is a buy; Sure negates the amount only and labels the trade by the raw quantity. Archant trades have no label, so « Nom » is read and not stored. « Ajouter comme nouveau compte » creates an investment account, since Sure's `Depository` cannot hold trades in Archant.
- Rule errors are per line, where Sure stops at the first: same all-or-nothing outcome. An unnamed rule identical to an existing one (same conditions, actions and start date) updates it rather than adding a copy, which the story's no-duplicate reimport requires; Sure would add one.
- Categories created by the import are expenses: neither Sure's file nor Archant's export carries a kind.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.

## Implementation Notes

Decisions taken alone during implementation, the owner unavailable, each settled by Sure or by Archant's model:

- Sure's choices (`CSV_IMPORT_TYPES`, separators, `NUMBER_FORMATS`, `DATE_FORMATS` and `CSV_ONLY_DATE_FORMATS`, signage, column keys, row limits, `CREATE_NEW_ACCOUNT`) live in `schemas/csv-imports.ts`, exported as `@archant/api/schemas/csv-imports`, because « Configurer » lists them; `services/csv-import-format.ts` keeps the reading (`parseCsv`, `normalizeHeader`, `csvValue`, `sanitizeNumber`, `strptime`, `detectDateFormat`). Rules have their own module, `services/csv-import-rules.ts`, to keep `csv-import.ts` readable.
- A wholly blank line is no row: it is not counted and raises nothing, where Ruby's reader would give it empty cells that every required column then refuses. Line numbers stay the file's.
- Refusal codes beside the spec's: `required` (Sure's « is required »), `invalid_number` (a cell `sanitize_number` empties, which Sure also reports as missing), `date_out_of_range` (with Sure's bounds), `invalid_currency`, `zero_quantity`, `negative_price`, `trade_too_large` (`tradeAmount` or `buyCostFits` refusing), `security_currency` (a ticker stored, or met earlier in the file, in another currency than the row's account, which would otherwise fail the write after a clean preview), `unmapped_account_type` and `unmapped_account` (Sure's `publishable?` on mappings). `CURRENCY_MISMATCH` keeps the spec's spelling, Archant's statement rejection code.
- A currency cell is read upper-cased, as Sure's `Money::Currency` reads a code whatever its case. A trade row without currency takes its account's, Sure's `row.currency.presence || mapped_account.currency`; a new account's is the reporting currency.
- Rules: a column is found by its normalised header, a superset of Sure's exact `row["name"]`; a blank `resource_type`, `conditions` or `actions` is `required`, as Sure's `Import::Row#required_columns`. An update keeps the rule's own replacements in the label: Sure's file cannot carry them (the export leaves them out of `rules.csv`), so dropping them would change a rule on every reimport of the export.
- Trades: the accounts offered, in « Téléverser » and « Mapper », are the active ones that `supportsTrades`; a single-account import naming another is `TRADES_NOT_SUPPORTED`. The summary's `accounts` count shows only for a multi-account file: Sure computes it then discards it (`mappings.merge` unassigned), and the spec asks for it. « Importer les investissements » is disabled until the household has an account, as Sure's `requires_account`.
- The sources page shows Sure's two tabs as two groups, « Sources » and « Données brutes », in Sure's order. The upload button reads « Téléverser le CSV », Sure's French « Télécharger CSV » meaning the opposite. « Téléchargez un exemple de fichier CSV » offers Sure's `csv_template` of each import, built in the page.
- The date guess runs over the formats the form offers for the type, so an account file's `DD/MM/YY` is guessed too; « Première date analysée » shows under « Format des dates » while the column and format are those the last preview read.
- Category and merchant names are trimmed, NFC-normalised and cut to their form's limits, account names to 100, as Story 30.1 cuts them; a category colour is lower-cased before `#rrggbb` is checked.
- Statistics are refreshed after a trade import only, as the spec says; accounts go through `createAccount`, whose balances are computed in the same transaction.
- Review fixes: a rule's start date is read strictly, an impossible day such as 2024-02-30 becoming none as Sure's `Date.parse` rescue does; a trade row at quantity zero (the export's dividends and interest) is skipped and not counted, as Sure writes it at amount zero; a row without MIC finds the stored listing by ticker alone (`storedListing`, Sure's `find_by_ticker_and_exchange` with `match_blank_mic: false`); the page drops the date format when the date column changes so the server guesses it again, resets the columns and mappings for a new file, and reads the file again on `CSV_IMPORT_INVALID` to show the lines refused now.
- Rule rows read `conditions` and `actions` from the fifth cell on, whatever the headers, as Sure's `normalize_rule_row`. A JSON broken across cells by unescaped quotes splits differently in papaparse than in Ruby's `liberal_parsing`, so that one legacy form stays `invalid_json`.

## Spec Change Log

- 2026-10-17, review finding 2 (first pass): the Boundaries call a trade at quantity zero an error. The export's `trades.csv` writes every dividend and interest at quantity zero, so the export could not be read back; Sure's `TradeImport` writes such a row as a trade of amount zero, which moves no cash. Decided alone, the owner being unavailable, on the rule that Sure settles it: the row is skipped and not counted, and a new account mapped only by such rows is not created. Known-bad state avoided: a whole `trades.csv` refused for one dividend. KEEP: a negative price and an amount past the limit stay errors.
- 2026-10-17, code review: AC2's « counts what is written » reads as Sure's `dry_run`, the file's rows per type (`rows_count`), for categories, merchants and rules; Sure's summary does not tell a created row from one found again. KEEP: the trades' `accounts` count is the accounts the import creates.

## Review Triage Log

First pass, the three `bmad-build` review layers over the WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | Summary counts rows, not what is written | false | reject | Sure's `dry_run` is `rows_count` for each of these imports. |
| 2 | `trades.csv` dividends at quantity 0 block the reimport | medium | patch | `zero_quantity` refused the whole file; now skipped, as Sure writes it at amount zero. |
| 3 | `trades.csv` has no MIC, so a stored `XPAR` listing is duplicated | false | reject | `storedListing` already finds by ticker alone without a MIC; test added. |
| 4 | `accounts.csv` subtype ignored | false | reject | Sure's `AccountImport` reads no subtype; the type mapping step takes it. |
| 5 | Export's `'` formula prefix kept on reimport | low | reject | Only names starting with `=`, `+`, `-`, `@`; the fix would guess which apostrophes are the export's. |
| 6 | `CSV_IMPORT_INVALID` shows a stale summary | low | patch | The page reads the file again on that code. |
| 7 | `effectiveDateOf` accepts 2024-02-30 | low | patch | Round-trip check; none, as Sure's rescue. |
| 8 | Rule conditions/actions read by place, not header | false | reject | Sure's `normalize_rule_row` reads `fields[4..]` too. |
| 9 | Refusals without tests (TRADES_NOT_SUPPORTED, security_currency, trade_too_large, nested children, legacy JSON, service size, preview over 64 KB) | medium | patch | Tests added for each. |
| 10 | Playwright covers categories only | low | reject | The story asks Playwright for one categories file; mapping is covered by service tests. |
| 11 | Spec status contradicts sprint status | false | reject | Both move to done together at the end of the pull request. |
| 12 | `docs/sure-parity.md` CSV rows stale | low | patch | Both rows now name the transaction import and the raw-data imports' formats. |
| 13 | Test title « buys positive » | low | patch | Renamed. |
| 14 | Identical headers `Name,Name` not refused | false | reject | Sure flags only distinct originals normalising alike. |
| 15 | Line numbers off after a multi-line quoted cell | low | reject | Rare in these files; noted above. |
| 16 | `ruleInputOf` null at write after a clean analysis | maybe-false | reject | Same function and taxonomy at both times; no path shown. |
| 17 | A Sure rule naming a Sure account id blocks the file | low | reject | Archant keeps no rule on a missing account; the Boundaries make it `unsupported_rule`. |
| 18 | Stored account currency not a code drops a row | false | reject | `accounts.currency` only holds checked codes. |
| 19 | `Broker` and `broker` create two accounts | low | reject | Sure's `create_or_find_by(name:)` is exact too. |
| 20 | New file keeps the old columns | low | patch | Columns and mappings reset on a new file. |
| 21 | Date guess never reruns after picking the date column | medium | patch | The format is dropped when the column changes. |
| 22 | Service size check untested | low | patch | Test added. |

Second pass, `bmad-code-review` (four layers) over the amended WIP commit.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 23 | A new account mapped only by skipped zero-quantity rows is counted, never created | low | patch | `created` now keeps the names with a trade. |
| 24 | Skipped zero-quantity rows are not reported | low | reject | Sure's import writes them silently at amount zero; the deployment guide says they are skipped. |
| 25 | « Ajouter comme nouveau compte » always in the reporting currency | low | reject | Sure's `AccountMapping#create_mappable!` uses the family currency too. |
| 26 | Export's `'` formula prefix kept on reimport | low | patch | The parse strips exactly a `'` before `=`, `+`, `-`, `@`, tab or CR, the inverse of `textCell`; test added. |
| 27 | Rule start dates in other formats lost | low | reject | The export writes ISO dates; Sure's `Date.parse` leniency is not worth a parser. |
| 28 | One security lookup per row | low | reject | An indexed select per row, 10,000 at most; measured cost negligible beside the write. |
| 29 | No `missing_columns` for accounts and trades | false | reject | Sure checks headers only in `CategoryImport` and `MerchantImport`; the others report `required` per row. |
| 30 | File rows not parsed by Zod | low | reject | Every cell goes through a strict reader (`parseDecimalAmount`, `parseQuantity`, `strptime`, `isCurrencyCode`); the JSON of rules through `ruleSchema`. |
| 31 | No rollback test after a write failure | low | reject | `csv-trades.spec.ts` covers the write refusing a security in another currency; the transaction is the same `immediate` one. |
| 32 | Playwright covers categories only | low | reject | As triage 10; the story asks one categories file. |
| 33 | Multipart margin with large mappings | low | reject | Needs thousands of long account names in one file. |
| 34 | Summary says « new items » but counts rows | false | reject | Sure's `_ready` reads the same over `rows_count`; logged in the Spec Change Log. |
| 35 | `docs/sure-parity.md` status cell still names 30.4 for 12 formats | false | reject | That cell now concerns the transaction import only, as its row says. |
| 36 | Unmapped blank key on a skipped row blocks the file | low | reject | Needs a dividend line without account in a multi-account file. |
| 37 | Identical headers, line numbers | false | reject | As triage 14 and 15. |
| 38 | Blank `name` cell falls back to the first cell | false | reject | Sure's `row["name"].presence \|\| name` does the same. |
| 39 | No trading account and a blank account cell leaves « Mapper » stuck | low | reject | The household then has no account taking trades; Sure's step is stuck too. |
| 40 | Changing `$kind` keeps the last import's state | low | patch | The page is keyed on the kind. |
| 41 | Updating a stored category untested | medium | patch | Test recolours, moves and detaches stored categories, a child following. |
| 42 | Updating a named rule untested | medium | patch | Test updates conditions, `active` and an impossible date, keeping the label replacement. |
| 43 | Explicit trade account mapping untested | medium | patch | Test maps a name to the PEA; nothing created. |
| 44 | Existing account's recompute after trades untested | medium | patch | The same test reads the PEA's holdings. |
| 45 | Impossible start date untested | low | patch | Covered by 42. |
| 46 | Issue codes not tied between server and page | medium | patch | `CSV_ISSUE_CODES` in `schemas/csv-imports.ts`, `csvIssue` typed on it, the page's list derived from it. |
| 47 | « Mapper » untested end to end | low | defer | Logged in `deferred-work.md`. |
| 48 | Spec status and sprint status disagree | false | reject | Both read done in the pull request. |
| 49 | Sources under « Données brutes », not « Sources » | false | reject | Sure's « Nouvelle importation » puts them under its « Données brutes » tab. |

