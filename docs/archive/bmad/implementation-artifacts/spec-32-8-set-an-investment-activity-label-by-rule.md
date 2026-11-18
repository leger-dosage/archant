---
title: "Story 32.8: Set an investment activity label by rule"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'ef74e19ae03c522b6a69a2c2a00458d7882247f1'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) offers `Rule::ActionExecutor::SetInvestmentActivityLabel` (`set_investment_activity_label`, label « Set investment activity label », no French key), a `select` whose options are `Transaction::ACTIVITY_LABELS`, fifth in `TransactionResource#action_executors`, after the name and before the exclusion. Its `execute` returns 0 for a value outside the list, and otherwise writes the label on every matching transaction through `enrich_attribute(:investment_activity_label, source: "rule")`, skipping a locked label (`enrichable`). Archant stores the label since Story 28.21 and locks it on a hand edit, but has no such action: a Sure archive's or a `rules.csv` rule with it is skipped as unsupported.

**Approach:** `set_investment_activity_label` joins `RULE_ACTION_TYPES` in `@archant/data/rules.ts`, after `replace_in_transaction_name` and before `exclude_transaction`; migration 0099 rebuilds `rule_actions`' type check. The API refuses a value outside `ACTIVITY_LABELS`; the reader turns a stored one outside it into an inert action, as Sure's `return 0`. The evaluator plans the label on a row whose `investmentActivityLabel` is not locked; `applyRulePlan` writes it through `changeOf`, origin `rule`, which locks nothing. The form, the summary, the preview, the assistant and the Sure and CSV imports learn the type.

## Boundaries & Constraints

**Always:**
- The value is stored in English, as Sure and as `transactions.investment_activity_label`: `Dividend`, never `Dividende`.
- The action writes on every matching transaction, whatever its account, as Sure's executor, which reads no account type.
- A locked label (AD-10) and a value already there are no change; a value outside the list writes nothing.
- The form shows the 13 labels in Sure's order with Sure's `transactions.activity_labels` words, which Archant's drawer already uses.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no clearing of the label by rule (Sure's options hold no blank); no account-type restriction; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Free label | rule `Dividend`, row label `null` | row label `Dividend`, origin rule, nothing locked | none |
| Locked label | row label `Buy` locked | stays `Buy` | none |
| Same value | row label `Dividend` | no change, not counted as changed | none |
| Stored value outside the list | `Dividende` in `rule_actions.value` | inert, nothing written | none |
| API value outside the list | `{"actionType":"set_investment_activity_label","value":"Dividende"}` | 400 | `VALIDATION_ERROR`, `invalid_value` |
| Empty value | `""` | 400 | `VALIDATION_ERROR`, `too_small` |
| Sure archive | `{"action_type":"set_investment_activity_label","value":"Fee"}` | imported | an unknown value skips the rule, as any invalid rule |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/rule/action_executor/set_investment_activity_label.rb`, `app/models/rule/registry/transaction_resource.rb` (order), `config/locales/views/transactions/fr.yml` (`activity_labels`).
- Data: `packages/data/rules.ts` (`RULE_ACTION_TYPES`), migration `0099` through `pnpm data generate`, `packages/data/migrate.spec.ts`.
- Rules: `domain/rules/matching.ts` (`ActivityLabelAction`, `RuleCandidate.investmentActivityLabel`, `RowPlan.investmentActivityLabel`), `services/rule-reader.ts` (`toAction`), `schemas/rules.ts` (value check), `services/ledger/rule-plans.ts` (`applyRulePlan`), `services/ledger/ingest.ts` (candidates), `services/rules.ts` (preview sample), `mcp/rules.ts` and `schemas/assistants/rules.ts`, `services/sure-rules.ts`; specs `matching.spec.ts`, `routes/rules.spec.ts`, `services/rules.spec.ts`, `services/sure-import.spec.ts`, `services/export.spec.ts`, `mcp/server.spec.ts`, `services/csv-import.spec.ts` (its « unsupported » example moves to `send_email_notification`).
- Interface: `lib/activity-labels.ts` (names shared with `ActivityLabelField.tsx`), `components/RuleActionRow.tsx`, `lib/rule-summary.ts`, `locales/fr.json`; `rule-summary.spec.ts`; e2e `packages/app/e2e/rules.spec.ts`.
- Docs: `docs/sure-parity.md` row « Actions ».

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `matching.spec.ts` free, locked, same and inert value; `routes/rules.spec.ts` save and refused value; `migrate.spec.ts` 0099; `rule-summary.spec.ts`; `sure-import.spec.ts` imports the action; `services/rules.spec.ts` applies it to history.
- [x] Data: action type, migration.
- [x] Rules: evaluator, reader, schema, writer, preview, assistant, Sure import.
- [x] Interface: select of labels, summary; e2e saves a rule setting « Dividende ».
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given the rule form, when « Définir le libellé d'activité » is picked, then its value is a select of the 13 labels, « Achat » to « Autre ».
- Given a rule setting `Dividend`, when it runs on a row whose label is free, then the row reads `Dividend`; a locked row keeps its label.
- Given the list, then the rule reads « … alors Libellé d'activité : Dividende ».
- Given `rules.csv` and the assistant's `get_rules`, then the action's value is `Dividend`, as Sure stores it.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The action is named « Définir le libellé d'activité », the story's wording; Sure's label has no French key. The summary reads « Libellé d'activité : Dividende ».
- It sits after « Remplacer dans le libellé » and before « Exclure », as Sure's fifth executor after the name.
- The API refuses a value outside the list, as every Archant action value is checked on save; a stored one, which only a hand edit of the database could write, is inert as Sure's `return 0`, never `RULE_MALFORMED`.
- `rules.csv` and the assistant give the English value, as Sure stores and exports it; the list and the form translate it.
- A rule writes no lock (origin `rule`), as Sure's `enrich_attribute(source: "rule")`.
- The form starts a new activity label action on « Achat », Sure's first option, as its HTML select shows it; the list and the form translate the stored English value.
- A Sure archive's or `rules.csv` action with a value outside the list is dropped, not the whole rule: Sure's executor writes nothing for it and still runs the rule's other actions. A rule left with no action is skipped as before.
- On a non-investment account the label is set too, as Sure, though the sheet shows the select only on an investment or crypto account; the four internal labels then leave that line out of cash flow (AD-9), as in Sure.
- Upgrade: no stored rule changes. A Sure archive's or `rules.csv` rule with this action, skipped until now, imports.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated snapshot and the planning files; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The « Investment activity label » parity row still says the rule action comes later | low | patch | Row reworded: parity since Story 32.8. |
| 2 | `schemas/transactions.ts` says only the edit sets the label | low | patch | Comment now says a rule also sets it. |
| 3 | The action reads « libellé d'activité » where the sheet says « Type d'activité » | low | reject | The story's acceptance criteria fix « Définir le libellé d'activité » and « Libellé d'activité : Dividende ». |
| 4 | A rule sets the label on a checking account, where the sheet hides the select, and an internal label leaves the line out of cash flow | low | reject | Sure's executor reads no account type and Sure's drawer shows the select only on investment accounts too; recorded in the Design Notes and the parity row. |
| 5 | A Sure or `rules.csv` rule with a value outside the list was skipped whole, where Sure still runs its other actions | medium | patch | `sure-rules.ts` drops that action alone; `sure-import.spec.ts` keeps the rule's exclusion. |
| 6 | A null value from Sure made the whole rule fail | medium | patch | Same fix as 5. |
| 7 | A value with spaces would be trimmed and accepted where Sure ignores it | low | reject | Every Archant action value is trimmed on save; the import now checks the raw value. |
| 8 | The form shows a blank select for a stored value outside the list | low | reject | Only a hand edit of the database can store one; the API and the imports refuse it. |
| 9 | `preview_rule` declares the change as any string and no test reads it | low | patch | `z.enum(ACTIVITY_LABELS)`; `mcp/server.spec.ts` previews a draft and reads `investment_activity_label`. |
| 10 | No export test writes the action into `rules.csv` | low | patch | `export.spec.ts` exports it under `actions` with `Dividend`. |
| 11 | No positive `rules.csv` import test | low | reject | The CSV import and the archive import share `ruleInputOf`; `sure-import.spec.ts` covers the mapping. |
| 12 | Summary fallback and inert-action tally untested | low | reject | The fallback prints the stored value; the inert action plans nothing, which `matching.spec.ts` asserts. |
| 13 | Sprint status and tasks not updated | false | reject | Updated at completion, in the same pull request. |
| 14 | Overlong comment in `schema/rules.ts`; `ACTIVITY_LABELS` comment names investment accounts only | low | patch | Rewrapped; the comment names a rule on any account. |
