---
title: 'Story 11.12: Create tags, merchants and categories where they are picked'
type: 'feature'
created: '2026-09-26'
status: 'done'
baseline_commit: '05fa9af045c2fd6ecf3a3756f44aa04aac793620'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** « Réglages › Étiquettes » and « Réglages › Marchands » only rename, merge and delete; their description sends the user to a transaction to create one, which the owner missed in manual QA (J11). In the rule dialog, the merchant picker runs `MerchantCombobox` with `mode="target"`, which hides « Créer », and `CategoryCombobox` has no « Créer » at all; only the tag picker creates.

**Approach:** Each settings page gets an « Ajouter » button in its header and in its empty state, opening a dialog that creates by name, as Sure's `tags/index` and `family_merchants/index`. In the rule dialog, the merchant, category and tag pickers all offer « Créer "…" » for a name no row holds, and the condition or action takes the new row.

## Boundaries & Constraints

**Always:**
- Labels follow the neighbouring « Ajouter une catégorie » and the infinitive-verb rule: « Ajouter une étiquette », « Ajouter un marchand ». The empty state shows its text and the same button.
- The dialog creates by name only, through the existing `POST /api/tags` and `POST /api/merchants`; `name_taken` and length errors show under the field as the rename dialog shows them. `RenameTagDialog` and `RenameMerchantDialog` become `TagDialog` and `MerchantDialog`, creating when no row is passed, as `CategoryDialog` does. A success toast names the row; the dialog closes and the row appears in the list.
- The page descriptions (`tags.description`, `merchants.description`) stop saying creation happens only from a transaction.
- `MerchantCombobox`'s `mode` becomes two props, `allowNone` and `allowCreate`, both defaulting to `true`; `MergeMerchantDialog` passes both `false`, the rule dialog passes `allowNone={false}`.
- `CategoryCombobox` gains `allowCreate`, default `false`; only the rule dialog sets it. « Créer "…" » creates a top-level `expense` category with the same defaults `CategoryDialog` starts from (first swatch, `tag` icon), editable later under « Réglages › Catégories ». One shared default serves both.
- « Créer » is offered only for a trimmed name no row holds, folded as the comboboxes compare names today, within the schema's maximum length. The fold moves from the two comboboxes into one helper used by all three.
- `useCreateCategory` adds the new row to the cached list at once, as `useCreateTag` and `useCreateMerchant` do, so the picker's button shows the name before the refetch.
- Creation applies to the rule's conditions and actions alike, since both use `ReferenceField`.
- `EXPERIENCE.md` Combobox row and a Rules row in `docs/sure-parity.md` record the rule dialog's creation.

**Never:** no colour, website or other field for tags or merchants; no API or schema change; no « Créer » in the transaction sheet's, bulk bar's or filter's category picker; no category dialog stacked over the rule dialog; no creation from the account picker.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create tag in settings | « Ajouter une étiquette », new name | toast, row listed with « 0 opération » | N/A |
| Name taken | existing name, other case | dialog stays open, field error | nothing created |
| Empty page | no tag or no merchant | empty text and « Ajouter » button opening the dialog | N/A |
| Rule merchant action | type unknown name | « Créer "X" » last; picking it creates and shows X on the button; saved rule reads « Marchand X » | failed create: error toast, picker stays |
| Rule category action | type unknown name | category created under Dépenses, top level, picked | same |
| Rule tag condition | type unknown name | tag created and picked | same |
| Known name | name held in another case | no « Créer » | N/A |
| Merge target | merge dialog picker | neither « Sans marchand » nor « Créer » | N/A |

</frozen-after-approval>

## Code Map

- `packages/app/src/routes/_authed.settings.tags.tsx` -- `Action` (L27), `Opened` (L34), header (L101–104), empty state (L124), `RenameTagDialog` use (L142); page comment (L64–67) goes stale. Model: `_authed.settings.categories.tsx` `Opened` with `{ action: "create" }` (L39), header button (L163–169).
- `packages/app/src/routes/_authed.settings.merchants.tsx` -- same shape: `Action` (L28), `Opened` (L35), header (L117–118), empty (L139), dialog (L157).
- `packages/app/src/components/RenameTagDialog.tsx`, `RenameMerchantDialog.tsx` -- rename-only forms on `tagSchema` / merchant schema; become create-or-rename, handling `name_taken` as now.
- `packages/app/src/components/MerchantCombobox.tsx` -- `mode` (L51, L66, L76, L107); `TagCombobox.tsx` and it both define `nameKey` (L37–39).
- `packages/app/src/components/CategoryCombobox.tsx` -- add `allowCreate`, the filter's `CREATE` pass-through and the item, as `TagCombobox` does; `CATEGORY_NAME_MAX_LENGTH` is in `@archant/data/category-presets`.
- `packages/app/src/components/CategoryDialog.tsx` -- `defaults()` (L39–45) becomes the shared default.
- `packages/app/src/hooks/useCategories.ts` -- `useCreateCategory` (L44–52) gains the cache insert of `useTags.ts` L27–34.
- `packages/app/src/components/RuleDialog.tsx` -- `ReferenceField` merchant (L346–366, drop `mode="target"`) and category (L367–388) cases; tag case (L389–408) already creates.
- `packages/app/src/components/MergeMerchantDialog.tsx:102` -- `mode="target"` becomes the two props.
- `packages/app/src/locales/fr.json` -- `merchants.*` (L747+), `tags.*` (L784+), `transactions.category.create` beside `transactions.merchant.create`.
- `packages/app/e2e/tags.spec.ts`, `merchants.spec.ts` -- `openAction`, `tagRow` helpers; `merchants.spec.ts:74–76` keeps the merge check. Empty state stubbed with `page.route` as `accounts.spec.ts:18`.
- `packages/app/e2e/rules.spec.ts` -- `visit`, `choose`, `dialog`, `later`, `ruleRow`; model test at L328.
- `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md:78`, `docs/sure-parity.md` Rules table (L164+).

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/src/lib/name-key.spec.ts` -- tests first: case, accents kept, NFC, surrounding spaces.
- [x] `packages/app/src/lib/name-key.ts` -- the shared fold; `MerchantCombobox`, `TagCombobox` import it.
- [x] `packages/app/e2e/tags.spec.ts`, `merchants.spec.ts` -- create from the header, name taken, empty state with its button. Written before the components.
- [x] `packages/app/e2e/rules.spec.ts` -- merchant action, category action (then listed under Dépenses in `/settings/categories`), tag condition, each created from the picker and read back in the rule row; a known name in another case offers no « Créer ».
- [x] `TagDialog.tsx`, `MerchantDialog.tsx` (renamed), both settings routes, `fr.json` -- button, empty state, create mode, strings.
- [x] `MerchantCombobox.tsx`, `CategoryCombobox.tsx`, `CategoryDialog.tsx`, `useCategories.ts`, `RuleDialog.tsx`, `MergeMerchantDialog.tsx` -- props, shared default, cache insert, wiring.
- [x] `EXPERIENCE.md`, `docs/sure-parity.md` -- the two rows.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test` and `pnpm test:e2e` run, then every matrix row has an automated test: Playwright for the pages and pickers, Vitest for the name fold.

## Implementation Notes

- `lib/name-key.ts` holds `nameKey` and `isNewName`, which adds the empty and length checks the three comboboxes repeated.
- The shared category default is `newCategory(name)` in `lib/new-category.ts`, so neither `CategoryDialog` nor `CategoryCombobox` exports a non-component.
- The dialogs' strings moved from `tags.renameDialog` / `merchants.renameDialog` to `tags.dialog` / `merchants.dialog`, which now carry both modes.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| The merge test asserts no « Créer » while the search holds an existing name (blind, edge) | medium | `merchants.spec.ts` fills `target.name` before the assertion, so dropping `allowCreate={false}` breaks nothing; the matrix's merge row had no real test. | patch |
| The category picker's refused creation is untested (blind, edge, verification) | low | Only `POST /api/merchants` is stubbed; `CategoryCombobox`'s `onError` is new. | patch |
| Nothing checks the rule's merchant picker hides « Sans marchand » (verification) | low | Every rule test picks by name; dropping `allowNone={false}` would let a rule hold `""`. | patch |
| Nothing checks a row's category combobox offers no « Créer » (verification) | low | Every category search outside rules types an existing name; the default `allowCreate = false` is unguarded. | patch |
| The length test never exercises the NFC count (blind) | low | Both inputs are already composed. | patch |
| The cache insert of `useCreateCategory` is unobserved (verification) | low | Playwright retries until the refetch lands; same untested pattern as tags and merchants. | defer |
| The popover closing while a creation is pending drops the pick (edge) | low | Needs `Esc` within the request's milliseconds; the transaction sheet's merchant and tag pickers behave the same since Epic 4. | rejected |
| A name taken in another tab shows the generic validation toast (edge) | low | Needs a second tab creating the same name between list load and click; one household. | rejected |
| Length errors in the create dialogs are untested (blind) | low | The field-error branch is the rename dialogs' own, unchanged; `name_taken` is tested. | rejected |
| `deferred-work.md` names the removed rename dialogs (blind) | low | The entry stays true for renaming; the workflow only appends to that file. | rejected |
| `epics.md` still reads « Nouvelle étiquette » (blind) | low | The epic is the owner's text; Design Notes record the « Ajouter » choice, reported to the owner. | rejected |
| Spec `in-review` while sprint status says `in-progress` (blind) | false | The sprint status moves to `review` at the presentation step. | rejected |
| DOM-structure locators `:scope > ul > li > div` and `locator("..")` (blind) | low | `tagRow` and `merchantRow` already climb with `..`; the categories page exposes no accessible nesting to target. | rejected |
| Markers keep a space after `replace(" ", "-")` (blind) | false | The condition « contient » matches the whole marker, space included; the test passes on real labels. | rejected |
| A picked category's colour and icon are untested (blind) | low | The shared `newCategory` is the form's default, already exercised by the category tests. | rejected |
| The tag picker's refused creation is untested (spec review) | low | The refused-creation loop covered merchants and categories only; the matrix's tag row says « same ». | patch |
| `TagDialog` and `MerchantDialog`, and the three comboboxes' « Créer » path, are near copies (standards review) | low | The two rename dialogs were already copies before this story; one generic dialog or hook is an abstraction the spec does not ask for. | rejected |

## Design Notes

Why a category created from a picker gets defaults instead of a form: a category needs a kind, a colour and an icon that a typed name does not give, and `EXPERIENCE.md` bans modal stacks deeper than one level, so the rule dialog cannot open `CategoryDialog`. The kind only groups the display (AD-9), and the settings page edits all three later. Sure offers no creation from its rule form; the story's own criterion asks for it.

Why « Ajouter » and not Sure's « New »: every create button in Archant reads « Ajouter … », including « Ajouter une catégorie » one tab away.

## Verification

**Commands:**
- `pnpm typecheck && pnpm lint:code && pnpm test` -- expected: green.
- `pnpm test:e2e` -- expected: green.
