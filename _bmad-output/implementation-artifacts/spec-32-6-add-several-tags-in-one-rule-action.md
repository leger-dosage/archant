---
title: "Story 32.6: Add several tags in one rule action"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: '47df6c345555416de44f578fa00b46c6758f1bb8'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) `Rule::ActionExecutor::SetTransactionTags` is a `multi_select`: `Rule::Action#value=` stores the picked tag ids comma-separated in `value`, `execution_value` splits them, `execute` keeps the family's existing ids (`family.tags.where(id:)`), returns at once when none is left, skips a transaction whose tags are locked, and merges `existing_tag_ids` with the selected ones. `Rule#no_duplicate_actions` refuses two actions of one type with « La règle ne peut pas avoir d'actions en double ». Archant's tag action holds one id: `rule-reader.ts` reads a comma list as a deleted tag, so a Sure archive's multi-tag action, already stored as `a,b` by `sure-rules.ts` `tagsValue`, is inert, and the form's picker closes after one tag.

**Approach:** the action's value becomes Sure's comma-separated list of tag ids. `ruleSchema` normalises it (trimmed ids, blanks dropped, duplicates removed, pick order kept), the service checks each id exists, the reader keeps the ids still in `tags`, and the evaluator adds every one the row lacks. A migration folds a rule's several tag actions into the first. The form's tag action picks several tags in one picker; the list, `rules.csv` and the assistant's reads name every tag.

## Boundaries & Constraints

**Always:**
- Stored value: tag ids joined by `,`, no blank, no duplicate, in pick order; at most `MAX_TAGS_PER_TRANSACTION` (20) ids, past which the API answers `too_big`.
- Evaluation: a locked `tags` field keeps its tags (AD-10); a deleted id is ignored; an action left with none writes nothing; tags are added after the row's own, never removing one, up to `MAX_TAGS_PER_TRANSACTION` held.
- Two actions of one type stay refused, tags included, `duplicate_action`, now worded as Sure: « La règle ne peut pas avoir d'actions en double. »
- The migration keeps every rule and every other action; run snapshots stay as they ran.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no new column or table (Sure keeps the list in `value`); no new dependency; no change to the tag condition, which names one tag.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Two tags | action `A,B`, row tags `[C]` | row tags `[C, A, B]` | none |
| Already there | action `A,B`, row tags `[B]` | `[B, A]` | none |
| Locked | action `A,B`, `tags` locked | unchanged | none |
| Deleted | action `A,gone`, `gone` deleted | adds `A` only | none |
| All deleted | action `gone` | writes nothing, counts no change | none |
| Full row | row holds 19 tags, action `A,B` | adds `A` only | none |
| Body | ` A , ,B,A ` | stored `A,B` | none |
| Unknown id | `A,nope` | nothing written | `400` `actions.0.value` `invalid_value` |
| Too many | 21 ids | nothing written | `400` `too_big` |
| Upgrade | rule with tag actions `A` and `B,C` | one action `A,B,C` at the first's position | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/rule/action_executor/set_transaction_tags.rb`, `app/models/rule/action.rb` (`value=`, `value_display`, `execution_value`), `app/models/rule.rb` (`no_duplicate_actions`), `app/views/rule/actions/_action.html.erb` (`DS::TagSelect`), `config/locales/models/rule/fr.yml`, `app/models/family/data_exporter.rb` (`resolve_multi_tag_operand`).
- Data: custom migration `0097` through `pnpm data generate --custom`, `migrate.spec.ts`; `schema/rules.ts` comment.
- API: `domain/rules/matching.ts` (`TagAction.tagIds`, `applyAction`), `services/rule-reader.ts` (`toAction`), `schemas/rules.ts` (normalised value, `too_big`), `services/rules.ts` (`assertReferencesExist` per id), `mcp/rules.ts` (`idsIn`, `snapshotOf`), `schemas/assistants/rules.ts` (description); their specs, `services/export.spec.ts` for two tags.
- Interface: `components/RuleReferenceField.tsx` (a multiple tag picker), `components/RuleActionRow.tsx`, `lib/rule-summary.ts`, `locales/fr.json`.
- e2e: `packages/app/e2e/rules.spec.ts` (the four-actions test picks two tags; the picker-creation test's labels).
- Docs: `docs/sure-parity.md` row « Actions ».

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `matching.spec.ts` merge with existing tags, locked, deleted, full row; `rule-reader` through `services/rules.spec.ts`; `routes/rules.spec.ts` normalisation, unknown id, too many, duplicate tag actions; `migrate.spec.ts` for 0097; `rule-summary.spec.ts`; `mcp/server.spec.ts` read of two tags; `export.spec.ts` two tags.
- [x] Data: migration.
- [x] API: evaluator, reader, schema, reference check, assistant.
- [x] Interface: multiple picker, labels, summary; e2e.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given the rule form, when « Ajouter des étiquettes » is picked, then its picker stays open and ticks several tags, and the button names them « A, B ».
- Given a rule adding tags A and B, when it runs on a line tagged C, then the line holds C, A and B.
- Given the list, then the rule reads « … alors Ajouter les étiquettes A, B ».
- Given a database with a rule holding two tag actions, after migration it holds one with every tag.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The value stays a string in the API body and the form, comma-separated, as Sure's column; no array field.
- At most 20 tags in one action: Sure sets no limit, but Archant's transaction holds at most `MAX_TAGS_PER_TRANSACTION`, and the picker already stops there.
- The summary and the assistant's read name the tags as Sure's `value_display`: joined by « , », a deleted tag left out of the summary; the assistant keeps a deleted tag's id, as it does for one tag today. Every tag deleted reads « Étiquette supprimée ».
- The action's name becomes « Ajouter des étiquettes », the story's wording; Sure's label is the untranslated « Set transaction tags ».
- Past runs are not migrated: a snapshot records the rule as it ran.
- Existing data does not change behaviour on upgrade: the API always refused a second tag action, and a Sure archive's multi-tag action, stored as `a,b` by `tagsValue`, failed `assertReferencesExist`, so none is stored. Such an archive now imports, the action holding every tag.
- The form's picker drops a deleted tag at the first tick and names it « Étiquette supprimée » beside the others meanwhile, since the API refuses a deleted id on save, as it did for one tag.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated snapshot and the planning files; no second `bmad-code-review` pass over the same diff.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A deleted tag among live ones stays hidden in the form's value, the picker cannot untick it, and saving fails `invalid_value` with no hint | medium | patch | `RuleTagsField` passes only live ids to `TagCombobox`, drops dead ids at the first tick and adds « Étiquette supprimée » to the button. |
| 2 | Migration 0097 relies on an ordered subquery for `group_concat` order | low | patch | Now `group_concat(id, ',' ORDER BY rank)`; libsql ships SQLite 3.45.1. |
| 3 | Migration 0097 comment presents the rule as new though the API always refused duplicates | low | patch | Comment says only a row written by hand can hold two. |
| 4 | Migration may fold past 20 tags, which the API would refuse on a later edit | low | reject | No path writes a second tag action; the evaluator caps at 20 anyway. |
| 5 | Sure-imported multi-tag rules silently turn active after upgrade | false | reject | `createRule` ran `assertReferencesExist` on `a,b` and threw: no such action is stored. Design note corrected. |
| 6 | No test imports a Sure tag action naming several tags | medium | patch | `sure-import.spec.ts` imports `"Voyage, été",Italie` into one action holding both ids in order. |
| 7 | Unticking a tag is not exercised | low | patch | The e2e four-actions test unticks and reticks a tag. |
| 8 | `too_big` reads « Ce texte est trop long. » and the picker does not stop at 20 | false | reject | `TagCombobox` disables new tags at `MAX_TAGS_PER_TRANSACTION`; only an API client reaches `too_big`. |
| 9 | The assistant's read joins names with « , », ambiguous for a name holding a comma, and keeps a deleted id | low | reject | Sure's `value_display` joins with « , »; a deleted id kept as for one tag today. |
| 10 | Two exported components named `TagsField` | low | patch | The rule's is `RuleTagsField`. |
| 11 | `duplicate_action` wording changed for every type | false | reject | The story asks for Sure's « La règle ne peut pas avoir d'actions en double ». |
| 12 | The assistant description hard-codes 20 | low | patch | It reads `MAX_TAGS_PER_TRANSACTION`. |
| 13 | A Sure tag action of more than 20 tags skips the rule | low | reject | Unlikely; Archant's transaction holds 20 at most. |
| 14 | A value of many commas is split before its refusal | low | reject | The server's body limit bounds it; the split is linear. |
| 15 | No route test of an update normalising the tags | low | reject | `ruleSchema` is shared by create and update; the create test covers the normalisation. |
