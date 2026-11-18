---
title: "Story 32.9: Confirm a rule before it runs, sort the list, apply every rule"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'c6afc351b0a6cda8c965ab7c184a0b73aa592459'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) saves a new rule with `rules.active` false and redirects to `rules#confirm`: « Confirmez les modifications apportées à "nom" » (or « Confirmer les modifications » unnamed), counting `affected_resource_count`, every line its conditions match from its effective date, and « Confirmer les modifications » posts `rules#apply`, which sets `active: true` and runs it over the history; « Réappliquer la règle » in the row's menu opens the same dialog. `rules#index` sorts by `name` or `updated_at`, `asc` by default, with « Trier par : » and « Changer le sens du tri ». « Appliquer tout » opens `confirm_all`: « Appliquer toutes les règles », « Vous êtes sur le point d'appliquer N règles affectant M transactions uniques », N `family.rules.count`, disabled ones included, M `Rule.total_affected_resource_count`, and « Confirmer et appliquer tout » runs `ApplyAllRulesJob` over `family.rules`, enabling none. Archant enables a new rule at once, offers « Appliquer » with « Plus tard » after every save, counts only the lines that would change, lists rules in application order and applies only enabled rules.

**Approach:** `createRule` writes `enabled` false unless the body says otherwise (Sure's `rule_params` permits `active`, which the imports and test fixtures use); `applyRules(id)` enables the rule it applies; `applyRules()` and `previewRules()` without a target take every rule in creation order. The page opens the confirmation after a creation only, titled and worded as Sure, stating the preview's `matched`; the menu's « Réappliquer la règle » opens it too. The list sorts in the browser from `sortBy` and `direction` search parameters, by name with a French collator or by `updatedAt`, which `RuleData` gains. « Appliquer tout » shows whenever a rule exists.

## Boundaries & Constraints

**Always:**
- A manual application still respects locks (owner's decision of 2026-10-14); the dialog says so.
- Rules still apply in creation order, the ingestion's and an application's; the page description says it, since the list's order is now the user's sort.
- Closing the dialog leaves a new rule disabled and writes nothing.
- An unnamed rule sorts after every named one ascending and before them descending, as PostgreSQL's `ORDER BY name` puts `NULL`; ties keep creation order.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no offer after an edit (Sure's `update` redirects back without one); no sort stored server-side; no change to which rules the ingestion runs (enabled ones only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New rule | `POST /api/rules` without `enabled` | saved disabled | none |
| Import | Sure archive or `rules.csv` rule `active: true` | saved enabled | none |
| Count | rule matching 2 lines, one with a locked category | dialog counts 2 | none |
| Confirm | `POST /api/rules/:id/apply` on a disabled rule | enabled, applied, locked line untouched | `NOT_FOUND` for an unknown id |
| Close | dialog dismissed | rule stays disabled, no run | none |
| Apply all | one enabled, one disabled rule | N = 2, M distinct lines either matches; both run, the disabled one stays disabled | none |
| Sort | `?sortBy=updated_at&direction=desc` | most recently updated first | an unknown value falls back to name ascending |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/controllers/rules_controller.rb` (`index`, `create`, `apply`, `confirm_all`, `apply_all`), `app/views/rules/{index,confirm,confirm_all,_rule}.html.erb`, `app/jobs/apply_all_rules_job.rb`, `app/models/rule.rb` (`affected_resource_count`, `total_affected_resource_count`), `config/locales/views/rules/fr.yml`.
- API: `schemas/rules.ts` (`ruleBodySchema.enabled`), `services/rules.ts` (`createRule`, `updateRule`, `toData.updatedAt`, `rulesToApply`, `applyRules`), `services/sure-import.ts` and `services/csv-import-rules.ts` (create with `enabled`), `mcp/rules.ts` and `schemas/assistants/rules.ts` (descriptions); specs `routes/rules.spec.ts`, `services/rules.spec.ts`, `services/ledger/ingest.spec.ts` and every spec creating a rule that must run on ingestion.
- Interface: `routes/_authed.rules.tsx` (dialogs, sort controls), `lib/rule-sort.ts` with `rule-sort.spec.ts`, `hooks/useRules.ts` (comments), `locales/fr.json`; e2e `fixtures.ts` (`createRule` sends `enabled: true`), `rules.spec.ts`, `viewer.spec.ts`, `proportions.spec.ts`.
- Docs: `docs/sure-parity.md` rows « Order and activation » and « Applying by hand », `docs/deployment.md` if it describes `create_rule` or `apply_rules`.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: a rule created disabled; applying by id enables it and leaves a locked line; the preview counts a locked line among the matched; applying every rule runs a disabled one and leaves it disabled; both sorts in `rule-sort.spec.ts`.
- [x] API: `enabled` on create, enabling on apply, every rule without a target, `updatedAt`.
- [x] Imports and assistant: create with the file's `active`; tool descriptions.
- [x] Interface: confirmation after creation and from « Réappliquer la règle », « Appliquer tout » dialog, sort controls, description; e2e confirms and sorts rules.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given a rule just created, when the form closes, then « Confirmez les modifications apportées à « nom » » states how many lines it matches; « Confirmer les modifications » enables and applies it; closing leaves it disabled.
- Given the list, when « Trier par : » picks « Mis à jour à » and « Changer le sens du tri » is pressed, then the rules read newest update first.
- Given « Appliquer tout », then it reads « Vous êtes sur le point d'appliquer 2 règles affectant M opérations uniques » and « Confirmer et appliquer tout » runs both.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The count is the preview's `matched`: lines any of the rules matches from its effective date, each once, locked or unchanged ones included, as `affected_resource_count` and `total_affected_resource_count`. A later rule matches against what earlier ones planned, as the application itself would see the lines; Sure counts each rule against the stored lines.
- The rule's name is quoted with « » rather than Sure's straight quotes, as every Archant string; an unnamed rule gets « Confirmer les modifications », as Sure, rather than its summary.
- The dialog keeps « Annuler » beside the confirmation, as Archant's confirmations; Sure's dialog closes from its cross. « Plus tard » goes with the offer after an edit.
- The sort lives in the URL (`sortBy`, `direction`), as Sure's query parameters, so a reload keeps it, and is computed in the browser with a French collator that folds case and accents and reads digits as text, as PostgreSQL's collation does; viewers sort too, as Sure's index is open to guests.
- `POST /api/rules` and `PUT /api/rules/:id` accept an optional `enabled`, as Sure's `rule_params` permits `active`; absent, a creation is disabled and an update keeps the switch. The form never sends it. The imports pass the file's `active` instead of disabling afterwards.
- `apply_rules` with a `rule_id` enables the rule, as Sure's `rules#apply`; without one it applies every rule, as `ApplyAllRulesJob`. `create_rule` saves a disabled rule.
- Upgrade: stored rules keep their switch. A rule created from now on stays disabled until confirmed, and « Appliquer tout » now also runs disabled rules over the history.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff of `docs` and `packages`; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | `docs/troubleshooting.md` still says saving offers to apply the rule | low | patch | Now says « Confirmer les modifications » switches it on and applies it; closing leaves it off. |
| 2 | The assistant's instructions in `mcp/server.ts` and `docs/deployment.md` do not say `create_rule` saves a disabled rule that `apply_rules` enables | medium | patch | Steps 5 and 6 and the deployment paragraph say so. |
| 3 | `docs/security-model.md` does not say `apply_rules` enables a rule and runs disabled ones | medium | patch | Sentence added beside the lock rule. |
| 4 | `rules.enabled` keeps a database default of true | low | reject | Every insert goes through `createRule`; a migration for a default nothing reads adds risk for no user. |
| 5 | `csv-import-rules.ts` passes `enabled` on create only, then switches after an update | low | patch | `updateRule` gets `enabled: active`; the extra `setRuleEnabled` goes. |
| 6 | `allDescription_one` lacks the creation order clause | low | reject | One rule has no order to state. |
| 7 | `numeric: true` sorts « Règle 9 » before « Règle 10 », where PostgreSQL does not | low | patch | Collator without `numeric`; `rule-sort.spec.ts` covers it. |
| 8 | `ConfirmDialog` comment cites « Plus tard » | low | patch | Example now « Garder ». |
| 9 | No test that `RULE_PREVIEW_STALE` leaves the rule disabled | medium | patch | `rules.spec.ts` reads `enabled: false` after the refusal. |
| 10 | No test that an edit keeps an enabled rule's switch, nor that `enabled` sets it | medium | patch | The update test starts enabled and checks it; a new case sets it off. |
| 11 | « Appliquer tout » states the client's rule count, which may differ from the server's set | low | reject | Only another tab could change the set between preview and click; fixing it adds an API field. |
| 12 | `POST /api/rules` without `enabled` now creates a disabled rule, unannounced | low | patch | The pull request's upgrade note says it. |
| 13 | No test for equal `updatedAt` values | low | patch | `rule-sort.spec.ts` checks ties keep creation order both ways. |
| 14 | A failed preview after a creation leaves the rule disabled with no dialog | low | reject | The error toast shows and the list shows the switch off; « Réappliquer la règle » asks again. |
| 15 | The interface applies without the preview's count, so the lines may change in between | low | reject | Pre-existing; Sure's `apply` checks nothing either. |
| 16 | The e2e sort test could see two rules created in the same millisecond | low | reject | The rules are created by three sequential HTTP round trips, each longer than a millisecond. |
| 17 | The e2e `later` helper counts every unchecked switch, a leftover disabled rule included | low | reject | Playwright runs one worker and `rules.spec.ts` deletes every rule after each test; no earlier file leaves a disabled rule. |
| 18 | `sure-import.spec.ts`'s household no longer pairs an enabled with a disabled rule | low | patch | « Boulangerie » is created with `enabled: true`. |
