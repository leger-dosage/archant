# Epic 30 Context: Imports, exports and resets as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's imports, export and reset back to Sure's behaviour (Sure at `00dd977fb`, `~/github/sure`): Sure's archive import, Mint, YNAB and Actual presets, account, category, merchant, rule and trade CSV imports, Sure's CSV mapping by header with a type column and its date formats and guess, the clean and confirm steps, a complete QIF reader, the export fields Sure writes, and Sure's reset of financial data, with or without sample data. Story 27.25's review of `docs/sure-parity.md` found these departures without an admitted reason. The owner's rule holds: follow Sure exactly; only money as integer minor units, French text a French user expects, accessibility and security justify a departure. No new FR; the epic is parity work.

## Stories

- Story 30.1: Import a Sure archive (done)
- Story 30.2: Import Mint, YNAB and Actual files
- Story 30.3: Import accounts, categories, merchants, rules and trades from CSV
- Story 30.4: Map currency, category, tags, account and a type column; Sure's date formats
- Story 30.5: Fix rows before publishing, and Sure's confirm step
- Story 30.6: Read QIF categories, tags, splits, investments and several accounts
- Story 30.7: Export each account's institution and cash balance, and each attachment's checksum
- Story 30.8: Reset all financial data
- Story 30.9: Reset with sample data

## Requirements & Constraints

- Each story names the Sure model, controller or view it mirrors (`import.rb` and its subclasses, `import/row.rb`, `Import::Mapping`, `import/cleans_controller.rb`, `import/rows_controller.rb`, `imports/_ready.html.erb`, `qif_import.rb`, `family/data_exporter.rb`, `family/financial_data_reset.rb`, `demo/generator.rb`). Read it before building and match its order, columns, words and refusals, not only its outcome.
- Visible text uses Sure's `fr.yml` wording where a key exists; Archant says « Marchands » for merchants and names products (Actual) rather than translating them.
- Money is integer minor units: every file amount is read from its decimal text, never through a float; quantities and trade prices stay canonical decimal text (`parseQuantity`, `parseTradePrice`), holding prices and cost bases millionths.
- Archant converts no currency: a row in another currency than its account is refused with `CURRENCY_MISMATCH`; sample data is all in the reporting currency.
- Roles: every write is admin-only through `viewerReadOnly`; the reset route also calls `requireRole("admin")`, as Sure's `ensure_admin`; the interface hides write controls when `useIsAdmin()` is false.
- No amount, label or name in a log line; error messages carry no amount; Zod parses every uploaded file's rows.
- Every story ships Vitest and Playwright tests for its acceptance criteria (30.7 changes no screen, so Playwright is unchanged) and sets each `docs/sure-parity.md` row it settles (« File import » table, « Full data export », « Onboarding, sample data, reset of all data »).

## Technical Decisions

- AD-4 ingestion pipeline: transaction files still go through `ingest()` in `services/ledger/ingest.ts`, per account, one immediate transaction, reject then key matching then pending then insert then rules then transfers then balances. Story 30.5 rewrites AD-4's grouped preview into Sure's clean table and dry-run summary; until then the preview and its `409 IMPORT_PREVIEW_STALE` stand.
- AD-2: only `services/ledger/` writes money rows (entries, transactions, trades, balances, holdings, transfers, taggings, attachments); importers and the reset call ledger functions. The reset deletes in one transaction what Sure's `delete_financial_data!` deletes and keeps users, members, sessions, assistants and settings.
- AD-5 sign: an amount is signed from the account's point of view, money out negative, where Sure stores an expense positive; every Sure-style sign (type column, Mint incomes positive, YNAB inflow minus outflow, trade buy sign) is converted at the boundary.
- AD-7 keys: imported lines write fingerprint keys; Archant keeps its own CSV deduplication (Sure defect we-promise/sure#3779), but a matched line takes the row's category, tags and notes (Story 30.4).
- AD-10: a matched line's fields set by import follow lock rules; only `origin: "user"` locks.
- AD-20 splits: QIF split lines become children summing exactly to the parent, which is excluded and locked; otherwise one line at the total.
- AD-22 trades: a trade amount is `-(quantity × price + fee)`, rounded half to even; only an account where `supportsTrades` holds takes one, `TRADES_NOT_SUPPORTED` elsewhere.
- AD-23 export: `EXPORTED_COLUMNS` and `LEFT_OUT` in `services/ledger/export.ts` must list every column; Story 30.7 adds `institution_name` (recorded since Story 28.15) and `cash_balance` to `Account` lines, and an attachment's `checksum` as Base64 MD5 of its bytes, same value for attachments saved before the story; bytes never leave.
- Story 30.1 built the archive path: `POST /api/sure-imports/preflight` and `POST /api/sure-imports`, `services/sure-import-preflight.ts`, `services/sure-import.ts`, `services/ledger/sure-import.ts`, limits `SURE_IMPORT_MAX_NDJSON_SIZE_MB` and `SURE_IMPORT_MAX_ROWS`, no stored upload and no revert. Its category, merchant and rule resolution (reuse by folded name, `ruleSchema` check, skip a rule whose condition Archant lacks) is the model for Story 30.3.
- Sample data (30.9) is deterministic from a fixed seed, as Sure's `DEMO_DATA_SEED`, with French names.

## UX & Interaction Patterns

- « Réglages › Importations » (`/settings/imports`) lists the sources under « Sources »; each new story adds its entry: « Importer depuis Mint/YNAB/Actual », « Importer les comptes », « Importer les catégories », « Importer des marchands », « Importer les règles », « Importer les investissements ».
- Import steps read « Téléverser », « Configurer », « Nettoyer », « Mapper », « Confirmer »; mapping steps « Attribuez vos types de comptes / catégories / étiquettes / comptes » map each file value to an existing one, a new one or none.
- « Format de date » offers Sure's 11 `Family::DATE_FORMATS` plus `DD/MM/YY`, preselects the guess, shows « Première date analysée » or « Impossible de détecter le format de date ».
- Clean step: ten rows per page, « Toutes les lignes » / « Lignes d'erreur », invalid cells red with their reason, a cell saved on blur, « Étape suivante » disabled while a row is invalid; confirm lists « Élément » and « Nombre », then « Publier l'importation ».
- « Zone dangereuse » in « Réglages »: « Réinitialiser le compte » and « Réinitialiser et précharger », each with Sure's confirm dialog; « Votre compte a été réinitialisé. » after.

## Cross-Story Dependencies

- 30.1, 30.3, 30.4, 30.7 and 30.8 in any order. 30.2 after 30.4 (its presets feed 30.4's category and account mapping). 30.5 after 30.4; 30.6 after 30.5 (its category selection and review use the new steps). 30.9 after 30.8 (it runs the reset first).
- 30.3 fills a merchant's colour and website only once Story 32.3 (backlog) gives merchants those fields. Story 28.15 is done, so 30.7 exports real institutions.
- Stories 30.2 to 30.6 all touch the CSV/QIF connectors, `services/imports.ts` and the import screens; build them one at a time.
- Deferred from 30.1: archive recurring occurrences, allocations, price changes and match rejections are parsed but not written; a security found in another currency than the importing account fails the whole archive import after a clean preflight.
