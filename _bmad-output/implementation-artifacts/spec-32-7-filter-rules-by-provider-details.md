---
title: "Story 32.7: Filter rules by provider details"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'aed2a83ee652077935040869975161831161f08a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) keeps what a provider sends beside a line in `transactions.extra`, JSONB: `EnableBankingEntry::Processor#extra` writes `{ enable_banking: { fx_rate, fx_unit_currency, fx_instructed_amount, merchant_category_code, pending } }`, compacted, nil when empty, and `Account::ProviderImportAdapter#apply_provider_extra` deep-merges it on every import, `clear_pending_flags_from_extra` dropping `pending` once the line is booked. `Rule::ConditionFilter::TransactionDetails` (`transaction_details`, label `key.humanize`, no French key) offers « Contient » (`like`), « Égal à » (`=`) and « Est vide » (`is_null`): the first two search the string and number values at any depth (`jsonb_path_query(extra, 'strict $.**')`, `jsonb_typeof IN ('string', 'number')`), `ILIKE` and `LIKE` with `%value%`, never a key nor `true`/`false`/`null`; « Est vide » matches `extra IS NULL OR extra = '{}'`. Archant stores none of it, has no such condition, and skips a Sure archive's details rule as unsupported.

**Approach:** a nullable JSON column `transactions.extra`, typed `TransactionExtra`. The Enable Banking schema parses `exchange_rate` and `merchant_category_code` with Zod; `toTransaction` builds Sure's `extra` on `NormalizedTransaction.extra`; the ingest writes it on insert and merges it, as Sure, on an absorbed pending entry and on a known line read again. A new condition type `transaction_details` with operators `like`, `=`, `is_null` joins `@archant/data/rules.ts`; migration 0098 adds the column and rebuilds `rule_conditions`' checks. The evaluator walks the parsed JSON in TypeScript, where every rule runs (epic decision), with Sure's semantics. The form, the summary, the assistant and the Sure import learn the type.

## Boundaries & Constraints

**Always:**
- Stored shape: `{"enable_banking":{…}}` with only the keys present: `fx_rate`, `fx_unit_currency`, `fx_instructed_amount` when the bank sends `exchange_rate`, `merchant_category_code` when it is not blank, `pending: true` for a `PDNG` line; `null` when none. Each value is the bank's string, trimmed, dropped when blank, not a string or over 64 characters.
- Merge on an existing entry (absorbed or present): the stored keys, `pending` dropped when the line is booked, overwritten by the line's; `null` when nothing is left.
- « Contient »: any string or number value at any depth contains the condition's value, case ignored (`toLowerCase`, as `ILIKE`). « Égal à »: the same, case kept (Sure's `LIKE '%v%'`). Neither reads a key or a boolean. « Est vide »: `extra` null or `{}`.
- A line typed by hand, imported from a file or a Sure archive, or split, has `extra` null.
- Values never reach a log, an error or an API response.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no `json_tree` SQL filter (rules run in TypeScript); no display of the details in the transaction drawer; no new dependency; no other provider namespace.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card in dollars | `exchange_rate: {exchange_rate: "1.0849", unit_currency: "USD", instructed_amount: {amount: "54.25"}}`, `merchant_category_code: "5411"` | `extra` holds the four keys | none |
| Pending | `status: "PDNG"`, no exchange rate, no MCC | `{"enable_banking":{"pending":true}}` | none |
| Nothing | booked, no exchange rate, MCC `""` | `null` | none |
| Odd field | `merchant_category_code: 5411` (number) | dropped, line kept | none |
| Booked absorbs pending | stored `{pending, mcc}`, booked line with MCC | `{mcc}` | none |
| Contient | value `usd`, `fx_unit_currency: "USD"` | matches | none |
| Égal à | value `usd` | no match; `USD` matches | none |
| Key only | value `merchant` | no match | none |
| Boolean | value `true`, `pending: true` | no match | none |
| Est vide | `null` | matches; `{"enable_banking":{…}}` does not | none |
| Hand-typed line | `extra` null, « Contient » `5411` | no match | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/rule/condition_filter/transaction_details.rb`, `app/models/rule/registry/transaction_resource.rb` (order), `app/models/enable_banking_entry/processor.rb#extra`, `app/models/enable_banking_item/importer.rb` (`_pending`), `app/models/account/provider_import_adapter.rb` (`apply_provider_extra`, `clear_pending_flags_from_extra`).
- Data: `packages/data/schema/transactions.ts` (`extra`, `TransactionExtra`), `packages/data/rules.ts`, migration `0098` through `pnpm data generate`, `migrate.spec.ts`.
- Connector: `connectors/enable-banking/schemas.ts` (`exchange_rate`, `merchant_category_code`), `client.ts` (`toTransaction`), `domain/statement.ts` (`NormalizedTransaction.extra`), `client.spec.ts` with a fixture line.
- Ledger: `domain/transaction-extra.ts` (`mergeExtra`), `services/ledger/ingest.ts` (insert, present lines, rule candidates), `services/ledger/pending.ts` (`absorb`), `services/ledger/rule-plans.ts` (`ruleCandidates`); `ingest.spec.ts`.
- Rules: `domain/rules/matching.ts` (`DetailsCondition`, `RuleCandidate.extra`), `services/rule-reader.ts`, `schemas/rules.ts` (length cap), `schemas/assistants/rules.ts`; `matching.spec.ts`, `routes/rules.spec.ts`, `services/sure-import.spec.ts`, `services/csv-import.spec.ts` (their « unsupported » example moves to `set_investment_activity_label`).
- Interface: `lib/rule-form.ts` (`LEAF_TYPES`), `lib/rule-summary.ts`, `locales/fr.json` (« Détails bancaires »); `rule-summary.spec.ts`; e2e `packages/app/e2e/rules.spec.ts`.
- Docs: `docs/sure-parity.md` rows « Conditions » and « Operators ».

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `client.spec.ts` details from a fixture line; `transaction-extra.spec.ts`; `matching.spec.ts` each operator, nested values, a key, a boolean, a null `extra`; `ingest.spec.ts` insert, absorb and present merge; `routes/rules.spec.ts` save and refused operator; `migrate.spec.ts` 0098; `rule-summary.spec.ts`; `sure-import.spec.ts` imports a details rule.
- [x] Data: column, condition type, migration.
- [x] Connector and ledger: parse, build, write, merge.
- [x] Rules: evaluator, reader, schemas, assistant.
- [x] Interface: field, operators, summary; e2e saves a details rule.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given an Enable Banking line with an exchange rate and a merchant category code, when a sync writes it, then `transactions.extra` holds them under `enable_banking`.
- Given the rule form, when « Détails bancaires » is picked, then the operators are « Contient », « Égal à », « Est vide ».
- Given a rule « Détails bancaires contient 5411 », when a synced line carries MCC `5411`, then it matches, and a hand-typed line does not.
- Given the list, then the rule reads « Si Détails bancaires contient 5411, alors … ».

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The condition is named « Détails bancaires », the story's wording; Sure's label is `key.humanize`, « Transaction details », untranslated.
- It sits after « Étiquette » and before « Notes » in the field menu, as in Sure's `CONDITION_FILTER_CLASSES`.
- « Égal à » is a case-sensitive « contains », as Sure's own comment says, not a whole-value equality.
- Evaluated in TypeScript over the parsed JSON, not with SQLite's `json_tree`: every condition runs in `matching.ts` (epic technical decision), and the walk keeps Sure's `strict $.**` and `jsonb_typeof` semantics. A number reads as JavaScript prints it; Enable Banking sends every one of these values as a string.
- A sync merges the details on an entry it reads again, as Sure's `apply_provider_extra` on every import, so lines already stored before the upgrade get their details at the next sync inside its window. Sure skips that refresh on a user-modified entry; Archant refreshes every entry, since nothing lets the user edit `extra`.
- Each value is capped at 64 characters: the bank is not trusted (security), and Enable Banking's fields are short codes and decimals.
- The details are not shown in the transaction drawer, where Sure's « Détails supplémentaires » prints them raw: the story asks for the rule condition only, and the frozen boundary keeps them out of every API response. Deferred.
- Upgrade: no stored rule changes. Synced lines older than the next sync's window keep `extra` null, so only « Est vide » matches them. A Sure archive's details rule, skipped until now, imports.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated snapshot and the planning files; no second `bmad-code-review` pass over the same diff. Implemented in the main session rather than a sub-agent, to keep usage low.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A pending line found on a booked entry (`present`) merged `pending: true` back into its details | high | patch | `groupLines` puts the bank's old pending copy of a booked entry in `present`; `refreshDetails` now skips pending lines. `sync.spec.ts` lists the old copy again after booking, and fails without the guard. |
| 2 | A bank line matched by content to an existing entry (`matched`) got no details | medium | patch | `refreshDetails` runs on `present` and `matched`. |
| 3 | No test runs a details rule on lines a sync creates | medium | patch | `ingest.spec.ts` syncs one line with MCC 5411 and one without: each gets its rule's category. |
| 4 | The assistant's `create_rule` with a details condition is untested | medium | patch | `mcp/server.spec.ts` creates and reads one, field by field. |
| 5 | The parity row says the pending flag is searched | low | patch | Reworded: not searched, but makes the details not empty. |
| 6 | `docs/security-model.md` still says no bank answer is kept | low | patch | It names what `transactions.extra` keeps. |
| 7 | Two comments overflow their width | low | patch | Rewrapped in `pending.ts` and `rules.ts`. |
| 8 | The details are shown nowhere, so the owner cannot read a code | medium | defer | Sure prints `extra` raw in its drawer; the story asks for the condition only and the spec keeps `extra` out of API responses. `deferred-work.md`. The Design Notes claim that Sure shows none was false and is corrected. |
| 9 | « Égal à » finds `5411` inside `54110` | false | reject | Sure's own `LIKE '%value%'`, recorded in the Design Notes. |
| 10 | Split lines of a bank line have no details | low | reject | Sure's `Entry#split!` builds each child `Transaction.new` without `extra`. |
| 11 | The archive leaves `extra` out | low | reject | Sure's `Family::DataExporter` never writes it; the reason names the lines the next sync reads. |
| 12 | Two present lines on one entry merge from a stale value | low | reject | Only booked lines refresh now, and two booked lines on one entry need a shared fingerprint without reference; the later merge still holds every key. |
| 13 | A booked line without details keeps a stored `pending` | false | reject | A booked entry only holds `pending` in its details through finding 1, now fixed; `absorb` clears it on booking. |
| 14 | Another top-level namespace would be dropped by `mergeExtra` | false | reject | Only Enable Banking writes `extra`; `TransactionExtra` has no other key. |
| 15 | A number reads as JavaScript prints it, not as its JSON text | low | reject | Enable Banking sends strings; recorded in the Design Notes. |
| 16 | `rules.csv` round trip of a details rule is untested | low | reject | Export and import of conditions are generic over the type; the Sure import test covers the mapping. |
| 17 | `absorb` reads `extra` in a second query | low | reject | One indexed read per absorbed line; `transactionRow` feeds edits that must not return `extra`. |
| 18 | `ingest.spec.ts` was not touched for insert and absorb | low | patch | Insert and absorb are covered end to end in `sync.spec.ts`; the rule test of finding 3 is in `ingest.spec.ts`. |
