---
title: "Story 32.3: Merchants and tags as Sure"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: '6dbcf199700b479243c1b0a5c12aaf008928c664'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`afdac0a8c`) gives a family merchant a colour from `FamilyMerchant::COLORS`, drawn by `set_default_color` when none is given, and a `website_url` (`family_merchants/_form.html.erb`, « Site web (ex. : starbucks.com) »); its list shows each merchant's `shared/color_avatar` where no logo is set, and its page menu « Fusionner des marchands » merges several sources into one target through `Merchant::Merger` (« Fusionner vers (cible) », « Marchands à fusionner », « Fusionner la sélection », « %{count} marchands fusionnés avec succès »). A tag has a colour from `Tag::COLORS`, `COLORS.sample` for a new one, shown by `tags/_badge.html.erb`; a used tag is deleted through `tag/deletions/new.html.erb`, which picks a replacement (« Sélectionnez l'étiquette ») and runs `Tag#replace_and_destroy!`, and the page menu's « Supprimer tout » runs `tags_controller.rb#destroy_all`. Archant's merchants and tags are a name only; a merchant merges one at a time from its row; a tag is only removed; there is no delete all. Sure's archive, `merchants.csv` and `MerchantImport` carry `color` and `website_url`, which Archant's export writes empty and its imports ignore.

**Approach:** A migration gives `merchants` `color` and `website_url` and `tags` `color`, existing rows taking one of the ten at random. The colours are Sure's ten, the same list as `Category::COLORS`, so `CATEGORY_COLORS` and `sampleCategoryColor` serve all three. The API's merchant body takes an optional `color` and `websiteUrl`, the tag body an optional `color`; `POST /api/merchants/merge` (`targetId`, `sourceIds`) replaces the row's `POST /:id/merge`; `DELETE /api/tags/:id` takes an optional `replacementId`; `DELETE /api/tags` deletes every tag. The settings pages get Sure's page menus, forms, merge dialog, tag deletion dialog and coloured avatar and badge; the transaction rows and the tag picker show each tag in its colour. The export, the Sure archive import, the merchant CSV import and the assistant's tag tools carry the colours as Sure's.

## Boundaries & Constraints

**Always:**
- A colour is any `#rrggbb` on the API, as Sure's `format:` validations, lowercased; absent on create, it is one of the ten at random, the database's own inserts (bank sync, imports, tests) included through the column's `$defaultFn`.
- A website is optional free text, trimmed, at most 255 characters, a blank one stored as `null`; it is never fetched, never rendered as a link nor as an image: no logo, since the Content-Security-Policy refuses `cdn.brandfetch.io`.
- A merchant merge runs in one transaction: each source's transactions move to the target with their locks kept (`moveMerchant`, maintenance), then the sources go, their recurring series with them as a single delete already does. The target among the sources is refused (`sourceIds` `same_merchant`), as Sure's form never sends it; an unknown id is `invalid_value` on its field.
- A tag deleted with a replacement: each transaction carrying it carries the replacement once, a transaction already carrying both keeping one tagging; locks stay. The replacement being the tag itself, or unknown, is `replacementId` `invalid_value`.
- Delete all removes every tagging, then every tag, in one transaction, and returns how many tags went.
- Every new write is a mutating method, refused to a viewer by `viewerReadOnly`.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no logo nor `logo_url`; no provider merchants list, « Améliorer avec l'IA » nor « Récemment dissociés » (Sure's provider merchants are shared between families; Archant's bank merchants are the household's); no colour on a merchant's transaction row icon, which Sure draws from the entry's name; no change to rules naming a deleted or merged tag or merchant, as Sure leaves them; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Upgrade | merchants and tags without colour | each one of the ten at random, websites `null` | none |
| New merchant | `{ name }` | one of the ten, website `null` | none |
| Merchant website | `"  starbucks.com "` then `""` | `starbucks.com`, then `null` | none |
| Bad colour | `"red"` | nothing written | `400` `color` `invalid_value` |
| Merge | sources A, B into T | A's and B's transactions on T, locks kept; A, B gone | none |
| Target among sources | `sourceIds` holds `targetId` | nothing written | `400` `sourceIds` `same_merchant` |
| Tag replaced | V on rows 1 and 2, R on row 2 | R on rows 1 and 2 once each; V gone | none |
| Tag removed | V on row 1, no replacement | row 1 untagged; V gone | none |
| Replacement is itself | `replacementId` = id | nothing written | `400` `replacementId` `invalid_value` |
| Delete all | tags on rows | no tag, no tagging | none |
| Export | merchant with colour and website | NDJSON `color`, `website_url`; `merchants.csv` both columns | none |
| Merchant CSV | `Café,#4DA568,cafe.test` and `Bar,nope,` | Café `#4da568` `cafe.test`; Bar one of the ten, `null` | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `afdac0a8c`: `app/models/{family_merchant,tag}.rb`, `app/models/merchant/merger.rb`, `app/models/merchant_import.rb`, `app/controllers/{family_merchants,tags}_controller.rb`, `app/controllers/tag/deletions_controller.rb`, `app/views/family_merchants/{index,_form,_family_merchant,merge}.html.erb`, `app/views/tags/{index,_form,_tag,_badge}.html.erb`, `app/views/tag/deletions/new.html.erb`, `app/views/shared/_color_avatar.html.erb`, `app/models/assistant/function/{create_tag,update_tag,get_tags}.rb`, `config/locales/views/{merchants,tags,tag}/fr.yml`.
- Data: `packages/data/schema/{merchants,tags}.ts`, a migration after `0093`.
- API: `services/{merchants,tags}.ts`, `services/ledger/edits.ts` (`replaceTag`), `schemas/{merchants,tags}.ts`, `routes/{merchants,tags}.ts`, `mcp/tags.ts`, `schemas/assistants/tags.ts`, `services/ledger/export.ts` and `services/export.ts`, `services/sure-import-plan.ts` and `services/sure-import.ts`, `services/csv-import.ts`; their specs.
- Interface: `routes/_authed.settings.{merchants,tags}.tsx`, `components/{MerchantDialog,MergeMerchantDialog,TagDialog,TagBadge,DeleteTagDialog,TagCombobox,TransactionList,TintPickers}.tsx`, `hooks/{useMerchants,useTags}.ts`, `lib/tint.ts`, `locales/fr.json`.
- e2e: `packages/app/e2e/{merchants,tags}.spec.ts`.
- Docs: `docs/sure-parity.md` rows « Merchants », « Tags », the CSV import and assistant rows; `deferred-work.md` if it names this story.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `services/merchants.spec.ts` (colour default and given, website, merge of several, refusals), `services/tags.spec.ts` (colour, delete with and without replacement, delete all), route specs, export, Sure import and CSV import colour cases, assistant tag tools.
- [x] Data: columns and migration with random colours for existing rows.
- [x] API: services, schemas, routes, assistant tools, export and imports.
- [x] Interface: merchants page menu, form with colours and website, coloured avatar, merge dialog; tags page menu, form with colours, badge everywhere a tag shows, deletion dialog with replacement, delete all; e2e.
- [x] Docs, deferred work, story and sprint status.

**Acceptance Criteria:**
- Given « Réglages › Marchands », when the owner adds or edits a merchant, then Sure's ten colours, one at random by default, and « Site web (ex. : starbucks.com) » are offered, and each row shows the merchant's colour avatar.
- Given « Fusionner des marchands », when the owner picks a target, ticks sources and confirms « Fusionner la sélection », then the sources' transactions move to the target, the sources go and « N marchands fusionnés avec succès » shows.
- Given « Réglages › Étiquettes », when the owner adds or edits a tag, then Sure's ten colours are offered, and the tag's badge shows its colour in the list, on the transaction rows and in the picker.
- Given a used tag, when the owner deletes it with a replacement, then its transactions carry the replacement once; without one, they lose it; « Supprimer tout » deletes every tag with « Toutes les étiquettes supprimées ».

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The row's « Renommer » becomes « Modifier », as Sure's merchant menu, since the dialog now edits the colour and the website too; the row's « Fusionner » goes, Sure's merge being in the page menu only.
- Sure's merge silently drops the target from the sources; Archant's dialog disables the target's box, as the category merge of Story 32.2, and the API refuses it.
- A merged merchant's recurring series go with it, as Archant's single merge and delete already did through the cascade: moving them could collide with the target's own series on `recurring_transactions_merchant_unique`, and the next detection rebuilds the target's.
- The tag deletion dialog opens for a used tag only, as Sure's `_tag.html.erb`; an unused one keeps the plain confirmation. Its text says « étiquette » where Sure's French says « catégorisées », a mistranslation.
- « Toutes les étiquettes supprimées » where Sure's French says « balises », as the story asks; the confirmation is Sure's high-severity `for_resource_deletion("all tags")`: « Supprimer toutes les étiquettes ? ».
- Existing merchants and tags take one of the ten at random on upgrade, where Sure's 2024 migrations gave every existing row `#e99537`: a single orange for every row would make the colour mean nothing.
- The merchant form drops Sure's « Saisissez le site web du marchand pour afficher automatiquement son logo », since Archant shows no logo.
- The assistant's `create_tag` and `update_tag` take and return the colour as Sure's, a blank one read as absent as Sure's `presence`; a colour that is not `#rrggbb` is refused as any argument the tool's schema refuses, as `create_category`'s is. `create_merchant` and `rename_merchant`, Archant's own tools, stay name-only: Sure has no merchant write tool to follow, and `get_merchants` gives no colour.
- The merge's target is picked from the merchant combobox, Sure's select being searchable; a bank sync can create hundreds of merchants.
- The column's SQL default `#e99537` only lets SQLite add a `NOT NULL` column; the schema has no `.default()`, which Drizzle would prefer to `$defaultFn`, and its snapshot says so, so the next `pnpm data generate` finds no change.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated snapshot and the planning files.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | No raw insert draws a colour: Drizzle prefers `.default()` to `$defaultFn`, so every bank-sync merchant and imported tag would be orange | high | patch | A new `migrate.spec.ts` test with `Math.random` mocked failed with `#e99537`; the schema drops `.default()`, the 0094 snapshot matches, and the test passes. |
| 2 | Merge target was a plain select over possibly hundreds of merchants | medium | patch | Sure's select is `searchable: true`; the target now uses `MerchantCombobox`, and its unused `exclude` prop goes. |
| 3 | A source ticked, then picked as target, came back ticked when the target changed | medium | patch | Picking a target now unticks it. |
| 4 | Assistant tag colour: blank, uppercase and refused values untested | medium | patch | `mcp/tags.spec.ts` covers all three. |
| 5 | Sure archive colour lowercasing and fallback untested | medium | patch | `sure-import.spec.ts` imports hand-written `Tag` and `Merchant` lines. |
| 6 | « Supprimer tout » of tags has no end-to-end test | medium | patch | Added to `reset.spec.ts`, the project that may empty the shared database. |
| 7 | Toasts said « renommé » after a colour-only edit | low | patch | « enregistré », « enregistrée ». |
| 8 | `abs(random())` overflows on the minimum integer | low | patch | `(random() % 10 + 10) % 10`. |
| 9 | `present` duplicated in two assistant schemas | low | patch | Moved to `schemas/assistants/fields.ts`. |
| 10 | `removeAllTags` returned an unused count; `reduce` chain instead of `oneByOne` | low | patch | Both simplified. |
| 11 | A merged merchant's recurring series go through the cascade, untested | low | reject | Unchanged behaviour of the single merge and delete; recorded in Design Notes. |
| 12 | `sourceIds` has no upper bound | low | reject | As Story 32.2's category merge: a household's merchants fit SQLite's limits. |
| 13 | An existing merchant keeps its own colour on a CSV or archive import | false | reject | Sure's `MerchantImport` skips a merchant that is not a new record. |
| 14 | The test preflight requires `color` on `Tag` and `Merchant` | false | reject | It checks Archant's own export, which now always writes them. |
| 15 | Merchant assistant tools give no colour or website | false | reject | Sure's `get_merchants` gives none and Sure has no merchant write tool; recorded in Design Notes. |
| 16 | `untagged` counts moved rows when a replacement is given | low | reject | The count of rows that carried the deleted tag; renaming the field would break the route's shape for nothing. |
| 17 | The migration's ten colours are copied by hand | low | reject | A one-off upgrade statement; its test checks every row lands in the ten. |
| 18 | Hidden or vanished ticked sources are still sent | low | reject | As Sure's form posts every ticked box; the API refuses an unknown one. |
| 19 | A tag's count changing while its delete dialog is open | low | reject | Needs a concurrent write in another tab; the API handles both paths. |
| 20 | The replacement deleted meanwhile shows a generic toast | low | reject | The coded error toast, as the category deletion's. |
| 21 | No e2e test of a tag's colour on the rows and in the picker | low | reject | Visual QA covers it; the badge is one component. |
