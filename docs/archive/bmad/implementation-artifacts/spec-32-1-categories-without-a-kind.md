---
title: "Story 32.1: Categories without a kind"
type: 'feature'
created: '2026-10-23'
status: 'done'
baseline_commit: '4b5ca41cf1f9dd93f13daab7df7366079ee19c3a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure dropped the income or expense classification of categories in #1160 (`e1ff6d46e`, migration `remove_classification_from_categories`): `categories/index.html.erb` shows one list, `categories/_form.html.erb` has no « Classification », `Budget#sync_budget_categories` gives every category of `family.categories` an envelope, `Category#inherit_color_from_parent` is the only thing a subcategory takes from its parent, and the assistant's `create_category` and `get_categories` neither take nor return a kind. Archant still stores `categories.kind` under `categories_kind_check`, groups « Réglages › Catégories » into « Revenus » and « Dépenses », offers a « Type » field, builds envelopes for `kind === "expense"` only (`budgetCategories` in `domain/budgets/categories.ts`), refuses an amount, a move or a rollover switch on an income category (`services/budgets.ts`, `mcp/budgets.ts`), and skips an imported budget line on one (`services/sure-import.ts`). A category that earns but also spends counts in the budget's spending with no envelope to hold it (`deferred-work.md`, spec 27.6).

**Approach:** Migration `0092_categories_without_kind` rebuilds `categories` without `kind` and its check. `CATEGORY_KINDS`, `CategoryKind` and `newCategory`'s kind leave `@archant/data/category-presets.ts`; every reader and writer of the kind goes: schemas, the categories service (a child keeps only its parent's colour), CSV and Sure imports, rule imports, sample data, defaults, export, reports, names, budgets and the assistant tools. The settings page shows one list, « Catégories », and the form no « Type ». Every category takes an envelope; the budget writes refuse only an unknown category.

## Boundaries & Constraints

**Always:**
- The migration keeps every category, its parent, its lines and its envelopes; the rebuilt table keeps its case-folded unique name and its restricted parent.
- A client or an archive that still sends a kind or a `classification` beside its fields is accepted and the field ignored, as Zod strips it and Sure's importer defaults it.
- A row's side stays its sign (AD-9); nothing reads a category to decide income or expense.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no change to Sure's other budget rules (Story 35.2); no change to the defaults' names or count, no « Supprimer tout » or « Restaurer les catégories par défaut » (Story 32.2); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Migration | income categories, a child of one, a line and an envelope on them | every row kept, no `kind` column, foreign keys sound | none |
| Create | `POST /api/categories` with `kind: "income"` | created, no `kind` in the answer | none |
| Envelope | a category that earns 2 500 and spends 2 600 | an envelope that spent 100 | none |
| Budget write | an amount, move or switch on a former income category | saved | `404 NOT_FOUND` for an unknown id only |
| Copy, rollover inheritance | a former income category's row in the source month | copied or inherited as any other | none |
| Sure archive | a `Category` with `classification: "income"` and a `BudgetCategory` on it | category created, line imported | none |
| Assistant | `update_budget` on « Salaire » | saved | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `e1ff6d46e`: `db/migrate/20260308113006_remove_classification_from_categories.rb`, `app/models/category.rb`, `app/models/budget.rb` (`sync_budget_categories`), `app/views/categories/index.html.erb`, `_form.html.erb`, `app/models/family/data_exporter.rb`, `data_importer.rb`, `app/models/assistant/function/create_category.rb`, `get_categories.rb`.
- `packages/data/schema/categories.ts`, `category-presets.ts`, `drizzle/0092_categories_without_kind.sql`, `migrate.spec.ts`.
- `packages/api/src/schemas/categories.ts`, `services/categories.ts`, `services/budgets.ts`, `domain/budgets/{categories,rollover,moves}.ts`, `domain/cash-flow.ts`, `mcp/{categories,budgets}.ts`, `services/{csv-import,csv-import-transactions,sure-import,sure-import-plan,sure-rules,export,names,reports,default-categories,sample-data-plan}.ts`, `services/ledger/export.ts`.
- `packages/app/src/components/CategoryDialog.tsx`, `routes/_authed.settings.categories.tsx`, `locales/fr.json`.
- Docs: `docs/architecture.md` AD-9, `docs/sure-parity.md` « Categories », `docs/deployment.md` assistant tools.

## Tasks & Acceptance

**Execution:**
- [x] `migrate.spec.ts` -- the migration over income categories, a child, a line and an envelope.
- [x] Schema, presets, migration `0092`.
- [x] API: schemas, services, domain, imports, export, assistant tools; their specs.
- [x] Interface: one list, no « Type »; e2e of the page, the form and an envelope for a new category.
- [x] Docs, deferred work, story and sprint status.

**Acceptance Criteria:**
- Given an upgraded database, when it migrates, then `categories` has no `kind` and keeps every row.
- Given « Réglages › Catégories », when the owner adds or edits a category, then there is no « Type » and one list, « Catégories ».
- Given a budget month, when its envelopes are built, then every category has one.
- Given an assistant, when it calls `create_category`, `update_category` or `get_categories`, then none takes or returns a kind.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The column is dropped, not renamed to `classification_unused` as Sure's two-step migration: Archant has no rollback to serve, and nothing reads it.
- `all.ndjson` writes no `classification` on a `Category` line: Sure's importer reads `classification_unused || classification || "expense"`, so an Archant archive still imports into Sure.
- The empty list reads « Aucune catégorie pour l'instant », as the banks', merchants' and tags' empty lists, with « Ajouter une catégorie »; Sure's « Utiliser les valeurs par défaut » waits for Story 32.2, which restores defaults.
- The budget refusal for an unknown category keeps `404 NOT_FOUND`, its message now « No category has this id. »; the assistant's `update_budget` loses its « No budget row exists » refusal, every category holding a row as Sure's `sync_budget_categories` makes it.
- The rollover chain and a copied month treat a former income category as any other: Sure's `copy_from!` and rollover read every `budget_category`.

## Review Triage Log

Review by `bmad-code-review` (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor) on the diff without the Drizzle snapshot.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `reset.spec.ts`, `proportions.spec.ts` and `empty-states.spec.ts` still expect the « Revenus » and « Dépenses » groups and the « Type » field | high | patch | Rewritten on the one list and its empty state « Aucune catégorie pour l'instant », whose button opens the form without « Type ». |
| 2 | `budgets.allocation.noCategories` still says « Aucune catégorie de dépenses » | low | patch | « Aucune catégorie. Créez-en dans les réglages pour leur donner un budget. » |
| 3 | `docs/deployment.md` `get_budget`, `docs/sure-parity.md` « Budgets » and five comments still say « expense category » | low | patch | Each now says « category »; the parity row moves « an envelope for every category » out of Story 35.2's list. |
| 4 | A `PATCH` sending `kind` is untested | low | patch | `routes/categories.spec.ts` patches a name beside `kind` and gets no `kind` back. |
| 5 | A `PATCH` with `kind` alone answers `400 empty_patch` | low | reject | Nothing else is sent, so nothing would change; the constraint now reads « beside its fields ». |
| 6 | The merge test asserts `toMatchObject({})` | low | patch | It checks the target's id. |
| 7 | The rollover test's title names only the deleted category | low | patch | Retitled for both halves. |
| 8 | `update_budget`'s new test checks no exact answer | low | reject | `allocated_spending` of 50,00 € proves the row stored; the answer's shape is covered by the existing success test. |
| 9 | No route test inherits or copies a former income category's row | low | reject | No category has a kind left to tell it apart: the query lost its filter, and `copiedRows` and `rolloverChain` cover a category that earns. |
| 10 | « Sans catégorie » on track now shows beside any category | low | reject | Sure's « beside a category of its own », every category being one since #1160. |
| 11 | An archive without `classification` imported into a Sure before #1160 | low | reject | Archant targets Sure's current importer, which defaults it to `expense`. |
| 12 | The group's « Catégories » repeats the page title | low | reject | Sure's `index.html.erb` titles its one group `t(".categories")` under the page title « Catégories ». |
| 13 | Story 35.2's first criterion overlaps this story | low | reject | Its other criteria stand; planning is the owner's to trim. |
| 14 | Spec and sprint status disagree, empty triage log | low | patch | Both `done` in this pull request. |
| 15 | Three comments wrapped badly after the edits | low | patch | Rewrapped. |

