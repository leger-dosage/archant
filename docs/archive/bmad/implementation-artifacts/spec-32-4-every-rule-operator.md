---
title: "Story 32.4: Every rule operator"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'b16de536144cbff34d9685bbc6ef7d30f554c2c0'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`, #2529 `9714612bb`) gives a text condition `OPERATORS_MAP["text"]` (`like`, `not_like`, `=`, `!=`, `is_null`, `is_not_null`) and a select condition `OPERATORS_MAP["select"]` (`=`, `!=`, `is_null`, `is_not_null`), labelled by `rules.condition_filters.operators` (« Contient », « Ne contient pas », « Égal à », « Différent de », « Est vide », « N'est pas vide »); `not_like` adds `OR field IS NULL`, `!=` is `IS DISTINCT FROM`, and `VALUELESS_OPERATORS` (`is_null`, `is_not_null`) take no value. Archant's label offers `like` and `=` only, notes add `is_null`, merchant, category and tag `=` and `is_null`, account `=` only, and the menu shows the summary's lowercase words.

**Approach:** `RULE_OPERATORS` gains `not_like` and `is_not_null`; `RULE_OPERATORS_BY_TYPE` gives label and notes Sure's text list, merchant, category and account Sure's select list, and keeps tag (`=`, `is_null`, the two `transaction_tag.rb` applies), type (`=`) and amount; `VALUELESS_RULE_OPERATORS` with `isValuelessOperator` replace every `=== "is_null"`. A migration rebuilds `rule_conditions` with the new checks. The evaluator, the API and assistant schemas, the Sure archive and CSV imports, the form menu and the summaries follow.

## Boundaries & Constraints

**Always:**
- Text (squished as today): `like` contains, case aside; `not_like` is a null field or not `like`; `=` the whole text, case included; `!=` a null field or not `=`; `is_null` null; `is_not_null` not null.
- Select: `=` the same id; `!=` any other value, null included; a deleted merchant, category or account matches every row under `!=`, as no row carries its id in Sure; `is_null` none set; `is_not_null` one set. An account is never null, so `is_null` matches nothing and `is_not_null` everything, as Sure's `entries.account_id`.
- A valueless operator stores `null`; any value sent with it is ignored, as `is_null` is today.
- The menu shows Sure's capitalised words for text, select and type conditions (« Égal à » for type, `transaction_type.equal_to`); the rule summary keeps Archant's lowercase sentence: « ne contient pas », « est différent de », « n'est pas », « n'est pas vide ».
- The migration keeps every rule, condition and sub-condition.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no `!=` or `is_not_null` on a tag (Sure's `TransactionTag#apply` raises on them); no change to amount operators or their labels (Story 32.5); no SQL evaluation; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Label does not contain | `not_like` « carte », label « CARTE 12 » / « VIR » | no match / match | none |
| Notes does not contain | `not_like` « x », notes `null` | match | none |
| Notes not equal | `!=` « a », notes `null` / « a » / « b » | match / no / match | none |
| Notes not empty | `is_not_null`, notes `null` / « a » | no / match | none |
| Category not equal | `!=` C, row uncategorised / C / D | match / no / match | none |
| Merchant not empty | `is_not_null`, merchant `null` / M | no / match | none |
| Deleted category | `!=` deleted id | every row matches | none |
| Account is empty | `is_null` | nothing matches | none |
| Tag not equal | `!=` on `transaction_tag` | nothing written | `400` `operator` `invalid_value` |
| Valueless | `is_not_null` with value « x » | stored `null` | none |
| Upgrade | existing conditions | kept unchanged | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/rule/condition_filter.rb`, `condition_filter/transaction_{name,notes,merchant,category,account,tag,type}.rb`, `app/models/rule/condition.rb`, `config/locales/views/rules/fr.yml` (`condition_filters.operators`).
- Data: `packages/data/rules.ts` (`RULE_OPERATORS`, `RULE_OPERATORS_BY_TYPE`, new `VALUELESS_RULE_OPERATORS`, `isValuelessOperator`), `schema/rules.ts` comment, a migration after `0094` through `pnpm data generate`, `migrate.spec.ts`.
- API: `domain/rules/matching.ts` (text and reference conditions), `services/rule-reader.ts` (`toLeaf`: `id` read for `=` and `!=`), `schemas/rules.ts` (`checkLeaf`, `storedValue`), `schemas/assistants/rules.ts` (operator descriptions), `mcp/rules.ts` (value description), `services/sure-rules.ts` (`conditionOf`), `testing/sure-preflight.ts`; their specs.
- Interface: `components/RuleConditionRows.tsx` (menu labels, value hidden for both valueless), `lib/rule-summary.ts` (`OPERATOR_KEYS`, valueless summary), `locales/fr.json` (`rules.operators`, new `rules.operatorLabels`).
- e2e: `packages/app/e2e/rules.spec.ts` (menu lists at line ~289, a new « Ne contient pas » rule).
- Docs: `docs/sure-parity.md` row « Operators ».

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `matching.spec.ts` for each new operator on filled and empty fields, deleted references, account; `migrate.spec.ts` checks and the rebuild; `routes/rules.spec.ts` or `schemas` refusal of tag `!=` and valueless storage; `rule-summary.spec.ts`; Sure import of `not_like`.
- [x] Data: lists, valueless helper, migration.
- [x] API: evaluator, reader, schemas, assistant, Sure import, preflight.
- [x] Interface: menu words, valueless value field, summaries, locale; e2e.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given a « Libellé » or « Notes » condition, when the owner opens its operator menu, then it lists « Contient », « Ne contient pas », « Égal à », « Différent de », « Est vide », « N'est pas vide ».
- Given « Marchand », « Catégorie » or « Compte », then the menu lists « Égal à », « Différent de », « Est vide », « N'est pas vide »; « Étiquette » lists « Égal à », « Est vide »; « Type » lists « Égal à ».
- Given « Est vide » or « N'est pas vide », then the value field hides.
- Given a saved rule « Libellé » « Ne contient pas » X, then the list reads « Si Libellé ne contient pas X, alors … ».

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The menu takes Sure's words, while the summary keeps Archant's sentence: Sure's summary prints the raw operator (`_rule.html.erb`), which is no French.
- Amount keeps its symbols in the menu, as the frozen intent says; the parity row records the difference and `deferred-work.md` holds Sure's number words.
- A deleted reference under `!=` matches every row, as `IS DISTINCT FROM` a value no row holds.
- An account condition gets the select list, as Sure's `TransactionAccount` is a select; its empty operators are inert or total, as in Sure.

- Implemented in this session rather than by a separate implementation agent, the investigation being already in context.
- The rule summary of a deleted reference under `!=` reads « n'est pas Marchand supprimé », the existing deleted name, and matches every row as in Sure.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated snapshot and the planning files; no second `bmad-code-review` pass over the same diff.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `create_rule` now takes a label or account condition without a value, untested through the assistant | medium | patch | `mcp/server.spec.ts` creates and reads `is_not_null` on the label, `not_like` on notes and `!=` on a merchant, and checks the tool lists `not_like` and `is_not_null`. |
| 2 | The parity row said « Parity » while the amount menu kept symbols, where Sure shows words | medium | defer | The row now says « Later » for the amount's words, which the frozen intent leaves out; recorded in `deferred-work.md`. |
| 3 | A tag condition typed with `!=` would evaluate as `=` | low | patch | Unreachable through the checks, but the evaluator type now gives a tag only `=` and `is_null`, and the reader builds it apart. |
| 4 | `MENU_KEYS` was `Partial`, losing exhaustiveness | low | patch | Both menu maps now `satisfies` a full record of their type's operators. |
| 5 | Stale comment on `OPERATOR_KEYS`; preflight header cites one Sure commit | low | patch | Comment lists the new words; the header names `00dd977fb` for rule operators. |
| 6 | A merged or deleted merchant makes a `!=` condition match every row | low | reject | Sure's `IS DISTINCT FROM` a value no row holds does the same; recorded in Design Notes. |
| 7 | « Est vide » on the label or the account never matches, « N'est pas vide » on the account always | low | reject | Sure offers the same lists on the same never-null columns. |
| 8 | A Sure rule with a tag `!=` or an account missing from the archive is skipped silently | low | reject | The importer's existing contract for any condition Archant cannot hold, tested since Story 30.7. |
| 9 | No CSV rule import test for the new operators | low | reject | `csv-import-rules.ts` goes through the same `conditionOf` and `ruleSchema` the archive test covers. |
| 10 | No e2e test of a `!=` saved through a reference picker | low | reject | Unit tests cover the summary and the reader; the form path is the existing picker. |
| 11 | No test of the summary of a deleted reference under `!=` | low | reject | It reuses the deleted-name path already tested for `=`. |
| 12 | The 0095 test does not prove cascades and indexes survive | false | reject | « deletes a rule's conditions, sub-conditions and actions with it » runs on the fully migrated database. |
| 13 | `sure-rules.ts` switch to `isValuelessOperator` is unobservable | false | reject | Noted by the verification layer as no gap; kept for one source of truth. |
