---
title: 'Story 8.2: More rule conditions and actions'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: 'b370fd1af9982362b5219a50bef83a9afab9a746'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-1-create-a-categorisation-rule.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A rule can only set a category, so a recurring line still needs its merchant, tags, label, exclusion or transfer pairing done by hand (FR36, FR38).

**Approach:** Extend Story 8.1's model with Sure's merchant, category, tag, notes and type conditions, the `is_null` operator, and Sure's merchant, tag, name, exclude and transfer actions. Step 5 plans every action per row and writes the plan through one lock-respecting ledger writer. The transfer action stores an expected counterpart account that step 6 reads; it never creates an entry or a transfer.

## Boundaries & Constraints

**Always:**
- `packages/data/rules.ts` gains condition types `transaction_merchant`, `transaction_category`, `transaction_tag` (`=`, `is_null`), `transaction_notes` (`like`, `=`, `is_null`), `transaction_type` (`=`, value `income`, `expense` or `transfer`), and action types `set_transaction_merchant`, `set_transaction_tags`, `set_transaction_name`, `exclude_transaction`, `set_as_transfer_or_payment`. Migration `0022` rebuilds the rule tables for the new checks, makes `rule_actions.value` nullable (exclude has none), and adds `transactions.expected_transfer_account_id`, nullable, FK to `accounts` `on delete set null`.
- Conditions, as Sure: category matches that id only, never its children; tag `=` matches a row carrying that tag among others, `is_null` a row with no tag; merchant and category `is_null` match null; notes compare like the label (8.1's squish, `like` case-folded, `=` exact) and `is_null` matches null, which the API stores for empty notes. Type is `direction()` from `domain/cash-flow.ts`, the rule the list's type filter already uses: a transfer side is `transfer`, except the spent outflow of a loan payment or investment contribution, which is `expense`; otherwise `amount > 0` is `income`, else `expense`.
- Rules run in creation order over one planned state per row. A later rule's conditions see what earlier rules planned: category, merchant, tags, label, excluded. An action on a field listed in the row's `locked_fields` (`category`, `merchant`, `tags`, `label`, `excluded`) is dropped from the plan, so later rules see the unchanged value. A row created by hand has `label` and, when filled, `notes` locked, so « Renommer » never touches it.
- Actions: merchant sets `merchant_id`; the tag action adds one tag and keeps the others, skipped at `MAX_TAGS_PER_TRANSACTION`; rename sets `label`, value required and trimmed; exclude sets `excluded = true`; the transfer action sets `expected_transfer_account_id` on a row not in a transfer. Rules add no lock. Dangling references are inert, as in 8.1.
- One ledger writer replaces `setRuleCategories`, takes the per-row plan and `{ origin: "rule" }`, re-checks locks and references, and writes category with `category_origin = 'rule'`. Story 8.3 reuses it.
- Step 6 narrows candidate lists before `mutualMatches`: a row expecting account X keeps only its candidates on X; a row without an expectation, one of whose candidates expects its account, keeps only such candidates. A unique pair then forms as today, so one candidate on X pairs even when other accounts hold candidates, several leave the row for the user, and an existing row's expectation pairs with a later ingest. Kind follows the inflow account. Rejected pairs stay rejected.
- Validation, per type: unknown merchant, category, tag or account `invalid_value` on `.value`; empty rename `too_small`; `is_null` stores null; an action value on exclude refused.
- Form: several actions, one per type, « Ajouter une action » while a type remains. Summary as Sure: first action, then « et N autres actions ».

**Never:** no condition on an amount sign other than type; no « est vide » on label; no rule effect in the import preview; no entry or transfer created by a rule; no display of the expectation on the transaction; no change to `mutualMatches`; no raw SQL; no application to existing transactions (8.3).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chain | Rule 1 `Libellé contient amzn` → Marchand Amazon; rule 2 `Marchand est Amazon` → Étiquette Achats | Merchant and tag set | — |
| Subcategory | `Catégorie est Alimentation`, row in Courses (child) | No match | — |
| Tag empty | `Étiquette est vide`, row planned with a tag by rule 1 | No match | — |
| Type | `Type est Dépense`, amounts −10 and +10 | Only −10 | — |
| Type transfer | `Type est Virement` at ingest | No match | — |
| Locked label | Row created by hand, rule renames | Label unchanged | — |
| Add tag | Row with tags A; action adds B | A and B | At 20 tags: skipped |
| Rename empty | Action `set_transaction_name` value « » | — | 400, `actions.N.value` `too_small` |
| Expected, one | Row on A expects B; B holds one candidate, C holds one | Paired with B's | — |
| Expected, several | B holds two candidates | Unpaired | — |
| Later side | Row expects B, no candidate; B's line imported next | Paired at that import | — |

</frozen-after-approval>

## Code Map

- `packages/data/rules.ts` (types 9, operators 18, `RULE_OPERATORS_BY_TYPE` 27, actions 37), `schema/rules.ts` (checks 58–72, 94; `rule_actions.value` not null 90), `schema/transactions.ts` (`LOCKABLE_FIELDS` 13, notes 40, excluded 45, merchant 64), `schema/taggings.ts`, `migrate.spec.ts`. `pnpm --filter @archant/data generate --name extend_rules`.
- `packages/api/src/domain/rules/matching.ts` -- `RuleCandidate` 58 gains `merchantId`, `categoryId`, `tagIds`, `notes`, `inTransfer`, `lockedFields`; `leafMatches` 112; `planCategories` 170 becomes a plan of all actions, each rule matched against the state earlier rules planned.
- `packages/api/src/services/ledger.ts` -- step 5 at 908–925, `setRuleCategories` 964–1022 to generalise; step 6 `matchNewTransfers` 2176, `candidatePairQuery` 2092 (add `expectedAccountId` to source and candidate columns), `inTransferSql` 2004, `isTransferSide` 2665 (SQL twin of `direction()`). Tags are written by callers (`updateTransaction` ~1289, bulk 1480–1498); `detailOf` 1139 has no tags. New rows carry no merchant, category or tags; `filledFields` 426 locks `label` and `notes` on manual creation.
- `packages/api/src/domain/transfer-matching.ts` -- `mutualMatches` 83 unchanged; add the pure narrowing function beside it.
- `packages/api/src/services/rules.ts` -- `assertReferencesExist` 153 assumes a category action; `toLeaf` 341 and `loadEnabledRules` 388. `schemas/rules.ts` `ruleSchema` 155, `storedValue` 120. `MAX_TAGS_PER_TRANSACTION` in `schemas/transactions.ts` 11.
- Web: `components/RuleDialog.tsx` (`LEAF_TYPES` 54, `newAction` 73, `LeafRow` 186, `CategoryAction` 396, action section 640–672, props 466), `MerchantCombobox` (`mode: "target"`), `TagCombobox` (reuse with one id), `lib/rule-summary.ts` (`OPERATOR_KEYS` 25, `SummaryNames` 68, `ruleSummary` 108), `hooks/useRules.ts`, `routes/_authed.regles.tsx`, `locales/fr.json` `rules` 773 (reword `rules.description`).
- E2E: `e2e/fixtures.ts` `createRule` 332 hard-codes a category action; `createMerchant` 279, `createTag` 303, `setTags` 315, `matchTransfer` 366; `e2e/rules.spec.ts`.
- Coverage: `src/domain/**` and `services/ledger.ts` at 100 %.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/rules.ts`, `schema/rules.ts`, `schema/transactions.ts`, `types.ts`, `migrate.spec.ts`, `drizzle/0022_*` -- failing test for the new checks, the null action value and the FK's set null, then lists, columns, migration.
- [x] `packages/api/src/domain/rules/matching.spec.ts`, `matching.ts` -- failing matrix rows for conditions, chaining and locks, then the evaluator and the plan.
- [x] `packages/api/src/domain/transfer-matching.spec.ts`, `transfer-matching.ts` -- failing cases for both narrowing directions, then the function.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- the plan writer (locks, tag cap, dangling ids, in-transfer row) and step 6 narrowing, including the later-side import.
- [x] `packages/api/src/schemas/rules.ts`, `services/rules.ts`, `services/rules.spec.ts` -- per-type validation and loading.
- [x] `packages/api/src/app.spec.ts` -- `describe("rules")`: each new condition and action through manual creation or OFX import, each refusal with its field.
- [x] `packages/web/src/lib/rule-summary.ts` + spec, `RuleDialog.tsx`, `routes/_authed.regles.tsx`, `hooks/useRules.ts`, `locales/fr.json` -- fields, operators, value pickers, several actions, summary.
- [x] `packages/web/e2e/fixtures.ts`, `e2e/rules.spec.ts` -- `createRule` takes actions; one test per criterion below.

**Acceptance Criteria:**
- Given the form, when I open a condition's field list, then it offers « Marchand », « Catégorie », « Étiquette », « Notes » and « Type » with the operators above, and « est vide » hides the value.
- Given a rule « Libellé contient amzn » → Marchand Amazon, Ajouter une étiquette Achats, Renommer « Amazon », Exclure, when a matching line is imported, then the row shows Amazon, Achats, « Amazon » and is excluded; the list reads « Si Libellé contient amzn, alors Marchand Amazon, et 3 autres actions ».
- Given a rule « Libellé contient epargne » → Virement avec Livret A, when a line matches it and Livret A holds one opposite line within four days, then both rows show as a transfer.
- Given the form with an empty « Renommer » value, when I save, then the field shows its message and nothing is saved.

## Implementation Notes

- `RuleCandidate` carries `transfer: { kind } | null` rather than a bare `inTransfer`: the type condition calls `direction()`, which needs the kind to tell a loan payment's outflow from a transfer side.
- `planActions` takes the tag cap as a fourth argument, so `domain/` stays free of the request schemas; step 5 passes `MAX_TAGS_PER_TRANSACTION`. Its plan holds only what differs from the row (`RowPlan`), which Story 8.3's count can read as is.
- The transfer action also plans nothing when the expected account is the row's own: the matcher would then narrow the row to no candidate, and the Livret A side of « Libellé contient epargne » would block its own pairing. `applyRulePlan` re-checks it with the in-transfer case.
- `applyRulePlan` reuses `changeOf` and `detailOf` with `origin: "rule"`, so locks and `category_origin` follow the same code as a bulk edit.
- drizzle-kit leaves `ON DELETE set null` out of an added column; `0022` adds it by hand, as `0013` did for the merchant.
- A value on an exclusion is refused with `invalid_value`; a rename is capped at the transaction label's 200 characters (`too_big`); notes conditions share the label's 200.
- The summary keeps 8.1's order: « et N autres actions » follows the first action, then « et N autres conditions » closes the line.
- `rules.description`, the switch-off toast and the delete dialog now speak of what a rule changed, not only of categories.
- Action value pickers carry the action's name as their accessible name (« Catégorie », « Marchand », « Ajouter une étiquette », « Renommer », « Virement avec un compte »), so 8.1's end-to-end tests still find the category button by name.
- Review fixes: `applyRulePlan` skips a tag the row already carries; `toAction` throws `malformed()` on a null value outside `VALUELESS_RULE_ACTION_TYPES`; `RuleDialog.tsx` shares one `ReferenceField` between condition and action rows; three ledger cases (locked label stops chaining, second-pass narrowing, rejected pair) and one e2e case (merchant condition through its picker).
- A standards and spec review after the BMAD review named the action « Virement avec un compte », as the story does, typed `ReferenceCondition.operator` by its own types, and made the summary read type values from `RULE_TYPE_VALUES`. Kept as is: `default:` holding the last variant of each switch, which `consistent-return` requires and the rest of the code does; one reference map per layer, since `services/rules.ts` and `RuleDialog.tsx` map to different things (tables, pickers).

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind, edge | `applyRulePlan` pushes a planned tag the re-read row already carries, spending a cap slot and counting the row as changed | low | patch: unreachable at ingestion, reached by Story 8.3's reuse; skip a tag already present |
| 2 | blind, edge | `toAction` turns a null stored value into `""`, so a malformed rename would blank labels | low | patch: throw `malformed()` as `toLeaf` does; only the validated service writes today |
| 3 | blind | `expected_transfer_account_id` is never cleared, so an unlinked row may pair with another line on the same account | low | rejected: the expectation is what the rule asked for; the unlinked pair is recorded in `rejected_transfers` and never re-forms |
| 4 | blind | No index on `transactions.expected_transfer_account_id` for the `set null` cascade | low | rejected: account deletion is rare and one household's table scans fast |
| 5 | blind, edge | A transfer action naming an account in another currency narrows the row's candidates to none | low | rejected: the user named that account; the matcher never pairs across currencies, with or without the rule |
| 6 | blind, edge | « Type est Virement » never matches at ingestion | false | intended: the story's criterion states it, and Story 8.3 reaches rows already in a transfer |
| 7 | blind | `rules.description` says the last matching rule wins, untrue for an added tag or an exclusion | low | patch: reword to the last rule changing the same field |
| 8 | blind | A value sent with `is_null` is ignored, one sent with an exclusion refused | low | rejected: neither the form nor the typed client sends either |
| 9 | blind | The account, merchant, category and tag pickers are written twice in `RuleDialog.tsx` | medium | patch: one local picker component used by both rows; a fix to the deleted-item display would otherwise land twice |
| 10 | blind | No test that a rejected pair stays rejected when one side expects the other's account | medium | patch: ledger case |
| 11 | blind | No test that source expecting X and candidate on X expecting Y stay apart | low | rejected: follows from `narrowToExpected`'s tested branches |
| 12 | blind | No e2e test saves a merchant, category or tag condition through its picker | medium | patch: e2e case saving a merchant condition and reading the summary |
| 13 | blind | Spec status and sprint status differ; tasks name files absent from the diff | false | workflow state: sprint status moves at step 5; `hooks/useRules.ts` needed no change |
| 14 | edge | Source expecting X with no candidate on X loses a unique candidate elsewhere | false | intended: the story's criterion waits for the other side on X |
| 15 | edge | A transfer action naming the account of the rule's own account condition is inert | low | rejected: `applyAction` drops it on purpose; the user sees no pairing, as with any wrong account |
| 16 | verification-gap | No ingestion test that a locked label stops a later rule from chaining on a planned rename | medium | patch: ledger case, rename then `Libellé = new label` → category stays null |
| 17 | verification-gap | No ingestion test of the second-pass narrowing, where the expected account's line has another candidate | medium | patch: ledger case with a competing outflow on a third account |

## Design Notes

Taken from Sure rather than asked: operator names and `is_null`, category without children, tag `=` as « carries », type from transfer state then sign, tag action adding one tag, rename refusing blank, one action per type, the summary's « et N autres actions ». Departures: the transfer action (Epic 8 note); locks respected by every action, where Sure's transfer action ignores them; the type condition reuses `direction()`, so a loan payment's outflow is a « Dépense » as in the transaction list's filter, where Sure and the epic's wording call every transfer side a « Virement ». At ingestion no row is in a transfer yet, so this only shows in Story 8.3.

Step 5 sketch:

```ts
const plan = planActions(enabledRules, candidates, reportingCurrency); // Map<entryId, RowPlan>
await applyRulePlan(tx, plan, { origin: "rule" });
```

Rename leaves duplicate detection intact: import keys live in `entry_keys`, not in the label.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.
