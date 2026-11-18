---
title: "Story 32.2: Sure's default categories, merged, deleted and restored"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'ed40c9177df55227a4aa8349aac873857343ccdc'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`afdac0a8c`) seeds 22 categories in `Category#default_categories`; Archant's `DEFAULT_CATEGORIES` holds 15. Sure's `categories/index.html.erb` has a page menu with « Fusionner les catégories », which merges several sources into one target through `Category::Merger` (transactions, budget lines added together, subcategories), and « Supprimer tout » behind a high-severity confirmation (`destroy_all`); its empty list and the category dropdown offer « Utiliser les valeurs par défaut (recommandé) » and « Générer les catégories par défaut », which run `Category.bootstrap!`. Archant merges one category at a time from its row, drops the source's budget lines instead of adding them, has no delete all and no way back to the defaults after « Réinitialiser le compte » (`deferred-work.md`, spec 30.8). Its form offers DESIGN.md's ten colours and 38 icons; Sure's offers `Category::COLORS`, a custom `#rrggbb` with a « Mauvais contraste » warning, and `Category.icon_codes`, and a new category takes `COLORS.sample`.

**Approach:** `DEFAULT_CATEGORIES` takes Sure's 22 in Sure's order, colours and icons, Archant's 15 French names kept and Sure's `fr.yml` names for the seven others. `CATEGORY_COLORS` becomes Sure's ten, `CATEGORY_ICONS` Sure's 141 `icon_codes` plus `train-front`, which Archant offered before; `newCategory` draws a colour at random. The API gains `POST /api/categories/merge` (`targetId`, `sourceIds`), `DELETE /api/categories` and `POST /api/categories/bootstrap`, and loses the row's `POST /:id/merge`. The settings page gets Sure's menu, merge dialog, delete-all confirmation and empty state; the category picker its « Générer les catégories par défaut ».

## Boundaries & Constraints

**Always:**
- A merge runs in one transaction: each source's transactions move to the target with their origin kept; its budget lines move, or add their integer `budgeted_spending` to the target's line of the same month and go; its subcategories other than the target move under the target and take its colour; then the source goes.
- A merge is refused before any write when a source is the target (`sourceIds` `same_category`), the target sits under a source (`targetId` `parent_child`), or the target is a subcategory and a source has subcategories (`targetId` `invalid_parent`); an unknown id is `invalid_value` on its field.
- Delete all leaves every transaction uncategorised, removes every budget line through the cascade, and the categories table empty.
- Bootstrap creates each default whose name, case aside as `assertNameFree`, no category holds; it never renames, recolours or moves an existing one, and answers how many it created.
- A colour stays any `#rrggbb` on the API, for categories and goals alike, as Sure's `validates :color, format:`; an existing category or goal keeps a colour outside the ten.
- Every new write is a mutating method, refused to a viewer by `viewerReadOnly`.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no new seed on an existing instance (`defaults_seeded_at` stays once per instance, as Sure seeds once); no icon suggested from a name (Sure's `suggested_icon`, not in this story); no change to the per-row deletion with a replacement; no new dependency; no migration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh seed | empty database | 22 categories, Sure's colours and icons | none |
| Merge | sources A, B into T; A and T budgeted 30,00 € and 20,00 € in May, B 10,00 € in June | T holds every line, May 50,00 €, June 10,00 €; A, B gone | none |
| Merge with children | source P with child C into top-level T | C under T in T's colour | none |
| Child into its parent | source C into its parent P | C's lines and transactions on P; C gone | none |
| Parent into own child | source P into its child C | nothing written | `400` `targetId` `parent_child` |
| Children into a child | source P with children into another's child | nothing written | `400` `targetId` `invalid_parent` |
| Target among sources | `sourceIds` holds `targetId` | nothing written | `400` `sourceIds` `same_category` |
| Delete all | categories with lines, children and budget lines | no category, lines uncategorised | none |
| Bootstrap | « Revenus » renamed « revenus », 21 defaults deleted | 21 created, « revenus » untouched | none |
| Custom colour | `#f5f5f5` typed | « Mauvais contraste » shown, saving refused until adjusted | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `afdac0a8c`: `app/models/category.rb` (`COLORS`, `icon_codes`, `bootstrap!`, `default_categories`), `app/models/category/merger.rb`, `app/controllers/categories_controller.rb` (`destroy_all`, `bootstrap`, `perform_merge`), `app/views/categories/{index,merge,_form}.html.erb`, `app/views/category/dropdowns/show.html.erb`, `app/javascript/controllers/color_icon_picker_controller.js` (contrast below 4.5 against the colour at 10 % on white, auto-adjust by darkening), `app/models/goal.rb`, `config/locales/{models/category,views/categories,views/shared}/fr.yml`.
- `packages/data/category-presets.ts`, `goals.ts`, `schema/goals.ts`.
- `packages/api/src/services/{default-categories,categories,seed}.ts`, `schemas/{categories,goals}.ts`, `routes/categories.ts`, `mcp/categories.ts`, `schemas/assistants/categories.ts`, their specs.
- `packages/app/src/routes/_authed.settings.categories.tsx`, `components/{MergeCategoryDialog,CategoryDialog,TintPickers,CategoryCombobox,TransactionList}.tsx`, `hooks/useCategories.ts`, `lib/category-icons.ts`, `lib/contrast.ts`, `locales/fr.json`.
- e2e: `packages/app/e2e/categories.spec.ts` (defaults, form, merge), `reset.spec.ts` (delete all and restore: the `reset` project, since deleting every category would break the `chromium` tests sharing the database).
- Docs: `docs/sure-parity.md` « Categories », `docs/deployment.md` assistant tools if it names the colour default.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `seed.spec.ts` (22 defaults), `categories.spec.ts` (merge with budget lines, subcategories and a recurring series, the refusals, delete all, bootstrap), `routes/categories.spec.ts` (the three routes, a category without a colour).
- [x] Data: Sure's colours and icons, `newCategory` random, goal colour as a pattern.
- [x] API: defaults, `mergeCategories`, `deleteAllCategories`, `bootstrapCategories`, routes, assistant description.
- [x] Interface: page menu, merge dialog, delete-all confirmation, empty state, picker's bootstrap, custom colour with contrast warning, Sure's icons; e2e.
- [x] Docs, deferred work, story and sprint status.

**Acceptance Criteria:**
- Given a fresh instance, when it seeds, then it holds Sure's 22 defaults with their colours and icons.
- Given « Fusionner les catégories », when the owner merges several sources into a target, then their transactions, budget lines and subcategories move and the sources go; a parent into its subcategory is refused.
- Given « Supprimer tout », when confirmed, then no category remains and the empty page and the picker restore the defaults.
- Given the form, when the owner picks a colour or an icon, then Sure's ten colours, a custom colour with its contrast warning and Sure's icons are offered.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- « Logement » takes Sure's `home` icon, the same glyph as Archant's former `house`; both stay in the list, as in Sure's `icon_codes`. `train-front` stays accepted and offered last so a category or a goal that has it keeps it.
- The row's « Fusionner » goes: Sure's `_category.html.erb` menu has « Modifier » and « Supprimer » only, and the page menu merges one source as well as several. `POST /:id/merge` goes with it; nothing else calls it.
- The merge dialog disables the target's checkbox instead of only warning, as Sure's hint asks; the API still refuses it.
- The custom colour refuses to save below Sure's 4.5 ratio, as Sure's `setCustomValidity`, and offers « réglage automatique », which darkens it as Sure's `darkenColor`. Goals keep the ten colours without the custom field, Sure's goal form being out of this story; their colour is validated as a pattern so a goal saved with a former swatch stays editable.
- Delete all asks with Sure's `for_resource_deletion("all categories", high_severity: true)` text in French: « Supprimer toutes les catégories ? », the button destructive.
- The ten colours are named for assistive technology, Sure's radios having no name.
- A recurring series in a merged category moves to the target. Sure's series have no category; Archant's do, and its foreign key would otherwise clear it.
- Rules naming a merged or deleted category are left as they are, as Sure's merger and `destroy_all` leave them, and as Archant's per-row deletion already does.
- The merge dialog has no per-category counts nor children hint, as Sure's `merge.html.erb`; its hint names the transactions and budget lines it moves.
- The picker's « Générer les catégories par défaut » shows only where the picker creates categories (`allowCreate`), the places Sure's dropdown appears.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated icon map and locale tables, then by the first end-to-end run.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | « Mauvais contraste » shows on an untouched default colour such as « Revenus » `#22c55e`; the e2e test expecting none fails | high | patch | `ColorPicker` warns only once a colour is picked in the custom field, as Sure's picker checks on change; the e2e run confirmed the failure before the fix. |
| 2 | No test saves an untouched pale colour, so dropping the dirty check would go unseen | medium | patch | `categories.spec.ts` renames a category of its own in `#22c55e` and sees it saved in its colour. |
| 3 | `POST /api/categories` without a colour is untested | medium | patch | `routes/categories.spec.ts` posts one and gets one of the ten. |
| 4 | A merge clears the sources' recurring series through `set null` | medium | patch | `mergeCategories` moves them to the target; `categories.spec.ts` covers it; the interface invalidates the recurring list after a merge or delete all. |
| 5 | The empty categories page has two buttons; `empty-states.spec.ts` and `proportions.spec.ts` expected one | medium | patch | Both helpers take Sure's two buttons for categories, the first « Utiliser les valeurs par défaut (recommandé) ». |
| 6 | `docs/sure-parity.md` lines 154 and 197 and `sure-import.spec.ts:409` still say first swatch and fifteen defaults | low | patch | Rewritten to one of Sure's ten at random and « the default categories ». |
| 7 | `sampleGoalColor` became an alias of `sampleCategoryColor` | low | patch | Removed; goals call `sampleCategoryColor`, as Sure's `Goal::COLORS = Category::COLORS`. |
| 8 | The picker's bootstrap block repeats « Aucune catégorie trouvée » beside `CommandEmpty` | low | patch | The block keeps only its button. |
| 9 | `darkenToSureContrast`'s test compared hex strings | low | patch | It checks the result passes and differs from the input. |
| 10 | Rules naming a merged or deleted category stop acting | low | reject | Sure's merger and `destroy_all` leave rules as they are; recorded in Design Notes. |
| 11 | A child merged into its parent adds its amount to the parent's total | low | reject | Sure's `merge_budget_categories` adds whatever the hierarchy. |
| 12 | The target among the sources is refused where Sure's merger drops it | low | reject | Sure's controller refuses it first with `target_selected_as_source`. |
| 13 | `sourceIds` has no upper bound | low | reject | A household holds a few dozen categories; a huge array is refused by SQLite as any oversized request. |
| 14 | The merge dialog lost the moved count and the children hint | low | reject | Sure's `merge.html.erb` has neither; recorded in Design Notes. |
| 15 | The picker's bootstrap shows a fixed error message | low | reject | As the picker's « Créer » does with `createError`; the page shows the coded error. |
| 16 | No route test of a viewer's refusal on the three routes | low | reject | `viewerReadOnly` refuses every mutating method before any route, and has its own tests. |
| 17 | The review diff left out `category-icons.ts` and `fr.json` | low | reject | Generated from Sure's list and checked by `satisfies Record<CategoryIcon, LucideIcon>` and the typed `t()` keys. |
| 18 | Spec, sprint status and tasks disagreed | low | patch | All `done` in this pull request. |
