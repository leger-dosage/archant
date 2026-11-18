---
title: 'Story 8.4: Replace in the label'
type: 'feature'
created: '2026-10-02'
status: 'done'
baseline_commit: '1c81e6242bc4d0d6b3d0504b03d78eb6affa948d'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-8-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-8-2-more-rule-conditions-and-actions.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A bank sends labels the way its card terminal wrote them, such as `LECLERC SANS CONTAC\ANCENIS-SAINT\ FR` (merchant, city and country split by backslashes, on pending lines) or `CARTE 29/09/26 C C LECLERC MAGAS CB*2769` (booked lines). `labelOf` in `connectors/enable-banking/client.ts` copies the bank's text unchanged, as Sure does. A rule can only replace the whole label with a fixed one (`set_transaction_name`), so one shop needs one rule and the noise every line shares, a prefix, a suffix, a separator, cannot be removed at all. The formats differ by bank, so a fixed cleanup at import would be wrong for some of them and is refused.

**Approach:** A rule action « Remplacer dans le libellé » with two fields, « Rechercher » (an RE2 pattern) and « Remplacer par ». RE2 guarantees linear time, so a pattern can never hold the server, even on a label a third party partly chose by sending a transfer. The action joins the rules engine as it is: creation order, locks, `origin: "rule"`, ingestion and Story 8.3's application to history.

## Boundaries & Constraints

**Always:**
- New action type `replace_in_transaction_name` in `packages/data/rules.ts`, added to `RULE_ACTION_TYPES` and so to the check constraint on `rule_actions.action_type`. Its `value` is the pattern; a new nullable text column `rule_actions.replacement` holds the replacement, null for every other type.
- Semantics, with no option to set: the pattern is an RE2 expression read case-insensitively, every occurrence is replaced, and the replacement is literal text, so `$1`, `$` and `\` mean nothing special. A label the action changes is then trimmed and its runs of spaces collapsed. A label the pattern does not match, or whose result would be empty, is left as it is: a rule never blanks a label.
- RE2 runs through `re2js` (MIT, no dependency, no install script, pure JavaScript, linear time), behind one module, `packages/api/src/domain/rules/label-pattern.ts`, exporting `compileLabelPattern(pattern)` (`null` when RE2 refuses it) and `replaceInLabel(compiled, replacement, label)`. No other file imports `re2js`, so swapping the package touches that file only.
- The pattern is compiled once per rule load, in `toAction` of `services/rule-reader.ts`, never per transaction. A stored pattern that no longer compiles makes `toAction` throw `malformed()`, as a null value does today.
- Validation, in `ruleSchema` of `schemas/rules.ts`, so the form resolver reports the API's codes: the pattern is required (`too_small`), at most `RULE_VALUE_MAX_LENGTH` characters (`too_big`) and must compile (`invalid_pattern`, new code, on `actions.N.value`); the replacement may be empty, is not trimmed, and is at most `LABEL_MAX_LENGTH` characters (`too_big`, on `actions.N.replacement`). An RE2 refusal, such as a back reference or a lookahead, is an `invalid_pattern`. A replacement sent with any other type is refused (`invalid_value`).
- The domain action is `ReplaceAction { type; pattern: CompiledPattern; replacement }`. `applyAction` in `domain/rules/matching.ts` drops it when `label` is locked, as it does for a rename, and plans `{ label }` otherwise. The action reaches transactions through `planActions`, so ingestion (step 5) and Story 8.3's count and application need no other change; each sees the label as earlier rules left it.
- A rule holds one action per type, as before, so one rule holds one replacement. A user who must remove a prefix and a suffix writes two rules; they combine because rules apply in creation order over one planned state.
- `RuleSnapshot`'s action in `packages/data/rules.ts` gains an optional `replacement`, so a past run keeps what it applied. `routes/rules.ts` and the typed client carry `replacement` on an action.
- Form: `components/RuleActionRow.tsx` shows two inputs for this type, « Rechercher » and « Remplacer par », and a hint under the first that it is an RE2 expression, with a link to the docs section below. The summary in `lib/rule-summary.ts` reads « Remplacer « X » par « Y » », and « Supprimer « X » » when the replacement is empty. Texts in `packages/app/src/locales/fr.json`, the only locale.
- Migration `0037_*` through `pnpm data generate`. SQLite rebuilds the table to change a check constraint; drizzle-kit writes that, the existing rows keep their values, and the server's backup before a pending migration covers the self-hoster. `migrate.spec.ts` migrates a database that already holds a rule with each current action type.
- One dependency is added, `re2js`, with its range as a caret (AGENTS.md) and its reason in the pull request description: a pattern is written by the user and runs on text a third party partly chooses, the built-in `RegExp` backtracks without limit, and the repository already patched `ofx-js` for the same class of problem.
- Docs: `docs/sure-parity.md` (rules table, « Actions » row and a new « Replace in the label » row), `docs/security-model.md` (a user's pattern runs in RE2, never in the built-in `RegExp`), and a section in `docs/troubleshooting.md` named « Labels show backslashes or a card prefix » that quotes the two labels above and gives three rules to copy: `\\` replaced by a space, `^CARTE \d{2}/\d{2}/\d{2} ` replaced by nothing, `\s*CB\*\d{4}$` replaced by nothing. The interface's hint links to that heading, so it must be kept.

**Never:** no fixed cleanup at import and no rule shipped by default; no regular-expression operator on the label condition; no capture reference in the replacement; no flag, anchor or mode switch in the form; no pattern applied to notes, merchant or any field but the label; no fallback to the built-in `RegExp`, even when RE2 refuses a pattern; no import or export of rules; no raw SQL.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Backslashes | `LECLERC SANS CONTAC\ANCENIS-SAINT\ FR`, pattern `\\`, replacement ` ` | `LECLERC SANS CONTAC ANCENIS-SAINT FR` | — |
| Prefix | `CARTE 29/09/26 PICARD SA 788 4 CB*2769`, pattern `^CARTE \d{2}/\d{2}/\d{2} ` | `PICARD SA 788 4 CB*2769` | — |
| Suffix | `PICARD SA 788 4 CB*2769`, pattern `\s*CB\*\d{4}$` | `PICARD SA 788 4` | — |
| Two rules | The prefix rule, then the suffix rule | `PICARD SA 788 4` | — |
| Case | `Carte 29/09/26 X`, pattern `^carte \d{2}/\d{2}/\d{2} ` | `X` | — |
| Every occurrence | `A--B--C`, pattern `-`, replacement ` ` | `A  B  C` becomes `A B C` | — |
| No match | `IKEA`, pattern `CARTE` | Unchanged, row not counted as changed | — |
| Empty result | `CARTE`, pattern `CARTE`, replacement empty | Unchanged | — |
| Literal replacement | `A B`, pattern ` `, replacement `$1\n` | `A$1\nB` | — |
| Locked label | The user renamed the row | Unchanged | — |
| Chained | Rename to `Amazon`, then replace `ama` by `AMA` | `AMAzon` | — |
| Catastrophic pattern | `(a+)+$` on `aaaa…a!` of 200 characters | Returns in milliseconds, unchanged | — |
| Refused by RE2 | `(?=x)`, or `(a)\1` | — | 400, `actions.N.value` `invalid_pattern` |
| Syntax error | `(`, or `[` | — | 400, `actions.N.value` `invalid_pattern` |
| Empty pattern | Pattern « » | — | 400, `actions.N.value` `too_small` |
| Too long | Pattern of 201 characters | — | 400, `actions.N.value` `too_big` |
| Empty replacement | Replacement « » | Saved; the matched text is removed | — |
| Stored pattern broken | A row whose pattern RE2 no longer accepts | The rule is read as malformed, as any malformed row | — |
| History | Existing transactions with `\`, the rule applied from the dialog | The count and the write follow Story 8.3 | — |

</frozen-after-approval>

## Code Map

- `packages/data/rules.ts` -- `RULE_ACTION_TYPES` 59, `RuleSnapshot` action type.
- `packages/data/schema/rules.ts` -- `ruleActions` (add `replacement`), `rule_actions_type_check`; `packages/data/drizzle/0037_*`; `migrate.spec.ts`.
- `packages/api/src/domain/rules/label-pattern.ts` (new) and its spec; `matching.ts` (`RuleAction` union 89, `applyAction` 270, `RenameAction` 95); `matching.spec.ts`.
- `packages/api/src/services/rule-reader.ts` -- `toAction` 175; `services/rules.ts` -- where an action is stored (204) and read for the response (70); `services/ledger/rule-plans.ts` needs no change, `rule-plans.spec.ts` gains a case.
- `packages/api/src/schemas/rules.ts` -- `ruleBodySchema` 38, `fields.actions` 71, `ruleSchema` 155, `RuleRequest`.
- `packages/app/src/components/RuleActionRow.tsx`, `lib/rule-form.ts` (`newAction`, `FormValues`), `lib/rule-summary.ts`, `locales/fr.json` (`rules.actionTypes` 945, `rules.form`, `rules.summary` 907).
- `packages/app/e2e/rules.spec.ts` and `e2e/fixtures.ts` (`createRule` 363 takes actions).
- `packages/api/package.json`, `pnpm-lock.yaml` -- `re2js`; `knip.json` needs no entry because the module is imported.
- `docs/sure-parity.md`, `docs/security-model.md`, `docs/troubleshooting.md`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/domain/rules/label-pattern.spec.ts`, `label-pattern.ts`, `packages/api/package.json` -- failing cases for the matrix rows `Backslashes` to `Catastrophic pattern` and the refused patterns, then the module over `re2js`. The catastrophic case asserts a bound on elapsed time, generous enough not to be flaky.
- [x] `packages/data/rules.ts`, `schema/rules.ts`, `drizzle/0037_*`, `migrate.spec.ts` -- failing migration test first, then the type, the column and the migration.
- [x] `domain/rules/matching.spec.ts`, `matching.ts` -- `ReplaceAction`: locked label, chaining after a rename, no match not counted as changed.
- [x] `schemas/rules.ts`, `services/rule-reader.ts`, `services/rules.ts`, `routes/rules.ts` and their specs -- validation codes, storage, malformed stored pattern, the route returns `replacement`.
- [x] `services/ledger/ingest.spec.ts`, `rule-plans.spec.ts`, `services/rules.spec.ts` -- a line imported with `\` comes out clean; Story 8.3's count and application over existing rows.
- [x] `packages/app/src/lib/rule-summary.ts` + spec, `RuleActionRow.tsx`, `rule-form.ts`, `fr.json` -- two fields, hint, summary, the API's field codes shown under the faulty field.
- [x] `packages/app/e2e/rules.spec.ts`, `fixtures.ts` -- create the rule from the form and see the label change in the transactions list; an invalid pattern shows its message and nothing is saved.
- [x] `docs/` -- the three files above.

**Acceptance Criteria:**
- Given the rule form, when I add the action « Remplacer dans le libellé », then it shows « Rechercher » and « Remplacer par », and the hint links to the troubleshooting section.
- Given a rule with no condition and the action `\\` replaced by a space, when a line labelled `LECLERC SANS CONTAC\ANCENIS-SAINT\ FR` is imported, then the transactions list shows `LECLERC SANS CONTAC ANCENIS-SAINT FR`.
- Given existing transactions carrying backslashes, when I save the rule and choose « Appliquer », then the dialog counts only the labels that change and they are rewritten.
- Given the pattern `(` or `(a)\1`, when I save, then « Rechercher » shows its message and nothing is saved.
- Given the rule of the catastrophic-pattern row and a label of 200 characters, when a line is imported, then the import completes without delay.
- Given a label the user edited by hand, when the rule matches it, then it is left unchanged.

## Implementation Notes

- The pattern is stored and read untrimmed, like the replacement: a pattern may be a single space, and the troubleshooting rule `^CARTE \d{2}/\d{2}/\d{2} ` ends with one. The Always line says only the replacement is not trimmed.
- `rule_actions.replacement` is returned for a replacement in the label only, so every other action keeps the shape it had and the existing specs stand. `RuleSnapshot` carries it, hence a past run keeps it.
- drizzle-kit rebuilt `rule_actions` to widen the check constraint and copied `replacement` out of the old table, which has none; `0037` is edited by hand to copy the five old columns, with a comment, as `0012` did. `migrate.spec.ts` migrates one row of each older action type through it.
- `ruleSchema` runs in the browser too, so `re2js` ships in the rules page's chunk, loaded with that page, and the form reports `invalid_pattern` before any request.
- A line typed by hand has its label locked at once (Story 8.2), so the story's example is an import; the rule never reaches a typed label.
- A result longer than `LABEL_MAX_LENGTH` is not cut: a 200-character pattern replacing a character by 200 more can only be built on purpose, and the connectors, not rules, own the cap on what a bank sends. Accepted.
- Review fixes: the form shows « Rechercher » and « Remplacer par » as visible labels with the hint under the first; a replacement of spaces reads « une espace » in the summary; a stored empty pattern is read as malformed, as one RE2 refuses; `rules.spec.ts` gains the one-replacement-per-rule, import-in-time and run-snapshot cases; two Playwright cases reopen a saved replacement and change an action's type away from it, the second shown to fail without the form's reset of `replacement`; `AGENTS.md` names the troubleshooting heading the form links to; the story's example reads « imported ».

## Review Triage Log

| # | Source | Finding | Verdict | Route / evidence |
|---|--------|---------|---------|------------------|
| 1 | blind, edge, verification, acceptance | `sprint-status.yaml` and `epic-8-context.md` list Story 8.4 twice | high | patch: one line each |
| 2 | blind, edge | The result of a replacement may pass `LABEL_MAX_LENGTH` (200 × 200 at worst) | low | rejected: built on purpose only, bounded, and the fix puts the limit in `domain/` or a parameter through every `planActions` caller |
| 3 | edge | A pattern matching the empty string (`$`, `\b`) inserts the replacement between characters | low | rejected: `$` with a replacement is a legitimate append; refusing empty matches costs that use |
| 4 | blind, edge, verification | A stored pattern RE2 refuses fails the whole rule load | low | rejected: the same failure as any malformed stored condition, and only a hand-edited row or a library upgrade reaches it |
| 5 | edge | `compileLabelPattern` turns every error into « refused » | low | rejected: `compile` throws only syntax errors; a rethrow branch could not be tested, and `domain/` holds a 100 % threshold |
| 6 | edge | The whole label is squished, not only the replaced span | false | by design: the story says a changed label is trimmed and its spaces collapsed |
| 7 | blind | Two replacements in one rule were never tested | low | patch: the case is refused as `duplicate_action`; test added |
| 8 | blind | The two inputs have placeholders, no visible label | medium | patch: visible labels |
| 9 | blind | A space-only replacement reads « » in the summary | medium | patch: « une espace » |
| 10 | blind | The hint and the error speak of RE2, back references and lookaheads | low | rejected: wording, and the hint links to examples |
| 11 | blind | The documentation link is hard-coded and nothing checks the heading | low | rejected: as the `#connecting-a-bank` link; `AGENTS.md` now names the heading |
| 12 | blind, acceptance | No end-to-end test of « Appliquer » with a replacement | low | rejected: the service tests count and write, and the spec asks two Playwright tests |
| 13 | blind | Nothing lets a pattern be tried before saving | low | rejected: a new feature, out of this story |
| 14 | verification | No test reopens a saved replacement in « Modifier » | medium | patch: Playwright case |
| 15 | verification | No test changes an action's type away from a replacement after typing one | medium | patch: Playwright case, shown to fail without the reset |
| 16 | acceptance | The hint sits under both inputs | low | patch: moved under « Rechercher » |
| 17 | acceptance | No test that a catastrophic pattern imports in time | low | patch: `rules.spec.ts` case through `ingest` |
| 18 | acceptance | The troubleshooting section quotes `PICARD SA 788 4 CB*2769`, not the spec's second label | low | rejected: an equivalent booked label from the same bank |
| 19 | acceptance, verification | `ingest.spec.ts` and `rule-plans.spec.ts` are not touched; `origin: "rule"` and the empty locks are not asserted | low | rejected: `ingest` is exercised through `rules.spec.ts`, and the write path is the rename's, which asserts both |
| 20 | standards | `PATTERN_GUIDE` is a second documented anchor, and `AGENTS.md` names one | low | patch: `AGENTS.md` names it |
| 21 | standards | `value === "replace…"` is tested at six sites | low | rejected: each branches for its own reason, as `isValuelessAction` sites do |
| 22 | standards | A stored empty pattern compiles and would match between characters | low | patch: read as malformed |
| 23 | standards | `malformed()` says « condition » for an action | low | patch: reworded |
| 24 | standards | A conditional `expect` in the last `matching.spec.ts` case | low | patch: uses the `replacing` helper |
| 25 | standards | `LabelPattern = RE2JS` leaks the engine's type | low | rejected: swapping the package changes this alias and `label-pattern.ts` only |
| 26 | standards | No test that RE2 refuses a nested repeat such as `((a{100}){100}){100}` | low | patch: case added; RE2 refuses it in a millisecond |

## Design Notes

Why RE2 and not a check on the pattern: a regular expression that backtracks without limit cannot be detected reliably from its text, and Node runs the whole API on one thread, so one slow label blocks every request and the day's first synchronisation. The text matched is the bank's, which a third party partly writes by sending a transfer, so the user's pattern is not the only input. RE2 refuses the constructs that need backtracking, back references and lookaheads, which a label cleanup does not need.

`re2js` over the native `re2`: the native package is 13 MB unpacked, downloads a prebuilt binary at install or falls back to `node-gyp`, would need `onlyBuiltDependencies`, and has to work on `node:24-alpine` for `linux/amd64` and `linux/arm64` inside a read-only container. `AGENTS.md` forbids a module branching on the platform, and a hosted deployment on Turso may not offer a native build. `re2js` is pure JavaScript, MIT, without dependency and fetched about nine million times a week. Labels are capped at 200 characters, so its speed is not a concern. If a measurement ever says otherwise, only `label-pattern.ts` changes.

The replacement is literal because a card label can hold `$`, and because a capture reference buys little over deleting what the pattern matches. Adding it later is a compatible change, replacing literal `$` handling is not, so the stricter rule starts.

A rule rewrites the label and keeps no copy of the bank's original text: the same as a rename. The remittance lines the bank sent stay in `notes`, so the information is not lost where the bank sent it twice, but a counterparty name used as the label is. That limit is accepted.

Departure from Sure: Sure's actions set a fixed name and its text operators have no pattern (`docs/sure-parity.md`). This action has no Sure counterpart and is recorded there as such.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- expected: all pass, no tracked file modified afterwards.
- `pnpm data generate` -- expected: one migration, `0037_*`, nothing else pending.
