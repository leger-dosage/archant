---
title: "Story 32.10: Run rules over the history after each sync, and list every run"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: 'af97eb9640a35a7d59e2799c0960c16a2f59db51'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) runs no rule while an account syncs: `Family::Syncer#perform_post_sync` matches transfers, then queues `rule.apply_later` for every active rule, which runs over every transaction from the rule's effective date, respecting locks. `RuleJob` records each run as a `RuleRun` (`execution_type` `manual` or `scheduled`, `status` `pending`, `success` or `failed`, `transactions_queued`, `transactions_processed`, `transactions_modified`, `error_message`); a rule that raises records `failed` and the others still run, each being its own job. « Exécutions récentes » lists every run newest first, paged, with « Date/Heure », « Type », « Statut », « Nom de la règle » and the counts. Archant runs enabled rules at step 5 of `ingest`, on new rows only, and records only confirmed applications, with matched and changed counts.

**Approach:** A runner in `services/rules.ts` runs rules one after another in one immediate transaction, each in a savepoint: it counts the rule's matches (queued), applies its plan through the ledger with origin `rule`, and records a `rule_runs` row; a throw rolls the savepoint back and records `failed` with the error's code, and the next rule runs. Transfer matching runs once after the rules. `applyRules` (one rule or « Appliquer tout ») uses it with `manual`; a new `runRulesAfterSync` runs enabled rules with `scheduled`, called after a connection's accounts sync, after an import's confirm, CSV or QIF publish, or revert, and after a Sure archive import, before recurring detection. Step 5 of `ingest` goes.

## Boundaries & Constraints

**Always:** locks respected on every path (AD-10); creation order; one candidate read per run of rules; a post-sync rules failure is logged by code and never fails the sync or import; runs survive their rule's deletion, as Archant already keeps them.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no queue or background job; no rule run on `dryRun` previews; no error text beyond a code stored or shown (an unexpected error's message may embed bound amounts).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sync | enabled rule, old uncategorised line | line recategorised, run `scheduled`/`success` | none |
| Locked | line with locked category | left alone, counted in queued, not modified | none |
| Failing rule | rule A throws, rule B fine | A `failed` with code, B `success` and applied | logged by code |
| Manual line | typed by hand with enabled rule | unchanged until next sync or import | none |
| Disabled rule | after sync | not run, no run row | none |
| Old runs | rows before upgrade | `manual`, `success`, processed = queued = old matched | migration |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/models/family/syncer.rb#perform_post_sync`, `app/jobs/rule_job.rb`, `app/models/rule_run.rb`, `app/views/rules/index.html.erb` (« Exécutions récentes »), `app/views/api/v1/rule_runs/_rule_run.json.jbuilder`, `config/locales/views/rules/fr.yml` `recent_runs`, `app/models/import.rb` and `sure_import.rb` (`family.sync_later` after publish and revert).
- Data: `packages/data/schema/rules.ts` `ruleRuns` (rename `matched_count`→`transactions_queued`, `changed_count`→`transactions_modified`; add `transactions_processed`, `execution_type`, `status`, `error_message`), `packages/data/rules.ts` for the value lists, migration `0100_*` via `pnpm data generate --custom`-style hand SQL.
- API: `services/rules.ts` (`applyRules`, new `runRulesAfterSync`, `listRuleRuns`, `RuleRunData`), `services/ledger/rule-plans.ts` (`applyRulePlan`, `ruleCandidates`), `domain/rules/matching.ts` (`planActions`), `services/ledger/ingest.ts` step 5 removed, `services/sync.ts#runSync`, `services/imports.ts#detectAfterImport`, `services/sure-import.ts#afterImport`, `mcp/rules.ts` (`get_rule_runs`, `apply_rules` fields as Sure's API).
- Interface: `routes/_authed.rules.tsx` `RuleRuns`, `components/StatusBadge.tsx`, `hooks/useRules.ts`, `locales/fr.json` `rules.runs`.
- Tests: `services/rules.spec.ts`, `services/sync.spec.ts`, `services/ledger/ingest.spec.ts`, every spec expecting rules at ingest; e2e `rules.spec.ts`, a fixture-bank sync test.
- Docs: `docs/architecture.md` AD-4 and the Rules row, `docs/sure-parity.md` « When rules run », « Applying by hand », `docs/deployment.md` / `mcp/server.ts` where they say rules run on new lines.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: sync recategorises an old line, a locked line left alone, a failed rule beside a successful one, runs recorded with type and status; ingest no longer runs rules.
- [x] Schema and migration; runner; post-sync hooks; ingest step 5 removed.
- [x] Assistant fields; interface columns and statuses; e2e syncs a fixture connection and reads its runs.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given an enabled rule and an old matching line, when a bank connection syncs, then the line gets the rule's category and « Exécutions récentes » shows a « Planifié » « Réussi » run.
- Given a rule that fails, when rules run, then its run reads « Échoué » and the next rule still applies.

## Design Notes

Assumptions taken alone, each settled by Sure:

- A post-sync run is `scheduled`: Sure's `perform_post_sync` calls `apply_later`, whose `RuleJob` defaults to `manual`, but `scheduled` exists for runs nobody started (`ApplyAllRulesJob` tests pass it); an owner reading « Manuel » on a run they never started would be misled.
- Queued is the rule's matches against the lines as earlier rules of the same run left them, as Sure's jobs run in turn; processed equals queued on success, 0 on failure; modified the rows it changed. Sure's « Bloqué » column (`processed - modified`) is left out, as the story lists « Traitées » and « Modifiées ».
- `error_message` stores the error's code (`INTERNAL_ERROR` for an unexpected one), shown translated beside « Échoué »: Sure shows `Class: message`, which here could embed bound amounts.
- Rules run once a sync of the household ends, as `Family::Syncer` runs them once for the family: after the button's one connection, or after every connection of the cron, the schedule or the day's first visit, when at least one account was read; and after every import path Sure follows with `family.sync_later`. A household without a bank connection meets rules at its next import.
- A manual application with a failed rule says so: the interface shows « Une règle a échoué : voyez « Exécutions récentes ». » in place of the count, and `apply_rules` adds « N rules failed and changed nothing. » to its message.
- Sure's order is kept: transfers match before rules, so a line a rule excludes may already sit in a proposed transfer, and a « Virement avec » expectation reaches a line the matcher left free.
- The assistant's run fields take Sure's API names (`execution_type`, `status`, `transactions_queued`, `transactions_processed`, `transactions_modified`, `error_message`).
- Upgrade: earlier runs read `manual`, `success`. At the first sync or import after the upgrade, every enabled rule runs over the whole history from its start date, changing any line whose fields are not locked. A line typed by hand or created by the assistant no longer meets rules at once, only at the next sync or import. `GET /api/rules/runs`, `apply_rules` and `get_rule_runs` answer the new fields in place of `matchedCount`/`changedCount` (`matched_count`/`changed_count`).

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff of `docs` and `packages`, `docs/sure-parity.md` and the Drizzle snapshot aside for size; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A manual application with a failed rule reports success in the toast and in `apply_rules` | medium | patch | The toast reads « Une règle a échoué… » and the tool's message adds the failed count. |
| 2 | `expectedChanged` no longer equals what was written when a rule fails | low | reject | The failed run is recorded and now announced; the stale check guards the plan, as before. |
| 3 | Rules ran once per connection, so a household with several banks ran them several times a day | medium | patch | `afterSyncs` in `sync.ts` runs them once after the button's, the cron's, the schedule's or the first visit's connections; `sync.spec.ts` checks one run for two connections. |
| 4 | No volume test times the run after a sync | low | reject | `ruleCandidates` and `planActions` are the paths the manual application already took over the whole history; NFR10 covers reads. |
| 5 | `rule_runs` grows without a purge | low | reject | Sure keeps every `RuleRun`; one row per enabled rule a day. |
| 6 | The CSV, QIF, revert and Sure archive hooks are untested; the outer catch and its log too | medium | patch | `sure-import.spec.ts` checks an imported rule's run; `sync.spec.ts` checks a whole-run failure keeps the sync and logs the code only. The file paths share `detectAfterImport`, which the OFX confirm tests in Vitest and Playwright reach. |
| 7 | An excluded line may stay in a transfer the matcher proposed first | low | reject | Sure's `perform_post_sync` matches transfers before rules; recorded in Design Notes. |
| 8 | `docs/deployment.md`, `create_transaction`'s description and the e2e header still describe rules at ingestion | low | patch | All three now say rules run at the next sync or import. |
| 9 | The e2e sync test recategorises other files' lines with the fixture label | low | reject | Its rule's category is its own, deleted rules stop it, and no other file asserts that line's category. |
| 10 | The upgrade changes behaviour without a note | medium | patch | The pull request carries `breaking-change` and says what the first sync does. |
| 11 | `errorMessage` is typed `string` rather than an error code | low | reject | The interface falls back to `INTERNAL_ERROR` through `isErrorCode`; typing it needs the API's union in `@archant/data`. |
| 12 | `pending` has no producer | low | reject | Kept as Sure's closed list; runs are synchronous here. |
| 13 | Spec status and unticked tasks | low | patch | Ticked; status set at completion. |
| 14 | Two comments wrapped badly after edits | low | patch | Rewrapped in `ingest.ts` and `schema/rules.ts`. |
| 15 | Planning outside the try aborts the whole run | low | patch | `planActions` moved inside the per-rule `try`, the queued count recorded on failure. |
| 16 | A rule undoing an earlier one counts a row as changed | low | reject | Rare by construction; each run's own count stays right. |
| 17 | Two runs in the same millisecond may interleave in the list | low | reject | A single write lock serialises runs; a millisecond tie needs two runs back to back. |
| 18 | A line typed by hand gets no rule until the next sync | false | reject | The story's intent, as Sure's account sync runs none. |
| 19 | A bank merchant a rule replaces stays listed | medium | defer | Recorded in `deferred-work.md`; no source column tells it from a merchant the owner created. |
| 20 | Chaining across rules (`plannedRow`) is checked for the merchant only | medium | patch | `rules.spec.ts` chains a rename into a category into an exclusion, each rule queuing 1. |
| 21 | A failed run's tooltip has no browser test | low | defer | Producing a failure end to end needs a database fault; the badge and its code are unit-tested through the service. |
| 22 | The « Virement avec » e2e test relied on rules at ingestion | high | patch | It failed in the suite; the outflow now arrives by import, whose rules set the expectation. |
| 23 | Two e2e tests asserting « Sans catégorie » after a typed line no longer prove a disabled rule stays off | low | reject | Vitest covers the disabled rule after a sync (`rules.spec.ts`, `routes/rules.spec.ts`). |
