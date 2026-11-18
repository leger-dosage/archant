---
title: "Story 32.13: Delete every rule"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'e65c7c8d'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) deletes every rule from the rules page: while a rule exists, `rules/index.html.erb` shows a page menu (`DS::Menu`) whose item « Supprimer toutes les règles » (`rules.index.delete_all_rules`, icon `trash-2`) sends `DELETE /rules/destroy_all` behind `CustomConfirm.for_resource_deletion("all rules", high_severity: true)`: a destructive, filled confirmation « Supprimer … ? », « Êtes-vous sûr de vouloir supprimer … ? Ceci n'est pas réversible. ». `RulesController#destroy_all` runs `Current.family.rules.destroy_all`, which takes each rule's conditions and actions with it, and redirects with « Toutes les règles supprimées ». The transactions keep what the rules wrote. Archant deletes rules one by one only.

**Approach:** `deleteAllRules` in `services/rules.ts`, one `delete from rules` in a transaction, conditions and actions following by their `on delete cascade`, answering `{ deleted }` as `deleteAllTags`. Route `DELETE /api/rules`. On « Règles », a page menu « Plus d'actions sur les règles » before « Appliquer tout », as the tags page's, with « Supprimer toutes les règles » for an administrator while a rule exists; a destructive `ConfirmDialog`, then the toast « Toutes les règles supprimées ».

## Boundaries & Constraints

**Always:** a viewer gets no menu and `viewerReadOnly` refuses the `DELETE` with 403 `FORBIDDEN`, nothing deleted; transactions keep their category, merchant, tags, label, exclusion and locks, as `deleteRule` leaves them; the menu shows only once a rule exists, as Sure's `@rules.any?`.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no new migration; no change to a single deletion; no change to the runs list.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Delete all | two rules, one with a group of conditions | `{ deleted: 2 }`, no rule, condition or action row left | none |
| Written rows | a line a rule categorised | category and `origin` unchanged | none |
| Runs | runs of the deleted rules | still listed, `ruleId` null, as after a single deletion | none |
| No rule | empty list | `{ deleted: 0 }`; the interface shows no menu | none |
| Viewer | `DELETE /api/rules` | 403 `FORBIDDEN`, rules kept | refused |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/controllers/rules_controller.rb#destroy_all`, `app/views/rules/index.html.erb` (`DS::Menu`), `app/helpers/custom_confirm.rb#for_resource_deletion`, `config/locales/views/rules/fr.yml` (`delete_all_rules`, `destroy_all.success`), `config/locales/views/shared/fr.yml` (`custom_confirm.resource_deletion_*`), `app/models/rule.rb` (`dependent: :destroy`).
- API: `services/rules.ts` (`deleteAllRules`), `routes/rules.ts` (`.delete("/")`).
- Interface: `hooks/useRules.ts` (`useDeleteAllRules`), `routes/_authed.rules.tsx` (page menu and dialog), `locales/fr.json` (`rules.menu`, `rules.deleteAll`).
- Tests: `routes/rules.spec.ts` (deletion, transactions left as they were, runs kept, a viewer's refusal), e2e `rules.spec.ts` (deletes every rule).
- Docs: `docs/sure-parity.md` « Delete all rules » row.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: every rule and its conditions and actions deleted, the categorised line unchanged, runs kept, the empty case, a viewer refused.
- [x] Service and route.
- [x] Hook, page menu, dialog, French texts.
- [x] e2e: two rules, « Supprimer toutes les règles », confirm, toast, empty state; no menu without rules.
- [x] Docs, story and sprint status, Epic 32 done.

**Acceptance Criteria:**
- Given rules, when the administrator picks « Supprimer toutes les règles » in the page menu and confirms, then every rule goes with its conditions and actions, the toast says « Toutes les règles supprimées » and the empty state shows.
- Given lines a rule changed, when every rule is deleted, then they keep what the rules wrote.
- Given a viewer or no rule, when « Règles » renders, then the menu is absent; a viewer's `DELETE /api/rules` answers 403.

## Design Notes

Assumptions taken alone, each settled by Sure or by an Archant convention:

- The confirmation writes Sure's `resource_deletion_*` sentences with « toutes les règles » in French, where Sure interpolates the English « All Rules »: « Supprimer toutes les règles ? », « Êtes-vous sûr de vouloir supprimer toutes les règles ? Ceci n'est pas réversible. », button « Supprimer toutes les règles », filled destructive as `high_severity`. The tags and categories pages' « Supprimer tout » add what happens to their lines; this one adds Archant's single deletion's sentence, « Les opérations qu'elles ont déjà modifiées restent telles quelles. », since the story asks it said.
- The menu item reads « Supprimer toutes les règles », Sure's `delete_all_rules`, where the tags page reads « Supprimer tout ». Sure's other item, « clear AI cache », has nothing to clear in Archant, which has no AI action.
- The empty state keeps Archant's « Aucune règle pour l'instant », the wording every Archant empty page uses, where Sure says « Pas encore de règles »: Archant keeps its words for the same thing.
- The runs of the deleted rules stay listed with their snapshot, as after Archant's single deletion since Story 32.10 (`rule_runs.rule_id` `on delete set null`), where Sure's `dependent: :destroy` drops them. Changing that is a single deletion's concern, outside this story.
- The menu shows on desktop only, as every rule control: the phone reads « Disponible sur ordinateur ».
- Visual QA found the confirmation's long button overflowing the 300-pixel dialog, as on the tags and categories « Supprimer tout »: the shared `AlertDialogFooter` now wraps a label that does not fit, and the page menu takes its item's width (`w-auto`, as `GoalMenu`).
- Upgrade: nothing stored changes.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff since `e65c7c8d`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent. The Verification Gap layer found no gap.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `deleteAllRules` writes outside an `immediate` transaction, unlike `deleteRule` and the spec | low | patch | Wrapped in `deps.db.transaction(..., { behavior: "immediate" })`, so it queues behind a sync's or an application's write as every rule write. |
| 2 | A deletion during a sync could break a run's insert on its foreign key | false | reject | The sync's rule writes run in an `immediate` transaction, and the deletion now waits for it (finding 1). |
| 3 | The page menu opens while « Appliquer tout » reads its count | low | patch | The menu button is disabled while `previewing`, as « Appliquer tout ». |
| 4 | The viewer test does not check its rule was created | low | patch | The `POST` asserts 201. |
| 5 | `sprint-status.yaml` still says `in-progress` | false | reject | Set to `done`, Epic 32 included, at step 5 of this run. |
| 6 | The empty state keeps « Aucune règle pour l'instant », not Sure's « Pas encore de règles » | low | reject | Recorded in Design Notes: Archant keeps its words for the same thing on every empty page; the fix edits this spec. |
| 7 | The parity row says « Parity » beside the runs that stay | low | patch | The row names `rules#destroy_all` and says the runs stay as after a single deletion since Story 32.10, where Sure drops them. |
| 8 | The API test checks the category only, not the merchant, tags or exclusion | low | reject | The deletion touches the `rules` table and its cascades only; no transaction column is written, as `deleteRule`. |
| 9 | e2e does not check the runs stay, nor that « Annuler » deletes nothing | low | reject | The API test covers the runs; « Annuler » is the shared `ConfirmDialog`, tested on every deletion. |
| 10 | e2e does not check the button is filled destructive | low | reject | `ConfirmDialog`'s `destructive` sets the variant, as the tags and categories delete all. |
| 11 | No test of a failed deletion's toast | low | reject | The same `showErrorToast` path as every deletion of the page. |
| 12 | Focus falls to the page once the menu's trigger unmounts | low | reject | The same as deleting the last rule or every tag; the toast is announced. |
