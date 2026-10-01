---
title: 'Story 15.6: The ledger in modules'
type: 'refactor'
created: '2026-10-01'
status: 'done'
baseline_commit: 'cd8271991f9b182459b662343fb676e65a49a641'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `services/ledger.ts` holds the whole money domain in 4,873 lines and 45 exports, so every money story edits it and stacked pull requests collide (STR-1). Its tests (`ledger.spec.ts`, 8,081 lines) and the routes' tests (`app.spec.ts`, 8,058 lines) sit far from what they cover (STR-2), and `ledger.ts` and `rules.ts` import each other (STR-3).

**Approach:** Move code, never rewrite it. Extract the rule reading both files need into `services/rule-reader.ts`, split `ledger.ts` into sixteen modules under `services/ledger/`, move each test beside what it covers, and make an import cycle a lint error.

## Boundaries & Constraints

**Always:**
- Function bodies, SQL, comments and test bodies move verbatim. The only edits are `import` lines, an `export` added to a helper another module now needs, and paths in comments.
- Modules and their exports follow the Code Map table. No module re-exports another; there is no `services/ledger/index.ts`; every importer names the module it uses, the four `import * as ledger` (`imports.ts`, `transactions.ts`, `transfers.ts`, `snapshots.ts`) become named imports. The module graph stays acyclic as the Code Map draws it.
- `services/rule-reader.ts` holds the read-only rule loading: `readRules`, `loadEnabledRules`, `knownReferences`, `toRule` and their private chain. `rules.ts` imports it and `ledger/rule-plans.ts`; `ledger/ingest.ts` imports it. Neither writes through it.
- `.oxlintrc.json` sets `"import/no-cycle": "error"`; today it reports exactly the `ledger` ↔ `rules` pair, so the gate costs nothing new. `pnpm dlx madge --circular --extensions ts packages/api/src` is run once and its output recorded in Implementation Notes; madge is not added as a dependency.
- AD-2 follows the code: the lint override that lifts `no-restricted-imports` names `packages/api/src/services/ledger/**` and `packages/api/src/testing/ledger.ts`, every lint message reads « Only services/ledger/ writes … », and the 100 % threshold in `packages/api/vitest.config.ts` keys on `src/services/ledger/**`.
- Ledger tests: one `<module>.spec.ts` beside each module, a top-level `describe` going to the module of the function it names, a scenario `describe` to the module whose behaviour it states (Code Map). Helpers used by more than one new spec file go to `packages/api/src/testing/ledger.ts`; the others move with their only user. Each file opens its own temporary database.
- Route tests: `packages/api/src/testing/app.ts` exports the harness (one `createSignedInTemplate` per file under the same fake clock, `buildApp`, `freshDatabase`, `request`, `openAccount`, `expense`, `postTransaction`, `balanceOf`, `errorBody`, the account fixtures). Each `describe` goes to `routes/<file>.spec.ts` for the route file that answers its first asserted request; `routes/middleware/daily-sync.spec.ts` takes « the first visit of the day »; `app.spec.ts` keeps only what `app.ts` itself does (compression, `onError`, body limit, serving the interface).
- `docs/architecture.md` (AD-2 rule, directory tree, table), `domain/cash-flow.ts` comments and `rules.ts:539`'s comment name the new paths.

**Never:** no renamed function, no changed signature beyond `export`, no reordered SQL, no test added, removed, merged or reworded; no new dependency; no barrel; no change outside `packages/api`, `.oxlintrc.json` and `docs/architecture.md`.

</frozen-after-approval>

## Code Map

Line ranges are `ledger.ts` at `cd82719`; imports split by use.

| Module | Lines | Holds |
|---|---|---|
| `shared.ts` | 108-115, 145-192, 2246-2249, 2530-2544, 3334-3339, 3345-3352, 3974-3996 | `Origin`, chunking, `transferOf`, `invalidField`, `deleteTransactionRows`, `inAnyTransfer`, `asOutflow`/`asInflow`, `transferColumns` |
| `balances.ts` | 147-150, 193-403, 3270-3321 | `recomputeBalances`, `balanceOn`, `balancesBetween`, `openingDateOf` |
| `accounts.ts` | 133-144, 404-450, 3209-3269 | `createAccount`, `deleteAccount` |
| `bank-link.ts` | 451-754 | `linkBankAccount`, `unlinkBankAccount`, anchors |
| `entry-keys.ts` | 902-999, 1063-1100, 1134-1185 | tombstones, `attachKeys` |
| `pending.ts` | 1000-1062, 2390-2440, 2545-2591 | `absorb`, `countMissedSyncs` |
| `ingest.ts` | 755-901, 1101-1133, 1186-1866 | `ingest`, `countsOf` |
| `rule-plans.ts` | 1867-2104 | `applyRulePlan`, `applyRulePlanToHistory`, `ruleCandidates` |
| `patch.ts` | 116-132, 2105-2245, 2250-2280, 4126-4150 | `TransactionPatch`, `changeOf`, `tagIdsByEntry` |
| `edits.ts` | 2281-2389, 2592-2963 | update, delete, bulk, recategorise, merchant and tag moves |
| `import-revert.ts` | 2964-3208 | `removableOf`, `revertImport` |
| `transfers.ts` | 3322-3333, 3340-3344, 3353-3737 | candidates, match, unmatch, reject |
| `duplicates.ts` | 2441-2529, 3738-3899 | candidates, merge, dismiss |
| `filter.ts` | 4151-4348 | `TransactionFilter`, `filterCondition` |
| `queries.ts` | 3900-3973, 3997-4125, 4349-4527 | find, list, sum, `cashFlowByCategory` |
| `snapshots.ts` | 4528-4873 | snapshots, `snapshotOn`, `oldestPendingDate` |

Graph, every module also using `shared`: accounts, import-revert, snapshots → balances; bank-link → balances, snapshots; pending → entry-keys, patch; rule-plans → patch, transfers; edits → balances, patch, entry-keys, filter; duplicates → balances, patch; queries → filter, transfers, patch; ingest → balances, bank-link, snapshots, entry-keys, pending, rule-plans, transfers, `../rule-reader.ts`.

- `packages/api/src/services/rules.ts:39,541` -- the cycle and `loadEnabledRules`; `toData`, `conditionTree` stay.
- Importers: `services/{accounts,bank-connections,balances,reports,categories,merchants,tags,rules,recurring,sync,imports,transactions,transfers,snapshots}.ts` and nine specs. Watch `services/accounts.ts` beside `ledger/accounts.ts`.
- `ledger.spec.ts:80-108` shared temp database; helpers at 233-297 and 518-631 are the cross-file ones. Scenario describes: « a transfer when a side goes » and « a rejected pair » → transfers; « rules at ingestion » → ingest; « pending transactions » and « identical pending lines » → pending and duplicates; « a deleted transaction and the next sync » → entry-keys; « a sync's earlier bank balances » → bank-link; « the direction filter », « transfer sides and categories » → filter.
- `app.spec.ts:1-157` harness; `:527-556` cross-route helpers; `:3334` `purgeStalePreviews` → `services/imports.spec.ts`; `:7752` bank sync → `routes/sync.spec.ts`. Pattern: `routes/version.spec.ts`. `lib/content-security-policy.spec.ts:19` names `app.spec.ts`, still right.
- `.oxlintrc.json:56-101,240-291`; `vitest.config.ts:26`; `docs/architecture.md:67,100,188,297,313`.

## Tasks & Acceptance

**Execution:**
- [x] baseline -- run `pnpm --filter @archant/api exec vitest run --project unit --reporter=json --outputFile=/tmp/before.json` and `grep -c "expect("` over both specs -- the counts the split must keep
- [x] `.oxlintrc.json` -- add `import/no-cycle`; confirm `pnpm lint:code` fails on the pair -- test first
- [x] `services/rule-reader.ts`, `services/rules.ts` -- extract the reader -- one commit
- [x] `services/ledger/*.ts`, the importers, `.oxlintrc.json`, `vitest.config.ts`, docs, comments -- the move -- one commit, `ledger.ts` deleted
- [x] `services/ledger/*.spec.ts`, `testing/ledger.ts` -- the ledger tests -- one commit, `ledger.spec.ts` deleted
- [x] `testing/app.ts`, `routes/**/*.spec.ts`, `app.spec.ts`, `services/imports.spec.ts` -- the route tests -- one commit

**Acceptance Criteria:**
- Given the branch, when `pnpm lint:code` runs, then no cycle is reported, and madge prints none.
- Given the JSON reports before and after, when compared, then `numTotalTests` and `numPassedTests` are equal and the `expect(` count over the moved specs and harnesses is equal.
- Given `ledger.ts` at the baseline and the new modules, when every `import` line is dropped, `export ` stripped and lines sorted, then the two sides differ only by blank lines and path comments.
- Given `pnpm test`, then `src/services/ledger/**` holds 100 % of branches, functions, lines and statements.

## Design Notes

Four commits let a reviewer read the move as moves: `git diff --color-moved=dimmed-zebra` shows untouched blocks dimmed. More route spec files mean more sign-ins, but each file signs in once against its own database, whose rate-limit table is its own (`services/auth.ts:124`), so parallel files never share Better Auth's three-per-ten-seconds budget.

## Verification

**Commands:**
- `pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: green, same totals as `/tmp/before.json`, ledger thresholds met
- `pnpm test:e2e` -- expected: green
- `pnpm dlx madge --circular --extensions ts packages/api/src` -- expected: « No circular dependency found »

## Implementation Notes

- Done directly in the session, by ts-morph scripts that cut `ledger.ts`, `ledger.spec.ts` and `app.spec.ts` along their top-level statements, each with the comments above it, and computed the imports between the new files from TypeScript's own references. One commit per task: `99af513` reader, `466d88b` ledger, `cc6a136` ledger tests, `3b8cde0` route tests.
- Baseline: 2,041 unit tests, 1,135 `expect(` in `ledger.spec.ts`, 1,081 in `app.spec.ts`. After: 2,041 tests passing under the same sorted list of full names; 1,135 `expect(` over `services/ledger/*.spec.ts` and `testing/ledger.ts`; 1,081 over `routes/**/*.spec.ts`, `app.spec.ts` and `testing/app.ts`. Each of the sixteen modules is at 100 % on all four measures.
- Normalised comparison: the sorted non-blank lines, without imports and a leading `export `, are identical, except six signatures the formatter wrapped once `export` made them too long, and the harness edits below.
- `rules.spec.ts` keeps its `loadEnabledRules` describe and imports the function from `rule-reader.ts`: the describe creates its rules through `createRule` and the file's seed rows.
- `patch.ts` and `shared.ts` get no spec: no describe names them, and their code is covered through the modules that use them.
- Route placement: « the opening anchor » goes to `routes/transactions.spec.ts`, since its first asserted request is `DELETE /api/transactions/:id`. « CSV imports », « QIF imports » and `purgeStalePreviews` go to `routes/imports.spec.ts`: they are about the import flow, and `purgeStalePreviews` drives it through the routes with the signed-in template, which `services/imports.spec.ts` does not have.
- ESM forbids assigning an imported binding, so the harnesses hold `temp`, `template`, `logLines` and `own` as live bindings that only they assign. Helpers that assign them (`ownClient`, `bankApp`, `netWorthOf`, `cashFlowOf`, `ownCategory`) sit in `testing/app.ts` even though one file uses each. Inside test bodies, 13 `own = await freshDatabase();` become `const own = await ownDatabase();`, `await ownDatabase();` when the local was not read, or `const database = await ownDatabase();` where the file also reads the shared `own` (no-shadow), and one `logLines = [];` becomes `clearLogLines();`.
- `consistent-function-scoping` fired on two local arrows once `request` became an import, so `page` (rules) and `dates` (imports) moved to module scope above their describe.
- Fixture URLs built from `import.meta.url` gained a `../`, since their files now sit one directory deeper.
- `madge --circular`: « No circular dependency found! », 250 files.

## Spec Change Log

## Review Triage Log

| Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|
| blind | Splitting exports internals (`recomputeBalances`, `snapshotOn`, `shared.ts`, `patch.ts`…) another service could call outside a ledger transaction | low | Real: they were private to `ledger.ts`. No caller outside `services/ledger/` uses them today, table imports stay restricted, and a guard means per-name lint restrictions | rejected: unlikely, fix adds config; named in the hand-back as a follow-up |
| blind | `oldestPendingDate` belongs in `pending.ts` | low | It reads pending entries, but the Code Map places it in `snapshots.ts` | rejected: fix edits the spec |
| blind | `rule-reader.ts` has no spec beside it | low | Its describe builds rules through `createRule` and `rules.spec.ts`'s seed rows; recorded in Implementation Notes | rejected |
| blind | `patch.ts` and `shared.ts` have no spec | low | No describe names them; 100 % covered through the others; recorded | rejected |
| blind | `routes/setup.ts` has no spec, its tests stay in `app.spec.ts` | false | No test of `setup.ts` existed in `app.spec.ts`; `/api/setup` appears only in « the body limit », which tests `app.ts` | rejected |
| blind | The `no-restricted-imports: off` override names `ledger/**` and `testing/ledger.ts` without saying why | low | Comment only explained the volume spec | patched: comment names both |
| blind | `docs/architecture.md` still writes `ledger.ingest(...)` and `ledger.absorb(...)` | low | Lines 100 and 188 | patched: names `services/ledger/ingest.ts` and `pending.ts` |
| blind | `docs/architecture.md` never mentions `rule-reader.ts` | low | The directory line is not exhaustive and no decision covers rule reading | rejected |
| blind | `CONTRIBUTING.md` not updated with the harness convention | false | `CONTRIBUTING.md` defers test conventions to `AGENTS.md`, which now holds them | rejected |
| blind, edge | `own` reassigned without disposing the previous database | false | Same code as `app.spec.ts` at the baseline; `ownDatabase` keeps the assignment it replaces | rejected: pre-existing |
| blind, edge | `buildApp(own?.db)` falls back to the shared database | false | Pre-existing in `app.spec.ts` | rejected: pre-existing |
| blind, edge | `afterAll` throws on undefined `temp` or `template` when `beforeAll` failed, or leaks on a failed dispose | false | Pre-existing hooks, moved into the harness functions verbatim | rejected: pre-existing |
| blind | `linkedAccount` duplicates `linkedChecking` | false | Pre-existing helpers moved verbatim | rejected: pre-existing |
| blind | Blank line between imports and code lost in five files | low | Real: the importer rewrite dropped it in `bank-connections.ts`, its spec, `snapshots.ts`, `ledger/shared.ts` and `testing/ledger.ts` | patched |
| blind | `filter.ts` still points at « the ledger's parity test » | low | The test now sits in `filter.spec.ts` | patched |
| blind | `Known` is not exported though two exported functions use it | false | `rules.ts` passes the value along without naming its type; typecheck passes | rejected |
| blind | The review diff header lists no harness edits | false | About the review input, not the code; the edits are in Implementation Notes | rejected |
| edge | `paddedOfx`, `linkedConnection` lack guards | false | Pre-existing helpers moved verbatim | rejected: pre-existing |
| edge | `rule-reader.ts`: null amount read as 0, `readRules` drops `enabled` beside `id`, unknown action read as a transfer | false | Pre-existing code moved verbatim from `rules.ts`; no caller passes both filters | rejected: pre-existing |
| edge | Normalised comparison differs by formatter re-wraps, not only blank lines and comments | low | True; six signatures wrapped, recorded in Implementation Notes | rejected: fix edits the spec |
| verification-gap | none | — | — | — |
