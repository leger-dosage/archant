---
title: "Story 32.12: Categorise uncategorised lines in groups"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'b6cb4b9a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) has a quick-categorise wizard: the transactions page's menu offers « Categorize (N) » while uncategorised lines exist, leading to `/transactions/categorize` (`Transactions::CategorizesController`). `Transaction::Grouper::ByMerchantOrName` groups `Entry.uncategorized_transactions` (active or draft accounts, no category, no excluded line, transfer kinds of `UNCATEGORIZED_EXCLUDED_KINDS` aside) by the merchant's name, else the line's name, and by sign; the largest group first, then by name, lines most recent first. The page shows one group at `position`: its name and type, « N transactions · total », a « Create Categorization Rule » box (ticked for more than one line) whose filter text can be edited, which previews the uncategorised lines containing it (`preview_rule`), the lines each ticked « Include name » with a per-line « → assign » select (`assign_entry`, which unticks the rule box, as unticking a line does), and the category pills under « Assign a category » with a search field. A pill categorises the ticked lines (`bulk_update!`, split parents left out) and, with the box ticked, calls `Rule.create_from_grouping`: an active rule named after the filter, a name « contains » condition, a type condition and the category action; a failure says `rule_creation_failed`. « Skip » moves to the next position; once no group is left at the position, the transactions page says « All transactions are categorized ». Archant has none of it.

**Approach:** A pure grouper in `domain/categorise-groups.ts`; a ledger read of every uncategorised line with its merchant's name; `services/categorise.ts` answering the group at a position with the remaining count, the preview for a filter, and the categorisation through `bulkUpdateTransactions` (origin `user`, AD-10) plus the rule through `createRule` (enabled), refused when a rule with the same conditions and actions exists. Routes `GET /api/transactions/categorize`, `GET /api/transactions/categorize/preview`, `POST /api/transactions/categorize`. A page `/transactions/categorize` and « Catégoriser (N) » on « Opérations » for an administrator.

## Boundaries & Constraints

**Always:** uncategorised as « Sans catégorie » of the list (`filterCondition` with `uncategorised`, active accounts, split parents left out) plus Sure's `excluded: false`; sign as `direction`: a positive amount is income, zero or negative an expense; a viewer cannot post (`viewerReadOnly`) and sees no « Catégoriser »; Sure's French words with « opération » for « transaction ».

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no success toast (Sure's turbo stream shows none); no rule prompt of Story 32.11 after the wizard (Sure's controller offers none); no rule applied on creation (Sure's `create_from_grouping` only saves it).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grouping | 3 « Netflix » expenses, 2 « Spotify », 1 « Netflix » income | Netflix expense, Spotify, Netflix income | none |
| Merchant | lines « CB AMZN 1 » and « CB AMZN 2 » with merchant Amazon | one group « Amazon » | none |
| Split | a split parent without category | left out, its lines grouped | none |
| Partial | two of three lines ticked | two categorised, the third stays shown, count down by two | none |
| Last line | every shown line categorised | next group at the same position | none |
| Nothing left | no group at the position | back on « Opérations », toast « Toutes les opérations sont catégorisées » | none |
| Rule | box ticked | enabled rule: « Libellé » « Contient » name, « Type » sign, « Catégorie » | none |
| Duplicate | same rule already exists | lines categorised, no rule, toast `rule_creation_failed` | `rule: "failed"` |
| Preview | filter « netf » | uncategorised lines of that sign whose label contains it, case ignored | blank filter: none |
| Viewer | POST | 403 `FORBIDDEN` | refused |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/controllers/transactions/categorizes_controller.rb`, `app/models/transaction/grouper/by_merchant_or_name.rb`, `app/models/rule.rb#create_from_grouping`, `app/models/entry.rb` `uncategorized_transactions` and `uncategorized_matching`, `app/views/transactions/categorizes/*`, `app/javascript/controllers/categorize_controller.js`, `app/views/transactions/index.html.erb` (`categorize_button`), `config/locales/views/transactions/fr.yml` `categorizes`, `test/controllers/transactions/categorizes_controller_test.rb`, `test/models/transaction/grouper/by_merchant_or_name_test.rb`.
- API: `domain/categorise-groups.ts` (new, `groupUncategorised`), `services/ledger/queries.ts` (`uncategorisedLines`, `countUncategorised`), `services/categorise.ts` (new, the duplicate check beside `createRule`), `schemas/transactions.ts` (`categorizeQuerySchema`, `categorizePreviewSchema`, `categorizeBodySchema`), `routes/transactions.ts`.
- Interface: `routes/_authed.transactions_.categorize.tsx` (new), `hooks/useCategorize.ts` (new), `hooks/useTransactions.ts` (`useInvalidateBulk`'s `keep`), `routes/_authed.transactions.tsx` (« Catégoriser (N) », through `GET /api/transactions/categorize/count`), `components/Page.tsx` (« Opérations / Catégoriser »), `lib/query-keys.ts`, `locales/fr.json`.
- Tests: `domain/categorise-groups.spec.ts`, `routes/transactions.spec.ts` (« the quick-categorise wizard » and a viewer's refusal), e2e `categorise-groups.spec.ts`.
- Docs: `docs/sure-parity.md` Rules row.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: grouping and order (merchant, label, sign, count, name, recency), the route's group, remaining count, split parent left out, excluded left out, a partial group, the rule created, the duplicate refused, the preview, a viewer refused.
- [x] Grouper, ledger read, service, schemas, routes.
- [x] Page, hook, « Catégoriser (N) », French texts.
- [x] e2e categorises two groups, one with a rule, previews an edited rule text, and sees « Toutes les opérations sont catégorisées » past the last group.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given uncategorised lines, when the administrator opens « Opérations », then « Catégoriser (N) » leads to `/transactions/categorize`, showing the largest group first with « N opérations non catégorisées restantes ».
- Given a group, when the administrator picks a category under « Assigner une catégorie », then every ticked line takes it, locked as a hand edit, and « Ignorer » shows the next group; « Quitter » goes back to « Opérations ».
- Given « Créer une règle de catégorisation » ticked, when the group is categorised, then an enabled rule « Libellé contient nom », « Type » the sign, sets the category; the same rule again is refused with Sure's message.

## Design Notes

Assumptions taken alone, each settled by Sure:

- « Catégoriser (N) » is a button beside « Ajouter une opération »: Archant's « Opérations » has no page menu where Sure puts it.
- Groups compare names exactly, as Sure's `group_by`; ties on the count sort by name in French order, then expenses before income.
- The duplicate Sure's message names is a rule with the same conditions and actions, its name aside; Sure's model has no such check, but its message and comment say a duplicate is not created, and the story asks for the refusal. Any other failure, such as a name past 100 characters, says the same message.
- The rule's name is the filter cut to 100 characters, as Story 32.11; the condition keeps the filter, refused past 200 like any rule value.
- A group lists at most its 1,000 most recent lines, the most a request body carries; the next lines come back at the same position once those are done. Sure lists every one.
- The preview matches the label only, squished and case folded as the rule's « Contient », with the group's sign, as `uncategorized_matching`.
- The group's total sums the lines' absolute amounts in each currency, joined with « + » when a group mixes currencies; Sure sums in the family's currency.
- Upgrade: nothing stored changes.

- Skipping past the last group, or a position past it, says « Toutes les opérations sont catégorisées » on « Opérations » though skipped groups remain, as Sure's `show` redirects with `all_done` whenever no group sits at the position.
- The categorisation sets every id sent, a line categorised meanwhile included, as Sure's `create`, which reads `entry_ids` without `uncategorized_transactions`.
- A merchant's group gets a rule on the merchant's name in the label, which may match none of its lines, as Sure's `create_from_grouping` with the merchant's `grouping_key`.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff of `packages`, `routeTree.gen.ts` aside; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The QA capture script sat in `e2e/` and would run in the suite | medium | patch | Moved out of the tree to `.agents/qa/32.12/`. |
| 2 | A viewer's page sent the step read before redirecting | low | patch | `useCategorizeStep` runs only for an administrator. The reads stay open to a viewer, as every read (AD-21). |
| 3 | « Ignorer » past the last group says all are categorised | low | reject | Sure's `show` does the same; recorded in Design Notes. |
| 4 | The POST sets lines categorised meanwhile, or fails on a deleted id | low | reject | Sure's `create` reads `entry_ids` as sent; recorded in Design Notes. |
| 5 | A rule error other than validation answers 500 after the lines are set | low | reject | Only a database fault reaches it; the lines are set as asked and a retry sets nothing new. |
| 6 | « failed » mixes a duplicate with an invalid rule | false | reject | Sure has one message for both, the one the story names. |
| 7 | The duplicate check compares conditions in order | low | reject | Conditions in another order make another rule in the list; the wizard always writes the same order. |
| 8 | A merchant's group rule may match none of its lines | low | reject | Sure's `create_from_grouping` does the same with the merchant's `grouping_key`; recorded in Design Notes. |
| 9 | Each step reads every uncategorised line | maybe-false | defer | Sure does the same; not timed at NFR10's volume, recorded in `deferred-work.md`. |
| 10 | The invalid-rule test reads as a name failure, the name being cut | low | patch | Test renamed for the condition's 200 characters. |
| 11 | No test edits the rule text, previews and categorises the preview | medium | patch | e2e edits the text to a shared prefix, categorises both lines and reads the rule's value. |
| 12 | Leaving and reopening the wizard showed the cached group | medium | patch | The step and preview queries are dropped once unused (`gcTime: 0`). |
| 13 | Skip then back showed a stale group | medium | patch | Same fix as 12. |
| 14 | Categorising a preview reshuffles positions | low | reject | Sure's positions move the same way. |
| 15 | A failed preview showed an empty list | low | patch | The list shows the error's message. |
| 16 | Two simultaneous categorisations could create the same rule twice | low | reject | Needs two submissions at the same instant in one household. |
| 17 | `updated` counts matched rows, not changed ones | low | reject | Sure's `bulk_update!` count; the interface does not show it. |
| 18 | A loan payment's outflow gets an « expense » rule its type never matches | low | reject | Sure's type condition reads it as a transfer the same way (`docs/sure-parity.md`, « Type condition »). |
| 19 | A label past 200 characters always fails the rule | low | reject | Archant's value limit; the failure says so with Sure's message. |
| 20 | The rule text stayed editable with the box unticked | low | patch | The field and its check follow the box, as Sure's `toggleRuleDetails`. |
| 21 | e2e counted every rule, which another file's rules could break | false | reject | One worker, and every rule file deletes its rules after each test. |
| 22 | The all-done path had no browser test | medium | patch | e2e opens a position past the last group and sees the toast on « Opérations ». |
| 23 | Nothing checked the group stays after a line's own category | medium | patch | e2e reads the heading and the unticked rule box after the line's pick. |
