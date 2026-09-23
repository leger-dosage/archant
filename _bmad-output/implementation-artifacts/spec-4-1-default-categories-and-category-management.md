---
title: 'Story 4.1: Default categories and category management'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_commit: '8bd9016c82dc606f0850cda7d582de4d7f3f5460'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-4-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/scaffolding-lessons.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Transactions cannot be classified: no category exists, so neither the category picker of Story 4.2 nor the spending breakdown of Epic 6 has anything to work with (FR27, FR28).

**Approach:** Add a `categories` table and a nullable `transactions.category_id`, seed a French default set once at server start, and add a Réglages › Catégories page to create, edit, move, merge and delete categories. Setting a category on a transaction stays in Story 4.2; this story only moves transactions between categories on delete and merge.

## Boundaries & Constraints

**Always:**
- `categories`: `id` (text UUID), `name`, `kind` (`income` | `expense`, check constraint from `CATEGORY_KINDS`), `color` (`#rrggbb`), `icon` (a name from `CATEGORY_ICONS`), `parent_id` (self reference, `restrict`), `created_at`, `updated_at`. Names are unique ignoring case (`lower(name)` unique index), trimmed, 1 to 60 characters.
- Two levels at most: a parent is a top-level category and never the category itself, and a category that has children cannot take a parent. Refused with `VALIDATION_ERROR` on `parentId`.
- A child always carries its parent's `kind` and `color`, as Sure does for colour. The service copies them when a category gets a parent, and a change of a parent's kind or colour rewrites its children in the same transaction. The form hides both fields once a parent is chosen.
- `transactions.category_id` is nullable, references `categories.id` with `restrict`, and is indexed. Only `services/ledger.ts` writes it, through one new function called with `origin: "maintenance"`, which leaves `locked_fields` untouched (AD-2, AD-10).
- Delete takes an optional replacement. In one `immediate` transaction: the transactions move to the replacement or to `null`, the children become top-level (Sure), then the category is deleted.
- Merge keeps the target and deletes the source. In one `immediate` transaction: the transactions move to the target, the children of the source move under the target and take its kind and colour, then the source is deleted. Merging across kinds is allowed; the kind only groups the display (AD-9).
- `services/seed.ts` inserts the 15 top-level defaults of the Design Notes, with no children as in Sure, only if it can insert the `defaults_seeded_at` settings row, in the same transaction (AD-12). `index.ts` calls it after `runMigrations`. A deleted default never comes back.
- Every visible string goes through `fr.json`. The list sorts names with `Intl.Collator("fr")`, so « Épargne » sorts under E.

**Never:** no category picker on transactions, no `category_origin`, no `"category"` in `LOCKABLE_FIELDS`, no category filter (all Story 4.2). No free hex colour input, no "restore defaults" action, no budgets, no drag and drop.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First start | No `defaults_seeded_at` row | Defaults inserted with the row | — |
| Later start | Row present, defaults deleted | Nothing inserted | — |
| Two concurrent seeds | Both start at once | One inserts, the other sees the row and skips | — |
| Duplicate name | « courses » when « Courses » exists | — | `400`, field `name`, code `name_taken` |
| Grandchild | Parent is itself a child | — | `400`, field `parentId`, code `invalid_parent` |
| Parent with children moved under another | `parentId` set | — | `400`, `invalid_parent` |
| Delete with replacement | 3 transactions, replacement R | 3 transactions on R, category gone | Unknown or same id: `400`, `replacementId`, `invalid_value` |
| Delete a parent | 2 children | Children top-level, keep their kind and colour | — |
| Merge into own child | Source is the target's parent | — | `400`, `targetId`, `invalid_value` |
| Unknown id | Any route | — | `404 NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `packages/data/schema/transactions.ts` -- add `categoryId`; do not touch `LOCKABLE_FIELDS`.
- `packages/data/schema/entries.ts:8-52`, `schema/check.ts:10` -- enum-with-check pattern (`inList`) to copy for `CATEGORY_KINDS`.
- `packages/data/schema/settings.ts` -- the key-value table holding `defaults_seeded_at`.
- `packages/data/package.json:6-22`, `types.ts` -- every new schema module is exported and gets `Category`/`NewCategory`.
- `packages/data/migrate.spec.ts:292` -- per-table constraint tests; extend for `categories`.
- `pnpm data generate --name add_categories` -- produces `drizzle/0011_add_categories.sql`.
- `packages/api/src/services/setup.ts:40-53` -- `insert(settings)...onConflictDoNothing().returning()` claim to reuse in `seed.ts`.
- `packages/api/src/index.ts:17-22` -- call `seedDefaults` after `createDb`, beside `purgeStalePreviews`. `web/e2e/start-api.ts` runs this file, so e2e gets the defaults; `createTempDatabase` does not, so specs call `seedDefaults` themselves.
- `packages/api/src/services/ledger.ts:906-970` -- `updateTransaction` shows the `db.transaction(..., { behavior: "immediate" })` shape and `Origin` (L58). Nested calls become savepoints.
- `packages/api/src/routes/accounts.ts`, `schemas/accounts.ts:21-62`, `app.ts:47-55` -- route, Zod schema and chained mount to copy. The schema module is exported in `packages/api/package.json:6-14` for the web form.
- `packages/api/src/app.spec.ts:27-245` -- route specs, `testClient` and `request` helpers.
- `packages/web/src/routes/_authed.reglages.tsx:9` -- `SECTIONS` gains Catégories before Sécurité.
- `packages/web/src/components/CreateAccountDialog.tsx:72-120`, `ConfirmDialog.tsx`, `ChoiceField.tsx`, `hooks/useAccounts.ts`, `lib/query-keys.ts` -- form, confirm, radio choice, query hook and key patterns.
- `packages/web/src/components/CommandPalette.tsx:96-115` -- `goTo` gains « Catégories ».
- `packages/web/e2e/fixtures.ts:130-220`, `e2e/manage-accounts.spec.ts` -- `apiHelpers` gains category helpers; spec layout to copy.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/migrate.spec.ts` -- first, failing tests for the kind check, the case-insensitive unique name, and `restrict` on both foreign keys.
- [x] `packages/data/schema/categories.ts`, `packages/data/category-presets.ts` -- table, `CATEGORY_KINDS`, `CATEGORY_COLORS` (Sure's ten swatches), `CATEGORY_ICONS` (Lucide names used by the defaults plus about 20 more); export both, add types, generate `0011_add_categories`.
- [x] `packages/data/schema/transactions.ts` -- `categoryId` and its index.
- [x] `packages/api/src/services/ledger.ts`, `ledger.spec.ts` -- `recategorise(from, to | null, { origin })` moves every transaction of a category, keeps `locked_fields`; spec first.
- [x] `packages/api/src/services/categories.spec.ts`, `categories.ts` -- spec first for every matrix row, then list (with `transactionCount`), create, update, delete, merge.
- [x] `packages/api/src/services/default-categories.ts`, `seed.ts`, `seed.spec.ts`, `index.ts` -- the Design Notes set, seeded once; spec covers first start, later start after deletion, and two concurrent calls.
- [x] `packages/api/src/schemas/categories.ts`, `routes/categories.ts`, `app.ts`, `app.spec.ts` -- `GET /categories`, `POST /categories`, `PATCH /categories/:id`, `DELETE /categories/:id?replacementId=`, `POST /categories/:id/merge { targetId }`.
- [x] `packages/web/src/lib/category-icons.ts` -- `satisfies Record<CategoryIcon, LucideIcon>`, so a missing icon fails `typecheck`.
- [x] `packages/web/src/hooks/useCategories.ts`, `lib/query-keys.ts` -- delete and merge also invalidate `transactions.all`.
- [x] `packages/web/src/routes/_authed.reglages.categories.tsx`, `components/CategoryDialog.tsx`, `DeleteCategoryDialog.tsx`, `MergeCategoryDialog.tsx` -- page grouped « Revenus » / « Dépenses », parents with their children indented, each row with dot, icon, name, transaction count and a menu (Modifier, Fusionner, Supprimer).
- [x] `packages/web/src/locales/fr.json` -- page strings, `errors.fields.name_taken`, `errors.fields.invalid_parent`.
- [x] `packages/web/e2e/categories.spec.ts`, `e2e/fixtures.ts` -- one test per criterion below.

**Acceptance Criteria:**
- Given a fresh instance, when the categories page opens, then the defaults show under « Revenus » and « Dépenses », each with its colour and icon.
- Given the page, when I create a category, rename it, pick another swatch, or set a parent, then the list shows the change after a reload.
- Given the delete dialog, when it opens, then it shows the transaction count and a choice between a replacement category and « Laisser sans catégorie ». The effect on transactions is tested in Vitest, since no screen shows a transaction's category before Story 4.2.
- Given the merge dialog, when I pick a target, then the source disappears and the target's count includes its transactions.

## Design Notes

Defaults, adapted from Sure's names, colours and icons. All top-level, as in Sure: the user creates sub-categories.

| Name | Kind | Colour | Icon |
|---|---|---|---|
| Revenus | income | `#22c55e` | `circle-dollar-sign` |
| Courses | expense | `#407706` | `shopping-bag` |
| Restaurants | expense | `#f97316` | `utensils` |
| Transports | expense | `#0ea5e9` | `bus` |
| Logement | expense | `#b45309` | `house` |
| Énergie et eau | expense | `#eab308` | `lightbulb` |
| Abonnements | expense | `#6366f1` | `wifi` |
| Assurances | expense | `#0284c7` | `shield` |
| Santé | expense | `#4da568` | `pill` |
| Impôts et taxes | expense | `#dc2626` | `landmark` |
| Frais bancaires | expense | `#6b7280` | `receipt` |
| Loisirs | expense | `#a855f7` | `drama` |
| Voyages | expense | `#2563eb` | `plane` |
| Cadeaux et dons | expense | `#61c9ea` | `hand-helping` |
| Épargne et placements | expense | `#059669` | `piggy-bank` |

The icon list lives in `@archant/data` as names only, so the API validates it without depending on `lucide-react`; the web maps each name to its component.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- all pass, no tracked file modified afterwards.

## Implementation Notes

- `drizzle-kit` dropped `ON DELETE restrict` from the added `transactions.category_id`; `0011_add_categories.sql` restores it by hand, with a comment.
- The `no-restricted-imports` rule keeps `schema/transactions` inside the ledger, so the counts come from a second ledger reader, `countByCategory`, and `categories.spec.ts` sets a transaction's category with raw SQL.
- The API accepts any lowercase `#rrggbb`, not only the ten swatches: the defaults carry Sure's own colours, and editing one must not force a recolour. The form offers the swatches plus the current colour when it is not one.
- The concurrent-seed spec runs `seedDefaults` in two child processes. In one process, libSQL's synchronous driver blocks the thread on the second `BEGIN IMMEDIATE`, so the first transaction can never commit.
- No route sets a transaction's category before Story 4.2, so the end-to-end suite writes it straight into the run's database. `e2e/settings.ts` now fixes that file's path (`DATABASE_FILE`) instead of `mkdtemp`.
- `/reglages` now redirects to Catégories, the first section; `keyboard.spec.ts` follows.
- The delete dialog shows the destination choice only when the category holds transactions.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind | `start-api.ts` deletes the fixed database folder before the port is checked, so a second run wipes the first | false | `playwright.config.ts` sets no `reuseExistingServer`, so Playwright refuses to start when `/api/health` already answers, before spawning `start-api.ts` | reject |
| 2 | blind, edge | Name uniqueness ignores Unicode normalisation (NFD « Épargne ») | low | `assertNameFree` folds case only; one `.normalize("NFC")` fixes it | patch |
| 3 | blind, edge | Uppercase `#E99537` refused | low | `CATEGORY_COLOR_PATTERN` is lowercase only; lowercasing before the test fixes it | patch |
| 4 | blind | `recategorise` ignores its `origin` | low | A `user` call would not lock; narrowing the type to `maintenance` is a direct correction | patch |
| 5 | blind | `getCategory` counts the whole table after the transaction | low | One indexed `GROUP BY` per write on a household's volume; a concurrent delete between commit and read is not reachable in practice | reject |
| 6 | blind | Seed log line claims seeding on every start | low | Logged with `seeded: 0` after the first start; trivial condition | patch |
| 7 | blind | `epic-4-context.md` says 4.2 adds the category column; spec and sprint status disagree | low | Column claim true, fixed; status mismatch is the workflow's normal sync order | patch |
| 8 | blind, verification-gap | No test proves a non-swatch colour or every default passes the schema | medium | Replacing `categoryColor` by `z.enum(CATEGORY_COLORS)` keeps every test green and blocks editing 13 defaults | patch |
| 9 | blind | Merge dialog does not say children take the target's kind and colour | low | `MergeCategoryDialog` text mentions the move only; one sentence fixes it | patch |
| 10 | blind | Replacement and merge pickers are flat, no kind or hierarchy | low | Real but needs the grouped combobox Story 4.2 builds | defer |
| 11 | blind | Dialogs read a snapshot `opened.category` | low | Count can be stale while a dialog is open; reading by id from the list is direct | patch |
| 12 | blind | Renaming a parent rewrites its children's `updatedAt` | low | Harmless timestamp churn; fix adds a branch | reject |
| 13 | edge | Merge button silent if the target vanishes after a refetch | low | Needs a concurrent delete in another tab; fix adds a branch | reject |
| 14 | edge | Unknown stored icon crashes the page | low | `icon` is validated against `CATEGORY_ICONS` on every write; only a direct database write reaches it | reject |
| 15 | edge | Delete dialog hides the destination choice for an empty category | false | With no transaction there is nothing to place; the criterion concerns a used category | reject |
| 16 | verification-gap | Deleting without replacement from the interface is untested | medium | No e2e test reaches the `replacementId: null` path of `useDeleteCategory` | patch |
| 17 | verification-gap | Palette entry « Catégories » untested | low | Simple navigation, page reachable and tested through `/reglages` | defer |
