---
title: 'Story 8.3: Apply rules to existing transactions'
type: 'feature'
created: '2026-09-24'
status: 'done'
baseline_commit: '596c329209976f8b0a5356448aff143e99f211ce'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2-more-rule-conditions-and-actions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Rules reach only transactions ingested after they exist, so a new or corrected rule leaves the history untouched (FR37, FR38).

**Approach:** Add a count preview and a confirmed application of one rule, or of every enabled rule in order, over existing transactions. Both reuse 8.2's `planActions` and `applyRulePlan`; each confirmed application records one run per rule, listed on `/regles`.

## Boundaries & Constraints

**Always:**
- Candidates are every transaction entry, pending and excluded included, loaded from the database with merchant, category, tags, notes, transfer kind, expected counterpart and `locked_fields`, dated on or after the earliest `effectiveDate` of the rules applied (none: all dates). Loading batches ids by `KEYS_PER_LOOKUP` for SQLite's parameter cap.
- Preview and application run the same plan: `planActions(rules, candidates, reportingCurrency, MAX_TAGS_PER_TRANSACTION)`. The preview count is the plan's size: only rows whose targeted field is neither locked nor already at that value count. « Appliquer toutes les règles » counts distinct rows over enabled rules in creation order.
- `planActions` also reports, per rule, `matched` (rows the rule matched against the state earlier rules planned) and `changed` (rows it altered in the plan). Its current map output and chaining stay as they are.
- Application writes in one `{ behavior: "immediate" }` transaction: re-plan inside it, `applyRulePlan(tx, plan, { origin: "rule" })` (locks respected, nothing locked, `category_origin = 'rule'`), then step 6's matcher on the rows whose `expected_transfer_account_id` it set, then one `rule_runs` row per rule applied. `applyRulePlan` returns the changed ids and the marked ids instead of a count; step 5 of `ingest` adapts.
- `rule_runs` (migration `0023`): `id`, `rule_id` nullable FK `on delete set null`, `rule` JSON snapshot of the rule's name, conditions and actions as `GET /api/rules` returns them, `matched_count`, `changed_count`, `executed_at` ms, index on `executed_at`. The page builds the label from the snapshot with `ruleSummary` and today's names, so a later edit of the rule does not rewrite past runs.
- API: `GET /api/rules/preview` and `POST /api/rules/apply` (enabled rules), `GET /api/rules/:id/preview` and `POST /api/rules/:id/apply` (that rule, enabled or not), `GET /api/rules/runs` with `pageQuerySchema`, newest first, `{ items, page, pageSize, total }`. Preview answers `{ changed }`; apply answers the runs it recorded. Unknown rule: 404 as `PUT /:id` does. Static paths are registered before `/:id`.
- UI: after a create or edit succeeds, `RuleDialog` hands the saved rule to the page, which fetches the preview and opens one `ConfirmDialog`: « N opérations seront modifiées » (`_one`/`_other`, « Aucune opération ne sera modifiée » at 0), « Appliquer » and « Plus tard » (new `cancelLabel` prop). The rule menu gains « Appliquer aux opérations existantes »; the header gains « Appliquer toutes les règles », disabled without an enabled rule. Success toast states the changed count. « Exécutions récentes » is a table under the list: date, rule label, matched, changed, paginated through `Pagination` with a `runsPage` search param.
- After an application the web invalidates what `useInvalidateBulk(…, { balances: true })` does plus rules and runs.

**Never:** no lock added by an application; no application of disabled rules by « Appliquer toutes les règles »; no run recorded by an import, a preview or « Plus tard »; no background job; no change to `ingest`'s step order or to `mutualMatches`; no balance recompute, since no rule action moves an amount (`recomputeBalances` sums excluded rows too, and a transfer link moves no balance); no raw SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Count | 5 rows match « contient carrefour » → Courses; 1 locked, 1 already Courses | Preview 3; apply changes 3; run matched 5, changed 3 | — |
| Start date | Rule from 2026-06-01; rows in May and June | Only June rows | — |
| Chain | Rule 1 sets merchant Amazon, rule 2 `Marchand est Amazon` adds tag | All: rule 2 sees rule 1's merchant; two runs | — |
| Transfer type | Row already in a transfer, `Type est Virement` → Étiquette | Tagged | — |
| Transfer action | Unmatched row → Virement avec Livret A, one candidate there | Paired | Several candidates: stays unpaired |
| Disabled | Disabled rule, « Appliquer toutes les règles » | Not applied, no run | — |
| Nothing | No enabled rule | Button disabled | API: no run, `[]` |
| Unknown | `POST /api/rules/<unknown>/apply` | — | 404 |

</frozen-after-approval>

## Code Map

- `packages/api/src/domain/rules/matching.ts` -- `Rule` 114, `RuleCandidate` 122, `matches` 252 (start date 253), `RowPlan` 267, `planOf` 316, `planActions` 344: add per-rule tallies without changing the map.
- `packages/api/src/services/ledger.ts` -- step 5 913–940; `applyRulePlan` 1017 (re-read `plannedRows` 994, `changeOf` 1231, in-transfer skip 1097–1101); `matchNewTransfers` 2302, private, export it or wrap it; `candidatePairs` 2258. Candidate loader to write from `editableColumns` 1171, `inAnyTransfer` 2125, `transferColumns` 2550–2562 (kind via `asOutflow`/`asInflow`), `tagIdsByEntry` 2683; batching `inSequence`/`chunksOf` 136–160. Keep `isTransferSide` 2801 parity with `direction()`.
- `packages/api/src/services/rules.ts` -- `readRules` 67, `getRule` 140, `toAction` 473, `toCondition` 498, `loadEnabledRules` 525; add a by-id loader and the preview, apply and runs functions. Transactions use `{ behavior: "immediate" }` as at 338.
- `packages/api/src/routes/rules.ts` 17–48; list model `services/imports.ts` `listImports` 429–481; `pageQuerySchema` `schemas/transactions.ts` 144, used as in `routes/accounts.ts` 97.
- `packages/data/schema/rules.ts`, `types.ts`, `migrate.spec.ts`; model `schema/imports.ts` 72–99. `pnpm --filter @archant/data generate --name add_rule_runs`; add `ON DELETE set null` by hand if drizzle-kit drops it, as `0022` did.
- Web: `routes/_authed.regles.tsx` (`Opened` 46, `RuleRow` menu 85–97, `RuleDialog` 228, `ConfirmDialog` 237, `names` 133), `components/RuleDialog.tsx` submit 821–845 (add `onSaved`), `components/ConfirmDialog.tsx`, `hooks/useRules.ts` (`useInvalidateRules` comment 19 is now false), `hooks/useTransactions.ts` `useInvalidateBulk` 243, `lib/query-keys.ts` 49, `components/Pagination.tsx` `PageTarget` 11, `lib/page-search.ts`, `hooks/useClampPage.ts`, `components/ImportHistory.tsx` (table, `dayOf` 26, pending text 91–95), `lib/rule-summary.ts` `ruleSummary` 172, `locales/fr.json` `rules` (reword `description` and `form.description`, which say rules reach new transactions only).
- E2E: `e2e/fixtures.ts` `createRule` 332, `deleteRules` 349 (also clear runs), `addTransaction` 162, `importFile` 237; `e2e/rules.spec.ts` helpers 13–47.
- Coverage: `src/domain/**` and `services/ledger.ts` at 100 %.

## Tasks & Acceptance

**Execution:**
- [x] `packages/data/schema/rules.ts`, `types.ts`, `migrate.spec.ts`, `drizzle/0023_*` -- failing test for the table and the set-null FK, then schema and migration.
- [x] `packages/api/src/domain/rules/matching.spec.ts`, `matching.ts` -- failing cases for per-rule tallies under chaining and locks, then the tallies.
- [x] `packages/api/src/services/ledger.spec.ts`, `ledger.ts` -- candidate loader (transfer kind, tags, locks, start date, more than 500 rows), `applyRulePlan`'s new return, transfer matching on marked ids.
- [x] `packages/api/src/services/rules.spec.ts`, `services/rules.ts`, `routes/rules.ts` -- preview, apply one, apply all, runs page, 404.
- [x] `packages/api/src/app.spec.ts` -- `describe("rules")`: the matrix rows through HTTP.
- [x] `packages/web/src/components/ConfirmDialog.tsx`, `RuleDialog.tsx`, `routes/_authed.regles.tsx`, `hooks/useRules.ts`, `lib/query-keys.ts`, `components/Pagination.tsx`, `lib/page-search.ts`, `locales/fr.json` -- dialog after save, menu item, header button, runs table.
- [x] `packages/web/e2e/fixtures.ts`, `e2e/rules.spec.ts` -- one test per criterion below.

**Acceptance Criteria:**
- Given three « CB CARREFOUR » rows, one set to « Loisirs » by hand, when I create « Libellé contient carrefour » → Courses, then the dialog reads « 2 opérations seront modifiées »; « Appliquer » sets both to Courses and leaves the third on Loisirs.
- Given the same dialog, when I choose « Plus tard », then no row changes, no run appears, and a new matching row added next is categorised.
- Given a rule's menu, when I choose « Appliquer aux opérations existantes » and confirm, then « Exécutions récentes » shows a row with the rule's label, matched and changed counts.
- Given two enabled rules and one disabled, when I choose « Appliquer toutes les règles », then the dialog counts distinct rows for the enabled two and confirming adds two runs.
- Given more runs than a page holds, when I go to the next page, then older runs show.

## Implementation Notes

- `planActions` returns `{ plan, perRule }`: `plan` is the map it returned before, `perRule` one `{ ruleId, matched, changed }` per rule in the order given. A rule's `changed` compares the row before and after its own actions, so a row two rules both change counts once in `plan` and once in each rule's tally; the preview of « Appliquer toutes les règles » reads `plan.size`, never a sum of tallies.
- `ledger.ruleCandidates(db, from)` reads the transfer kind through the same `asOutflow` / `asInflow` joins as the list, so `direction()` sees what the list's type filter sees. Rows are one query; tags go through `tagIdsByEntry`, `KEYS_PER_LOOKUP` ids per query. `applyRulePlanToHistory(deps, plan, { origin: "rule" })` is the ledger's one entry point for the write, in its own immediate transaction (AD-2): `applyRulePlan`, then the private `matchNewTransfers` on the marked ids, which already handles rows that are not new; two marked rows that pick each other come once through `mutualMatches`. `applyRules` calls it with `{ ...deps, db: tx }` inside its own transaction, so the ledger's becomes a savepoint and the runs commit with the writes, as `deleteCategory` does with `recategorise`.
- `services/rules.ts` imports the ledger and the ledger imports `loadEnabledRules`: a module cycle, harmless because neither calls the other at load time. The service writes `rule_runs` only; transactions, taggings and transfers stay the ledger's.
- The earliest start is `null` as soon as one applied rule has no start date, since that rule reaches every date.
- `RuleData` is now `RuleSnapshot` plus the id, switch and start date, and conditions use `RuleConditionSnapshot` directly, so the snapshot a run stores and `GET /api/rules` share one type.
- `POST /api/rules/apply` and `POST /api/rules/:id/apply` answer 200 with `{ changed, runs }`: `changed` is the number of rows `applyRulePlan` wrote, each once, and `runs` the runs recorded. 200 because they create no resource the client addresses.
- `rule_runs.position` is the rule's place in its application. The runs of one « Appliquer toutes les règles » share `executed_at`, so the list orders by `executed_at desc, position asc`, and one application never splits across pages at random.
- The page reads the preview with `queryClient.fetchQuery` (`useFetchRulePreview`), then opens the confirmation with the count, rather than a query kept open under the dialog: the dialog keeps the count it showed while it closes, and the invalidation after an application cannot redraw it mid-animation.
- The success toast states the `changed` the application answers, not the preview's count nor a sum of the runs' `changedCount`, which would add up a row two rules both change.
- « Plus tard » labels the cancel button only in the dialog that follows a save; from the menu or « Appliquer toutes les règles » it stays « Annuler ». A preview being read blocks another: the menu item and the header button are disabled, and a ref guards the click before the state renders.
- `useInvalidateBulk` is exported from `hooks/useTransactions.ts`; `useApplyRules` calls it with `{ balances: true }` and invalidates `queryKeys.rules.all`, under which the runs and the preview keys sit.
- `deleteRules` in the end-to-end fixtures does not clear runs: the API has no route that deletes a run, and the story's API list adds none. Runs outlive their rule with `rule_id` null, as they would for the user; each test finds its runs by a rule name or label of its own, and the pagination test pushes its older run past 50 newer ones. `applyRule` is the new fixture.
- Story 8.1 and 8.2 end-to-end tests that save through the form now answer « Plus tard » to the confirmation that follows every save.

## Spec Change Log

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind, edge, verification-gap | Runs of one « Appliquer toutes les règles » share `executedAt`, so `desc(id)` orders them by random UUID and may split an application across pages at random | medium | patch: `position` column, order `executedAt desc, position asc` |
| 2 | blind, edge | The success toast states the preview count, not the rows written; `applyRulePlan`'s `changed` is dropped | medium | patch: apply answers `{ changed, runs }`, the toast reads `changed` |
| 3 | blind | No id groups the runs of one application | low | rejected: Sure's `RuleRun` has none either, and the spec asks for one run per rule |
| 4 | blind | The `rule` JSON snapshot is read without validation | low | rejected: only the validated service writes it; a later change to the rule model owns its migration |
| 5 | blind | The Code Map says `deleteRules` clears runs, the notes say it does not; spec and sprint statuses differ | low | rejected: fix is a spec edit; the Implementation Notes record why, and statuses move by workflow step |
| 6 | blind | « Plus tard » shows on explicit applications too, where it reads as scheduling | low | patch: `cancelLabel` only on the dialog after a save |
| 7 | blind, edge | At 0 the dialog still opens after every save, and confirming records runs with no change | false | intended: the plan shows the dialog at 0 and records the run, as Sure does |
| 8 | blind, edge | `askToApply` has no guard against a second preview; the menu item stays active | low | patch: early return while a preview is pending, menu item disabled |
| 9 | blind | Runs built with `perRule[index]?.ruleId ?? null` and `?? 0` would silently write a run with no rule on a mismatch | low | patch: build runs from `perRule`, no defaulting |
| 10 | blind | The immediate transaction holds the write lock while it loads the history | low | rejected: the spec asks for one immediate transaction; one household's history loads in one pass |
| 11 | blind | No test that `ruleCandidates` skips valuations, nor of the zero-count title | low | patch: one ledger assertion, one e2e assertion |
| 12 | blind | The runs table shows the day only | low | rejected: same format as the import history |
| 13 | edge | A rule's `changedCount` counts rows a later rule overwrites | false | intended: the spec defines `changed` as rows the rule altered in the plan |
| 14 | verification-gap | `earliestStart` over several rules is untested; three regressions would pass | medium | patch: two cases in `rules.spec.ts` |

## Design Notes

Taken from Sure rather than asked: one run per rule, including under « Appliquer toutes les règles » (`ApplyAllRulesJob` calls `RuleJob` per rule); a name snapshot on the run with the rule reference kept for display; start date as « on or after »; the dialog after creation. Departures beyond the epic's list: Sure shows no dialog after an edit, the story asks for one; Sure runs in a background job, Archant writes synchronously in one transaction because one household's history fits in memory and SQLite writes it in one pass; Sure's run carries status and queued counts for its jobs, which a synchronous write does not need. Applying a disabled rule from its menu leaves its switch as is, where Sure's apply enables it, because here enabling is already independent of the dialog.

The snapshot stores the rule rather than a French string, so the API stays free of `fr.json` and the label follows the interface's summary code.

Apply sketch:

```ts
await db.transaction(async (tx) => {
  const candidates = await ruleCandidates(tx, earliestStart(rules));
  const { plan, perRule } = planActions(rules, candidates, currency, MAX_TAGS_PER_TRANSACTION);
  const { marked } = await applyRulePlan(tx, plan, { origin: "rule" });
  await matchNewTransfers(tx, marked, now);
  await tx.insert(ruleRuns).values(perRule.map(toRun));
}, { behavior: "immediate" });
```

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.
