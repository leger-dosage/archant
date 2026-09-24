---
title: 'Story 8.1: Create a categorisation rule'
type: 'feature'
created: '2026-09-23'
status: 'done'
baseline_commit: '5f8bdf2fefef6c5573de6a4feca87b984c0938d2'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every new transaction arrives « Sans catégorie », so the household categorises the same shops by hand each month (FR36, FR37, FR38).

**Approach:** Port Sure's `Rule`, `Rule::Condition` and `Rule::Action` for three conditions (label, amount, account), condition groups one level deep, and one « Catégorie » action. A `/regles` page lists, creates, edits, toggles and deletes rules; step 5 of `ledger.ingest` applies the enabled rules to the transactions that ingest created, with `origin: "rule"`.

## Boundaries & Constraints

**Always:**
- Tables follow Sure, names in snake_case: `rules (id, name null, enabled, effective_date null, created_at, updated_at)`; `rule_conditions (id, rule_id, parent_id null, position, condition_type, operator, value null)`; `rule_actions (id, rule_id, position, action_type, value)`. `rule_id` is set on sub-conditions too, so deleting a rule cascades to all of them. `value` is text, as in Sure: the label, the amount in minor units, or an account or category id.
- Closed lists live in `packages/data/rules.ts` and build the check constraints: condition types `transaction_name`, `transaction_amount`, `transaction_account`, `compound`; operators `like`, `=`, `>`, `>=`, `<`, `<=`, `!=`, `and`, `or`, with the allowed operators per type; action types `set_transaction_category`. Story 8.2 extends these lists.
- Label: both sides are trimmed and runs of whitespace collapsed; `like` compares lower-cased, `=` as is. Accents count, as with Sure's `ILIKE`. Evaluation runs in TypeScript in `domain/rules/`, never in SQL: SQLite's `LIKE` folds ASCII case only.
- Amount: typed as text, parsed by `parseAmount` in the reporting currency (`getReportingCurrency()`); negative refused with `invalid_amount`. It matches `abs(amount)` of transactions in the reporting currency only.
- Start date: a rule reaches transactions dated on or after `effective_date`; null reaches every date.
- Step 5 loads the enabled rules once per ingest call, ordered by `created_at`, then `id`, and runs them over the new rows, possible duplicates included. Each matching rule overwrites the category planned by earlier ones. The write goes through one ledger function that skips a locked `category`, sets `category_origin = 'rule'` and adds no lock. Story 8.3 reuses it.
- A dangling reference makes the rule inert, as in Sure: an account condition naming a deleted account matches nothing, and an action naming a deleted category writes nothing. The list shows « Compte supprimé » or « Catégorie supprimée ».
- API: `GET/POST /api/rules`, `PUT /api/rules/:id` replaces name, start date, conditions and actions, `PATCH /api/rules/:id` takes `{ enabled }`, `DELETE /api/rules/:id`. One service function per route. A new rule is enabled.
- Validation returns `fields`: `actions` `action_required`, `actions.N` `duplicate_action`, `conditions.N.conditions.M` `nested_group`, a missing or empty value on its `.value` path, and an unknown account or category `invalid_value`.
- The form is a dialog opened from the page, as Sure's modal. The page shows « Disponible sur ordinateur » below 768 px through `useMediaQuery`, as `ImportDialog.tsx` does.
- The summary follows Sure: the first top-level condition, or the first condition of a group, then the action, such as « Si Libellé contient CARREFOUR, alors Catégorie Courses », then « et N autres conditions » for the other top-level conditions. Without a condition: « Toutes les opérations, alors Catégorie Courses ».

**Never:** no application to existing transactions, no count preview and no run log (8.3); no other condition or action (8.2); no rule effect in the import preview (`dryRun` returns before step 4); no rule re-run when a transaction is edited; no reordering or sorting of rules; no raw SQL; no change to transfer matching.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Label contains | `like` « carrefour  city », label « CB CARREFOUR CITY 12/09 » | Categorised, origin `rule` | — |
| Label equals | `=` « Loyer », labels « Loyer » and « loyer » | Only « Loyer » | — |
| Amount | `>` « 50,00 », amounts −60,00 and +40,00 EUR | Only −60,00 | Negative value: `invalid_amount` |
| Other currency | `>` « 50,00 », −60,00 on a USD account | No match | — |
| Group any | Top `Compte est A`, group `or` [Libellé contient X, Montant = 10,00] | Matches on A when either holds | Group in group: `nested_group` |
| No condition | Rule with an action only | Every new transaction | — |
| Start date | `effective_date` 2026-09-01, lines 08-31 and 09-01 | Only 09-01 | — |
| Order | Rule 1 → Courses, rule 2 → Loisirs, both match | Loisirs | — |
| Disabled | Disabled rule matches | Category unchanged | — |
| Locked | Row with `category` in `locked_fields` | Unchanged, no write | — |
| Import | OFX import confirmed, rule matches 2 of 5 lines | Those 2 categorised | — |
| Bad form | No action / two category actions / empty value | — | 400 `VALIDATION_ERROR` with the field |
| Dangling | Rule's category deleted | Rule writes nothing | — |

</frozen-after-approval>

## Code Map

- `packages/api/src/services/ledger.ts` -- `ingest` 712; rows inserted at 843–875 (`rows`, one per created line, duplicates included); `// 5. Rules arrive with Epic 8.` at 905, before `matchNewTransfers` 908. `Origin` 81, `categoryOriginOf` 95, `changeOf` 1027 and `detailOf` 1052 hold the lock logic to reuse; `categoryExists` 1082. New rows never lock `category` (`filledFields` 423).
- Callers of `ingest`: `services/transactions.ts` `createTransaction` 248 (no category on creation), `services/imports.ts` preview 241 (`dryRun`) and confirm 387.
- `packages/api/src/domain/normalize-label.ts` -- `normalizeLabel` strips accents and lowercases, so it is not the rule comparison; add a whitespace-only helper beside it.
- `packages/data/schema/transactions.ts`, `categories.ts` (`CATEGORY_ORIGINS`), `check.ts` (`inList`); ids are `crypto.randomUUID()` text, timestamps ms integers. Last migration `0020`; `pnpm --filter @archant/data generate --name add_rules`. `migrate.spec.ts` `migrated()` 31.
- CRUD model: tags. `routes/tags.ts`, `schemas/tags.ts`, `services/tags.ts`, `app.ts` 61 (keep the chained `.route`), `app.spec.ts` `describe("tags")` 4140. `lib/errors.ts`, `lib/zod-error.ts` (`validationError`; a refinement's message becomes its code). Reporting currency: `getReportingCurrency()`, used in `services/accounts.ts` 97.
- Web: `components/AppSidebar.tsx` (entry after Opérations), `lib/shortcuts.ts` `SHORTCUTS` (`g>u` free) + `shortcuts.spec.ts` 74, bindings in `routes/_authed.tsx` 50, `components/CommandPalette.tsx` 96. Page model `routes/_authed.reglages.etiquettes.tsx` (row menu 36, `ConfirmDialog` 145), `hooks/useTags.ts`. Form parts: `CategoryCombobox`, `DateField`, `ui/select`, `ui/switch`, `react-hook-form` `useFieldArray`; `lib/form-errors.ts` `applyFieldErrors` needs the dynamic paths listed. Narrow screen: `ImportDialog.tsx` 58/700, `imports.mobile`. `locales/fr.json` `errors.fields` feeds `FieldErrorCode`.
- E2E: `packages/web/e2e/fixtures.ts` `apiHelpers` 159 (`openAccount`, `addTransaction`, `createCategory`, `importFile`), `tags.spec.ts` as model, narrow-screen assertion `import-ofx.spec.ts` 245.
- Coverage: `packages/api/vitest.config.ts` holds `src/domain/**` and `ledger.ts` at 100 %.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/rules.ts`, `schema/rules.ts`, `types.ts`, `migrate.spec.ts`, `drizzle/0021_*` -- failing test that the tables exist and a rule's deletion cascades, then lists, tables, derived types, generated migration.
- [x] `packages/api/src/domain/rules/*.spec.ts`, `domain/rules/*.ts`, `domain/normalize-label.ts` -- failing matrix tests, then the pure evaluator: `matches(rule, candidate, reportingCurrency)` and the planned category per row, in order.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- step 5 and the exported lock-respecting category writer, tested with a locked row, a disabled rule and a dangling category.
- [x] `packages/api/src/schemas/rules.ts`, `services/rules.ts`, `services/rules.spec.ts`, `routes/rules.ts`, `app.ts`, `lib/errors.ts` -- CRUD, validation codes, the enabled-rules loader that step 5 calls.
- [x] `packages/api/src/app.spec.ts` -- `describe("rules")`: CRUD, every validation case, manual creation and OFX import categorised through a rule.
- [x] `packages/web/src/lib/rule-summary.ts` + spec, `hooks/useRules.ts`, `components/RuleDialog.tsx`, `routes/_authed.regles.tsx`, `AppSidebar.tsx`, `lib/shortcuts.ts`, `CommandPalette.tsx`, `locales/fr.json` -- page, form, summary, switch, menu, confirmation, narrow screen, `nav.rules`, `goRules`, new `errors.fields` codes.
- [x] `packages/web/e2e/rules.spec.ts` -- one test per criterion below.

**Acceptance Criteria:**
- Given the sidebar or `g u`, when I go to « Règles », then `/regles` opens with « Aucune règle pour l'instant. » and « Ajouter une règle ».
- Given the form, when I save « Libellé contient carrefour » → « Courses », then the row reads « Si Libellé contient carrefour, alors Catégorie Courses », with its switch on; a transaction « CB CARREFOUR » added next shows « Courses ».
- Given a rule with three top-level conditions, when the list shows, then its summary ends with « et 2 autres conditions »; a named rule shows its name.
- Given a rule switched off, when a matching transaction is added, then it stays « Sans catégorie ».
- Given « Supprimer » in a rule's menu, when I confirm, then the rule leaves the list; « Modifier » reopens the form filled in, and saving updates the summary.
- Given the form with an empty condition value or no action, when I save, then the faulty field shows its message and nothing is saved.
- Given a 375 px wide viewport, when I open `/regles`, then « Disponible sur ordinateur » shows.

## Implementation Notes

- The spec's operator list left `!=` unassigned; the first pass gave it to the account. The story gives « ≠ » to « Montant » and « est » only to « Compte », as Sure's number and select filters do, so review moved it and migration `0021` was regenerated.
- The label `=` reads « est égal à », as the story writes it.
- Adding any key to `fr.json` hit TS2589 in `ImportHistory.tsx`; its local `TFunction` alias now imports i18next's type.
- `CategoryCombobox` gained `allowNone` to hide « Sans catégorie » in the rule action.
- The form offers one action; `duplicate_action` and `nested_group` are reachable through the API only and tested there.
- Test suites sharing a database delete every rule after each test (`deleteRules` fixture), so a rule never reaches another test's transactions.
- `lib/errors.ts` is unchanged: the new codes are field codes under `VALIDATION_ERROR`.
- A standards and spec review after the BMAD review renamed the start-date field « À partir du », as the story names it, typed `COMPARE` in `MinorUnits`, and gave `setRuleCategories` its `{ origin: "rule" }` option (AD-2). Kept as is: the comma before « et N autres conditions », which reads as French, and a summary that starts « Toutes les opérations » when the first condition is an empty group.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind, edge, verification-gap | A rule categorises a line that step 6 then pairs as a transfer, where bulk edit refuses to categorise a transfer side | low | rejected: AD-4 fixes rules at step 5 before matching; a categorised line matched later keeps its category too, and a loan-payment outflow counts by its category (AD-9) |
| 2 | blind | Two rules created in the same millisecond order by random id | low | rejected: two saves in one millisecond cannot come from the form |
| 3 | blind | Amount stored without its currency; a future reporting-currency setting would rescale it | medium | defer: `getReportingCurrency()` is a constant today |
| 4 | blind, edge | Form shows « Choisir un compte » for a deleted account | low | patch: « Compte supprimé » as the trigger text |
| 5 | blind | No test of a positive amount above the threshold | medium | patch: +60,00 with `> 50,00` in matching and ledger specs |
| 6 | blind, verification-gap | Amount form round trip untested; a regression multiplies the threshold by 100 on re-save | medium | patch: e2e reopen and re-save |
| 7 | blind | `rules.ts` comment claims the database refuses what the API does | low | patch: comment narrowed to type and operator checks |
| 8 | blind | 50 groups of 50 conditions allowed | low | rejected: unreachable through the form, one household |
| 9 | blind | `like` does not treat `%` and `_` as wildcards like `ILIKE` | low | rejected: literal contains is what the story asks; the Sure reference in the comment concerns accents |
| 10 | blind | A rule overwrites a provider or file category | false | no connector sets a category on a new line today |
| 11 | blind, verification-gap | Size limits, invalid start date and clearing the start date untested | low | patch: rows in `refuses %s with the field`, one `PUT` clearing the date |
| 12 | blind | `loadEnabledRules` reads every account and category id per ingest | low | rejected: a household holds tens of each |
| 13 | blind | Dialog can close while saving | low | rejected: same as every other dialog of the interface |
| 14 | blind | `NOT_FOUND` table has an unused `body` column; invalid `PUT` on unknown id answers 400 | low | patch: column dropped; 400 before 404 matches the other routes' validator order |
| 15 | edge | Over 50 conditions blocks submit with no visible message | low | rejected: unreachable in practice |
| 16 | edge | A non-numeric stored amount throws inside `ingest` | false | only the validated service writes `value`, always `String(parseAmount(...))` |
| 17 | edge | A malformed rule blocks all ingestion | false | same as 16 |
| 18 | edge | A non-numeric amount crashes the page render | false | same as 16 |
| 19 | edge | Sub-conditions on a non-group condition are dropped silently | low | rejected: neither the form nor the typed client sends them |
| 20 | edge | `toLowerCase` changes length on « İ » | low | rejected: French labels |
| 21 | edge | Task list names `lib/errors.ts`, unchanged | low | rejected: noted in Implementation Notes |
| 22 | verification-gap | No test of a possible duplicate receiving the rule's category | medium | patch: ledger case with `category_origin = 'rule'` |

## Design Notes

Taken from Sure rather than asked: table shape and `value` as text, operator names, whitespace normalisation, case rules, `abs(amount)`, `effective_date` as « on or after », empty conditions and empty groups matching everything, one level of groups, no duplicate action types, the summary built from the first condition, and inert rules on dangling references. Departures, beyond the three Epic 8 names: amount conditions match the reporting currency only, because minor units mean different amounts across currencies and Archant has no exchange rates (AD-6); `position` columns keep the form's order, where Sure sorts by `created_at`.

Step 5 sketch:

```ts
const planned = planCategories(enabledRules, candidates, reportingCurrency); // Map<entryId, categoryId>
await setRuleCategories(tx, planned, now); // skips locked rows and unknown categories
```

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.
