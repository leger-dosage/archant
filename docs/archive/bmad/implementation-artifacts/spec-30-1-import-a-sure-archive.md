---
title: "Story 30.1: Import a Sure archive"
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_commit: 'dfcabb725232ab3390b0b0976545f448e7e40b3c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/epics.md#Epic 30'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (at `00dd977fb`) imports the `all.ndjson` of its own export: « Importer depuis Sure » (« Fichier .ndjson d'export complet ») in `imports/new.html.erb`, the upload page « Importer depuis l'export » (`import/uploads/show.html.erb`), `SureImport::Preflight` before publishing, the confirm page « Confirmer votre importation » with « Résumé de l'importation » and « Démarrer l'importation » (`import/confirms/show.html.erb`), then `Family::DataImporter` merging every record into the family in one transaction, reusing categories, tags and merchants by name. Archant writes that file in its export (Story 18.1) but cannot read one back: a Sure user cannot move to Archant, and an Archant export cannot be restored into a running household.

**Approach:** A settings section « Importations » listing the import sources, with « Importer depuis Sure »; a page that uploads one `.ndjson` or `.json` file to a preflight route returning Sure's counts, errors and warnings; « Démarrer l'importation » posting the same file to an import route that runs the preflight again and writes everything in one immediate transaction, in Sure's dependency order, through a ledger module that bulk-inserts and recomputes each new account's balances once.

## Boundaries & Constraints

**Always:**
- Limits are Sure's: `SURE_IMPORT_MAX_NDJSON_SIZE_MB` (10 by default) and `SURE_IMPORT_MAX_ROWS` (100,000 by default), environment variables read by `env.ts`, a non-positive or unreadable value ignored as Sure's `positive_integer_env`; listed in `.env.example`. A file over the size is refused before it is read (`IMPORT_FILE_TOO_LARGE`, `params.maxSize` in MB); more lines carrying a `type` than the row limit is refused (`IMPORT_TOO_MANY_ROWS`, `params.max`), as Sure's `MaxRowCountExceededError`.
- Upload: `POST /api/sure-imports/preflight` and `POST /api/sure-imports`, `multipart/form-data` with one `file`. A name not ending in `.ndjson` or `.json`, an empty file, or a first non-blank line that is not a JSON object with `type` and `data` is `NDJSON_INVALID` (« Le fichier doit être un NDJSON valide avec au moins un enregistrement »), as Sure's `valid_ndjson_first_line?`.
- Preflight (`services/sure-import-preflight.ts`) is Sure's `SureImport::Preflight`, checks in its order: line parse (`invalid_json`, `invalid_ndjson_record`, `unsupported_record_type` against `Family::DataImporter::SUPPORTED_TYPES`, `no_data_rows`), `existing_taxonomy_collision` (warning, names folded as Archant compares them), `duplicate_taxonomy_name`, `duplicate_source_id` (split line ids in the transactions namespace), `missing_required_fields` against `REQUIRED_FIELDS`, accountables, split lines (`invalid_split_lines`, `invalid_split_line`, `split_amount_mismatch` compared exactly on decimal text), references against `REFERENCE_FIELDS` and `tag_ids` (`missing_reference`, an error; `skipped_missing_reference` for a `RejectedTransfer`, `skipped_unnamed_recurring` and `skipped_missing_merchant_reference` for a merchant, warnings), `duplicate_valuation`. Its counts are Sure's `dry_run_totals_from_line_type_counts` over `IMPORTABLE_NDJSON_TYPES`.
- Archant's own refusals sit in the same list as `invalid_import_record` with the line, the type, the field and the value, as Sure's `InvalidRecordError`: an `accountable_type` outside Sure's nine, a subtype Archant's `ACCOUNT_TYPES` lacks for that type (`credit_card` read as none), a currency `isCurrencyCode` refuses, an entry (transaction, trade, valuation) in another currency than its account's (AD-6), a trade or holding on an account that holds no security, an amount, quantity, price or date its reader refuses. Messages carry no amount.
- Import, inside one `deps.db.transaction(..., { behavior: "immediate" })`, Sure's order: accounts, balances, categories, tags, merchants, recurring transactions and their recurrence rules, transactions with split lines, transfers, rejected transfers, trades, holdings, valuations, budgets and budget categories, rules. Every id is new; the file's ids map to them per type. Nothing is written when the preflight has an error or a write fails.
- Amounts: every decimal is read from its text into integer minor units of the line's currency, rounded half to even beyond the currency's decimals (`parseDecimalAmount` in `@archant/data/money`); Sure's sign is reversed for transactions, split lines, trades and recurring amounts (AD-5); balances, valuations and budgets keep theirs. Quantities and trade prices go through `parseQuantity` and `parseTradePrice`, holding prices and cost bases through `parseMicros`.
- Accounts: created as `createAccount` writes them, unlinked and active unless Sure's `status` is `disabled`, with name, type from `accountable_type`, subtype, currency, `exclude_from_reports`, `institution_name`, `institution_domain`, `notes`, and the details Archant keeps (a loan's terms, a card's, a property's, a vehicle's, a crypto account's tax treatment) when they read; the `archant` keys of Archant's own export restore its subtype and a loan's end date and a property's address. The opening anchor is the account's `opening_anchor` `Valuation` line; without one, Sure's `OpeningBalanceManager` fallback: the account's `balance`, dated the day before its oldest line, else today.
- `Balance` lines are counted and checked, never stored: each new account's balances and holdings are recomputed once from its oldest entry by `recomputeBalances`, as Sure's sync after the import computes them again.
- Categories, tags and merchants: one whose name exists, folded as `assertNameFree` compares names, is reused unchanged; otherwise created, a category with Sure's `classification` as its kind, its colour when it is `#rrggbb`, its icon when Archant has it, else `newCategory`'s, its parent set in a second pass when that parent is a top-level category, taking the parent's kind and colour.
- Transactions: entry and transaction rows as the ledger writes them, `category_origin` `user`, unlocked; `one_time` kind as `oneTime`; `archant` keys of Archant's export restore `pending`, `reference`, `possible_duplicate`, `locked_fields`, `category_origin` and `investment_activity_label`. A transaction with split lines becomes a parent, excluded and locked, and its lines children as `splits.ts` writes them, a line without `tag_ids` taking its parent's tags.
- Transfers: kind from `archant.kind`, else `transferKindOf` of the two accounts; status Sure's, `pending` when unknown; both sides cleared of `one_time`. A pair already in a transfer, on one account, or with a side missing, is skipped. Rejected transfers are inserted when both sides came across.
- Trades and holdings: a security is found by upper-cased ticker and MIC, else by ISIN (`archant.isin`), else created in the account's currency, a listing with provider `yahoo` or, when the ticker is the ISIN, one typed by hand; Sure's `CASH-<id>` interest has none. Buy and sell keep Sure's signed `qty`, the fee from `archant.fee`, else the amount less `qty × price`, never below zero; `Dividend` and `Interest` are incomes of quantity zero. A `Holding` line's price becomes that security's price of that day when none is stored (source `provider`), and a manual locked cost basis a `cost_basis_locks` row dated at the position's first locked day.
- Valuations: `reconciliation` and `current_anchor` lines are snapshots (`reconciliation`), one per account and day; the opening anchor is written with the account.
- Budgets: the month of `start_date`; an existing month is reused and takes the file's totals; a line in another currency than the reporting one is skipped. A budget category on an income category is skipped; `rollover_enabled` is read when present.
- Rules: Sure's `rule_operand_value`, names resolved to ids by finding or creating the category, merchant or tag; an amount condition read as a decimal of the reporting currency; an account id through the account map. A rule with a condition Archant lacks is skipped; an action Archant lacks is dropped and the rule skipped when none is left; `archant.actions` restores a replacement in the label; the result is checked by `ruleSchema`, a refusal skipping the rule; `active` false creates it disabled.
- After commit: statistics refreshed and recurring detection run, as after a file import, best-effort and logged by code.
- Interface: « Réglages › Importations » (`/settings/imports`, Sure's « Importations », icon `download`) lists the sources under « Sources » with « Importer depuis Sure » and « Fichier .ndjson d'export complet »; `/settings/imports/sure` is « Importer depuis l'export » with Sure's description, a dashed drop zone « Parcourir » « pour ajouter votre fichier all.ndjson ici », the hint, and « Téléverser le NDJSON »; then « Confirmer votre importation », « Résumé de l'importation » with one row per non-zero count in Sure's `dry_run_resources` names, Sure's empty text, each error, Sure's warning rollups, « Démarrer l'importation » (disabled while errors stand) and « Annuler »; then « Importation réussie » with « Retour au tableau de bord ». Administrators only, as every section but « Sécurité ».
- Docs: `docs/sure-parity.md` « Formats » and « Full data export », `docs/deployment.md` « Exporting your data » (and a restore paragraph), AD-23 in `docs/architecture.md`, `.env.example`, `AGENTS.md` where it says the export is never read back.

**Never:** no stored upload, import row or migration; no revert of a Sure import; no `goals.ndjson` or `prices.ndjson` reading; no occurrence, allocation, price change or match rejection line written (they are parsed and checked, and detection rebuilds the schedule); no new dependency; no amount, label or name in a log line.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Round trip | Archant export of a household into an empty database | same accounts, daily balances and transactions | none |
| Not NDJSON | first line `hello` | nothing read further | `400 NDJSON_INVALID` |
| Too large | 11 MB with defaults | refused unread | `400 IMPORT_FILE_TOO_LARGE`, `maxSize` 10 |
| Too many rows | `SURE_IMPORT_MAX_ROWS=2`, 3 lines | refused | `400 IMPORT_TOO_MANY_ROWS`, `max` 2 |
| Missing reference | `Transaction` on an absent `account_id` | preflight error, start disabled | « Ligne 4 : Transaction référence un account_id manquant ("x"). » |
| Soft reference | `RejectedTransfer` side absent | warning, row skipped | none |
| Name exists | category « Courses » in file and base | reused, warning rollup | none |
| Unknown subtype | Depository `hsa` | preflight error naming the line | `invalid_import_record` |
| Import with an error | preflight error, import posted anyway | nothing written | `400 SURE_IMPORT_INVALID` |
| Split | parent with two lines | parent excluded, two children | none |

</frozen-after-approval>

## Code Map

- `packages/data/money.ts` -- `parseDecimalAmount`, a decimal text into minor units, half away from zero (Spec Change Log).
- `packages/api/src/env.ts`, `index.ts`, `app.ts` -- the two limits into `AppDeps.sureImport`; the routes beside the other uploads in the body-limit exceptions.
- `packages/api/src/lib/errors.ts` -- `NDJSON_INVALID`, `IMPORT_FILE_TOO_LARGE`, `IMPORT_TOO_MANY_ROWS`, `SURE_IMPORT_INVALID`.
- `packages/api/src/services/sure-import-preflight.ts` (new) -- parsing, Sure's preflight, Archant's refusals, counts.
- `packages/api/src/services/sure-import.ts` (new) -- the two entry points, the transaction, taxonomy, recurring, budgets, rules.
- `packages/api/src/services/ledger/sure-import.ts` (new) -- accounts, transactions and splits, transfers, rejected transfers, securities, trades, prices and locks, valuations, the recompute.
- `packages/api/src/routes/sure-imports.ts` (new) -- the two routes.
- `packages/app/src/routes/_authed.settings.imports.tsx`, `_authed.settings.imports_.sure.tsx` (new), `components/SettingsNav.tsx`, `hooks/useSureImport.ts` (new), `locales/fr.json`.
- Tests: `packages/data/money.spec.ts`, `services/sure-import-preflight.spec.ts`, `services/sure-import.spec.ts`, `routes/sure-imports.spec.ts`, `env.spec.ts`; e2e `sure-import.spec.ts`.
- Docs: `docs/sure-parity.md`, `docs/deployment.md`, `docs/architecture.md` AD-23, `.env.example`, `AGENTS.md`.
- Implementation notes from the investigation:
  - `.oxlintrc.json` lets only `services/ledger/**` import the `entries`, `balances`, `transactions`, `transfers`, `rejected-transfers`, `entry-keys`, `taggings`, `trades`, `holdings` and `transaction-attachments` schemas: every write to them lives in `services/ledger/sure-import.ts`.
  - `ServiceDeps.db` may be a transaction: a service's own `deps.db.transaction(...)` then becomes a savepoint (`confirmImport` in `services/imports.ts` does this). `createRule`/`setRuleEnabled` in `services/rules.ts` can run on `{ ...deps, db: tx }`.
  - Never call `ingest`, `createTransaction`, `recordTrade`, `recordSnapshot`, `matchTransfer` or `splitTransaction` per line: each recomputes balances, and `ingest` applies rules and pairs transfers. Bulk-insert in chunks of `ROWS_PER_INSERT` (`services/ledger/shared.ts`), then `recomputeBalances(tx, account, oldestDate, timeZone)` once per new account (see `recomputeOnce` in `services/ledger/balances.ts`).
  - Ids are `crypto.randomUUID()`, times `Date.now()`, today `today(timeZone)` from `domain/dates.ts`.
  - The inverse mapping is `services/export.ts` (`SURE_ACCOUNTABLE_TYPES`, `sureSubtype`, `sureAmount`, `loanAccountable`, `creditCardAccountable`, `matcherHints`, `sureRule`, `tradeSecurity`, the swapped `expected_amount_min`/`max`, the `archant` keys), and `testing/sure-preflight.ts` lists Sure's shapes; read `parseAccountDetails` in `schemas/accounts.ts` for account details, `transferKindOf` in `domain/transfer-matching.ts`, `seriesKeyOf` in `domain/recurring/identifier.ts` (`normalizeLabel` in `domain/normalize-label.ts`), `insertRules` in `services/recurring/rules.ts`, `insertChildren` in `services/ledger/splits.ts`, `resolveSecurity`/`insertTrade` in `services/ledger/trades.ts`, `assertNameFree` in `services/names.ts`, `CATEGORY_ICONS`/`newCategory` in `@archant/data/category-presets`, `getReportingCurrency` in `services/settings.ts`, the private `refreshAfterImport`/`detectAfterImport` in `services/imports.ts` (export or mirror them).
  - A new upload route joins the `except([...])` list of the 64 KB body limit in `app.ts` with its own `bodyLimit`, as `POST /api/accounts/:id/imports` in `routes/accounts.ts`. Env values reach routes through `AppDeps` (see how `index.ts` builds it); give `sureImport` defaults so tests need not set it.
  - `useSignedInApp`, `ownDatabase`, `sendOwn` (`testing/app.ts`) and `exportArchive` (as `services/export.spec.ts` reads `all.ndjson`) build the round-trip test; `createTempDatabase` gives the second database.
- Sure, read-only, at `00dd977fb`: `app/models/sure_import.rb`, `app/models/sure_import/preflight.rb`, `app/models/family/data_importer.rb`, `app/controllers/imports_controller.rb#create_sure_import`, `app/controllers/import/uploads_controller.rb`, `app/views/imports/new.html.erb`, `app/views/import/uploads/show.html.erb`, `app/views/import/confirms/show.html.erb`, `app/views/imports/_ready.html.erb`, `app/views/imports/_success.html.erb`, `app/helpers/imports_helper.rb#dry_run_resource`, `config/locales/views/imports/fr.yml`, `config/locales/models/sure_import/preflight/fr.yml`.

## Tasks & Acceptance

**Execution:**
- [x] Vitest first, failing: `parseDecimalAmount`; the preflight's refusals and warnings, each with its line; the round trip of an Archant export (accounts, balances, transactions, splits, transfers, trades and holdings, valuations, categories reused, budgets, rules) into a new database; the routes' refusals (extension, first line, size, rows, viewer) and an import posted with a preflight error writing nothing.
- [x] Money helper, env, errors; preflight; ledger writer; service; routes.
- [x] Interface: section, sources, upload, confirm, success; locale strings.
- [x] Playwright: upload an archive, read the summary, start the import, see the new account.
- [x] Docs and `.env.example`.

**Acceptance Criteria:**
- Given « Réglages › Importations », when the administrator picks « Importer depuis Sure », then « Importer depuis l'export » takes one `.ndjson` or `.json` file and refuses one whose first line is not a JSON object with `type` and `data` with « Le fichier doit être un NDJSON valide avec au moins un enregistrement », within `SURE_IMPORT_MAX_ROWS`.
- Given an uploaded archive, when the preflight runs, then a missing reference is refused with « Ligne %{line} : %{type} référence un %{field} manquant (%{value}). », an advisory one is a warning, and « Confirmer votre importation » lists the counts under « Résumé de l'importation » with « Démarrer l'importation ».
- Given a confirmed archive, when it imports, then every kind is created in Sure's order in one transaction, names reused, amounts in integer minor units and Archant's sign, an account type Archant lacks refused naming its line.
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then Vitest imports an Archant export into a new database and finds the same accounts, balances and transactions and covers the preflight's refusals, and Playwright uploads an archive and reads the summary.

## Design Notes

Assumptions taken alone, each settled by Sure or by Archant's model:

- Nothing is stored between the preflight and the import: the page keeps the chosen file and sends it twice. Sure stores an `Import` with its blob so a background job can run it; Archant imports inside the request, as its file imports and the export, so a stored copy of every amount would only be one more place to protect. The import runs the preflight again, so a file changed in between is checked as it is.
- The sources live in a settings section, as Sure's « Importations » sits in its settings navigation; Archant has no import list yet, so the section shows the sources directly, the content of Sure's « Nouvelle importation » dialog. Stories 30.2 and 30.3 add their sources there.
- A reused category, tag or merchant keeps its own colour, icon and kind. Sure's `assign_attributes` overwrites them; in Archant a kind change would orphan the budget lines of an expense category, and a fresh household's 15 default categories would lose their French colours to an English archive's.
- `Balance` lines are not stored: Archant's balances are derived (AD-2), and Sure's own import recomputes them in the sync it runs afterwards.
- Occurrences, payments, price changes and match rejections are not written: AD-24 lets only `services/recurring/` write them, and the detection run after the import rebuilds occurrences and matches payments. Logged in `deferred-work.md`.
- An entry in another currency than its account's is refused rather than skipped: Archant keeps one currency per account (AD-6), and dropping it would leave a balance silently wrong.
- A rule with a condition Archant lacks is skipped rather than imported without it: a rule missing one condition matches more than it did.
- An imported transaction's label falls back to « Opération importée », Sure's « Imported transaction » in Archant's words.

## Spec Change Log

- 2026-10-17, review finding 7: the Boundaries say amounts round half to even; Sure's decimals are Postgres `numeric` and Ruby `BigDecimal`, which round half away from zero, so `parseDecimalAmount` rounds half away from zero. Decided alone, the owner being unavailable, on the rule that Sure settles it; the frozen line stands as written and this entry overrides it. Known-bad state avoided: an archive's `42.905` landing one cent away from Sure's. KEEP: every decimal read from its text, never through a float.
- 2026-10-17, review finding 11: `no_data_rows` is not implemented. Sure's `rows_count` counts every non-blank line, valid or not, so after `valid_ndjson_first_line?` accepts the first line it can never be zero; Archant's `checkFile` refuses the same files first. KEEP: the other line-parse findings in Sure's order.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `parseRecords` copies each type's array per line | high | patch | `[...recordsOf(parsed, type), …]` on every line: quadratic at 100,000 lines; now a push. |
| 2 | The parse holds the write lock | medium | patch | `readSureArchive` ran inside the immediate transaction; the archive is now read before it opens. |
| 3 | The series writes contradict AD-24's « only `services/recurring/` writes » | medium | patch | `importRecurring` inserts series and rules; AD-24 now names the import as a writer of series and rules, as migration 0072 is. |
| 4 | A skipped rule leaves the categories, merchants or tags it created | medium | patch | `referenceId` created on read; names now resolve first, rows created once `ruleSchema` accepts the rule. |
| 5 | Skipped budgets, rules and transfers raise no warning, counts are the file's | low | reject | Sure's summary is `dry_run` line counts too, and its non-strict importer skips the same rows silently. |
| 6 | The error list is unbounded | low | patch | A broken 100,000-line file rendered 100,000 items; capped at 50 with the rest counted. |
| 6b | `skipped_missing_reference` is never shown | low | reject | Sure's `_ready` rolls up only merchant, unnamed-recurring and taxonomy warnings, as the page does. |
| 7 | Half-to-even rounding, said to be Sure's | low | patch | Sure's decimals are Postgres `numeric` and `BigDecimal`, half away from zero. |
| 8 | Taxonomy names compared untrimmed, imported trimmed | low | patch | « Food » and « Food  » merged without a finding; trimmed in `checkTaxonomy` too. |
| 9 | The round trip skips the `archant` keys and account details | medium | patch | `snapshotOf` now compares notes, institution, reference, pending, duplicate flag, origin, locks and activity label with non-default values. |
| 10 | Spec `in-review` while sprint status reads `in-progress`; `AGENTS.md` untouched | false | reject | Both move to `done` at the end of this pull request; `AGENTS.md` never said the export is not read back, `docs/deployment.md` did and changed. |
| 11 | `no_data_rows` unreachable | low | patch | `checkFile` refuses a file with no first record; code, string and code list removed. |
| 11b | `MULTIPART_OVERHEAD_BYTES` repeats a margin | low | reject | Two 64 KB margins on two routes; sharing one constant changes nothing a user meets. |
| 12 | `sure-import-preflight.ts` over 2,000 lines | low | patch | The plan readers moved to `services/sure-import-plan.ts`. |
| 13 | A holding's price stored as `provider` for a security typed by hand | low | reject | No fetch reaches a security without provider, and the next export writes the same price on its `Holding` lines. |
| 14 | No viewer test on `/settings/imports/sure` | low | reject | The settings route's `beforeLoad` sends a viewer from every section but « Sécurité », tested already. |
| 15 | A bad opening anchor drops its account silently | medium | patch | The account was skipped and its valuation never reported; now `invalid_import_record`. |
| 16 | A non-text `id` or `name` drops the account silently | low | patch | Required fields pass a number; now `invalid_import_record`. |
| 17 | A security in two currencies fails the import after a clean preflight | medium | defer | Logged in `deferred-work.md` at implementation; the preflight reads no stored security. |
| 18 | A series in another currency than its account | low | patch | AD-6; refused as entries are. |
| 19 | A transfer with reversed signs is stored reversed | medium | patch | Skipped as other refused pairs. |
| 20 | Several trades on one `parent_entry_id` | low | patch | The first takes it; a transfer side never does. |
| 21 | A dividend without security fails as a 500 | medium | patch | `trades_security_check`; refused in the preflight. |
| 21b | A dividend on a security not yet held | low | reject | Sure's importer writes it; only Archant's form checks. |
| 22 | An existing month keeps its currency | low | patch | The currency is written with the totals. |
| 23 | A null `learned_tolerance_pct` reads as 0 | low | patch | `Number(null)`; null, blank and non-numeric are absent. |
| 24 | Future-dated entries accepted | low | reject | Sure's importer accepts them; the ledger allows a transaction a year ahead. |
| 25 | No test posts more than 64 KB to the import | medium | patch | The body-limit exception had no test; added. |
| 26 | Detection after the import untested | medium | patch | Tests of a detected series and of a throwing `runRecurring`. |
| 27 | Budgets merge, currency and income lines untested | medium | patch | Added. |
| 28 | Unknown rule conditions and actions untested | medium | patch | Three Sure-format rules added. |
| 29 | Parameterised refusal messages not rendered in a test | low | defer | Logged in `deferred-work.md`. |
| 30 | `SURE_IMPORT_*` not wired end to end in a test | low | defer | Logged in `deferred-work.md`. |

Second pass, `bmad-code-review` (four layers) over the committed branch.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 31 | `accountable_type` `"constructor"` reads an inherited key and answers 500 | medium | patch | Plain-object lookup; now an own-key check, with a test. |
| 32 | One security in two currencies within the archive fails the import after a clean preflight | medium | patch | The plan now refuses the later line on `ticker`; a stored security in another currency still fails the import, now tested to write nothing. |
| 33 | No test of a write failing mid-transaction | medium | patch | Added with the stored-security conflict: no account, entry or category left. |
| 34 | Rounding and `no_data_rows` differ from the frozen Boundaries | low | reject | The fix would edit the spec; both decisions are recorded in the Spec Change Log, settled by Sure. |
| 35 | The deployment variables table misses the two limits | low | patch | Rows added. |
| 36 | No ceiling on `SURE_IMPORT_MAX_NDJSON_SIZE_MB` | low | reject | Sure sets none either; the owner raises it knowingly. |
| 37 | A non-UTF-8 file imports with replacement characters | low | patch | `TextDecoder` now `fatal`; `NDJSON_INVALID`. |
| 38 | Two account-less series with one key both stored | low | reject | SQLite's unique indexes let nulls repeat, and Sure has no such index: the import does not fail. |
| 39 | The page keeps the old summary after `SURE_IMPORT_INVALID` | low | reject | Only a file changed between the two posts reaches it; the toast says to upload again. |
| 40 | A second import duplicates every account | low | reject | Sure's importer does the same; `docs/deployment.md` says so. |
| 41 | A JSON number amount reads through a float and an exponent | low | reject | Sure's exporter writes decimal strings; a hand-built file with numbers gets a refusal naming the field. |
| 42 | A date far in the future writes a balance row per day | medium | patch | Entries past today + 366 days refused on `date`, as `ingest`'s `DATE_TOO_LATE`. |
| 43 | Future trades and `buyCostFits` | low | reject | The 366-day bound covers the date; `tradeAmount` already refuses an amount past the limit. |
| 44 | Anchor fallback dated 1899-12-31 | low | reject | Takes a line dated 1900-01-01; balances still compute. |
| 45 | Names and labels stored past their limits, a surrogate pair cut | low | patch | Cut by code points to the form's limits. |
| 46 | A blank `value_ref` name creates an empty-named row | low | patch | A blank operand is none, and the rule is skipped. |
| 47 | `createRule` throwing after `ruleSchema` accepted | low | reject | Its references were created or mapped just before; no path shown. |
| 48 | A huge `occurrence_count` | low | reject | Hand-edited files only; SQLite stores it without failing. |
| 49 | A lower-case budget currency skips the budget | low | reject | Sure's exporter writes ISO codes upper-case. |
| 50 | A refused transfer still counted in the summary | low | reject | Sure's summary counts lines too. |
| 51 | Rule conditions and action values not compared in the round trip | medium | patch | The snapshot now reads them, an amount condition and a category action included. |
| 52 | The duplicate-series skip untested | medium | patch | Two lines with one key import as one series. |
| 53 | The row limit counts only lines with `data` | false | reject | Sure's `ndjson_line_type_counts` requires `type` and the `data` key alike. |
| 54 | An unreadable series day or date dropped silently | low | patch | Now `invalid_import_record` on the field. |
| 55 | The anchor fallback reads `Balance` and `Holding` dates | false | reject | Sure's `oldest_import_entry_dates_by_account` reads exactly Balance, Transaction, Trade, Holding and Valuation. |

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all green, no tracked file changed after.
