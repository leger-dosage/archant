# Epic 4 Context: Classify transactions

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user sorts transactions into categories, merchants and tags, one at a time or in bulk, and filters the list on them. A fresh instance comes with a French set of top-level categories, as in Sure, that the user can reshape into two levels. Merchants group the many bank spellings of one shop. Tags follow a trip or a project across categories. Every classification the user sets by hand is locked, so the rules of Epic 8 and the categorisation provider never overwrite it. This epic supplies the category data that the Epic 6 dashboard breaks spending down by, and turns cleaning up an import into a few seconds of keyboard work.

## Stories

- Story 4.1: Default categories and category management
- Story 4.2: Categorise transactions and filter by category
- Story 4.3: Merchants
- Story 4.4: Tags
- Story 4.5: Bulk edit

## Requirements & Constraints

- The default categories are adapted from Sure's: income, groceries, restaurants, transport, housing, utilities, subscriptions, insurance, health, taxes, fees, leisure, travel, gifts, savings and investments. Each has a French name, a colour, an icon and a kind (`income` or `expense`). Categories have at most two levels: a category has at most one parent, and a parent has no parent.
- The user can create, rename, recolour, move under a parent, merge and delete categories. Deleting a used category asks for a category to receive its transactions, or leaves them uncategorised. Merging moves every transaction to the target, then deletes the source.
- The defaults are seeded exactly once per instance. A category the user deleted never comes back, and two concurrent starts never seed twice.
- The user sets a category from a searchable list without leaving the transactions page. The list filters by one or several categories, or by "uncategorised". A category the user sets is recorded as set by the user.
- Merchants: the user picks an existing merchant or types a new name, which creates it. They can rename, merge (transactions move to the target) and delete (transactions are unlinked). The list filters by merchant.
- Tags: a transaction carries several tags, which the user can create on the fly. Renaming or deleting a tag applies to all its transactions. The list filters by tag.
- Bulk: the user selects rows with the checkbox or `x`, extends the selection with `Shift`, or selects every row matching the current filters. On the selection they set a category or a merchant, add tags, exclude from reports, or delete. Each action runs in one database transaction, and balances are recomputed after a delete.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- Classification lives in `services/classification.ts`. Only `services/ledger.ts` writes `transactions`, so setting, clearing or moving a category, merchant or tag link on a transaction goes through ledger functions, each taking an `origin` and running in one `behavior: "immediate"` transaction.
- Data model: `categories` (self-referencing parent), `merchants`, `tags`, and a `taggings` join between `transactions` and `tags`. `transactions` gains a category and a merchant reference. Tables are plural snake_case, ids are text UUID v4, and enumerations such as a category's kind are text columns with a check constraint built from a `const` array in `@archant/data`. Derived types go in `packages/data/types.ts`.
- Manual edits win. A ledger call with `origin: "user"` adds the field name to `transactions.locked_fields`; other origins never write a locked field. `LOCKABLE_FIELDS` in `packages/data/schema/transactions.ts` must grow with the new columns. `transactions.category_origin` records who set the category: `user`, `rule`, `provider` or null. Category and merchant merges use `origin: "maintenance"` and keep lock state.
- Seeding: `settings` is the existing key-value table. `services/seed.ts` runs at server start in `index.ts`, after migrations, and seeds the defaults only if it can insert the `defaults_seeded_at` row, in the same transaction. Default names are French strings stored as data, not translation keys.
- Entry ids never change. `ledger.absorb` must move taggings onto the surviving entry, and the category and merchant columns follow the transaction row.
- API: the `{ data }` / `{ error }` envelope, chained mounts in `app.ts`, and request schemas in `packages/api/src/schemas/`. Lists keep `page`/`pageSize` pagination. Bulk actions accept either `ids` or the list's filter object, so « Tout sélectionner » never ships every id to the client. New error codes join the closed `AppError` union.
- The interface keeps list filters in URL search params validated by TanStack Router. Server state goes through TanStack Query with one `queryKeys` object per resource. Icons come from `lucide-react`.
- The cash-flow rules come later: a category total is the signed sum of its counted transactions, and the category's kind only groups the display. Nothing in this epic may use the kind to flip signs.

## UX & Interaction Patterns

- Settings (`/reglages/...`) gains the Catégories, Marchands and Étiquettes sections beside Sécurité. The filter bar gains catégorie, étiquette and marchand chips.
- Category chip: an 8 px dot in the category colour, then the name. An uncategorised transaction shows a dashed outline dot and « Sans catégorie », never « Non catégorisé(e) ». Category charts use each category's own colour. The row shows the merchant as a caption under the label.
- Clicking the category chip on a row opens a combobox in place. Picking a category saves immediately, with an optimistic update and an undo toast. A failed update rolls back with a destructive toast.
- Combobox: type to filter, arrows to move, `Enter` to pick. Categories show parents with their children indented. Merchant and tags offer « Créer "…" » as the last option.
- The transaction sheet adds the category, merchant and tags fields.
- Keyboard in a list: `x` selects, `Shift` plus a move extends the selection, `c` category, `m` merchant, `t` tags, `Esc` clears the selection. Single-letter shortcuts are off inside text fields, and each one has a visible button whose tooltip shows it.
- Bulk bar at the bottom, shown once a row is selected: the count, « Tout sélectionner (N résultats) », then Catégorie, Marchand, Étiquettes, Exclure, Supprimer. Supprimer asks for confirmation with the count (« Supprimer 12 opérations »), and focus starts on Annuler.
- Below 768 px, rows have two lines: label and amount, then date and category. Categorising works on a phone.

## Cross-Story Dependencies

- Story 4.1 created `categories`, `transactions.category_id`, `seed.ts` and its call in `index.ts`. 4.2 then adds `category_origin`, the category lock, the combobox and the filter. 4.3 and 4.4 reuse the same combobox, filter chip and settings layout for merchants and tags.
- Story 4.5 depends on 4.2 to 4.4 for its actions, and on the list's filter object for « select all ». The `x` and `Shift` shortcuts extend Story 1.8's keyboard layer.
- Epic 5 adds the direction filter chip. Epic 6 rolls sub-categories up into their parent, shows the uncategorised total on its own line, and links a category line to `/operations` filtered on that category and month. Epic 8 rules write with `origin: "rule"` and respect the locked fields. Epic 9 groups recurring transactions by merchant, and `domain/normalize-label.ts` also serves merchants.
