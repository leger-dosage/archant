---
title: "Story 32.11: Offer a rule after categorising"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: '02017b8a'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) offers a rule when a user categorises a transaction by hand, from its row (`TransactionCategoriesController#update`) or its drawer (`TransactionsController#update`): when `needs_rule_notification?` holds (prompts not turned off, not dismissed in the last 24 hours, the category changed to a value, and `Transaction::Ruleable#eligible_for_category_rule?`: no active rule setting that category already matches the line), it renders `rules/_category_rule_cta.html.erb` in `#cta`: « Updated to name », a description, a close button that hides only this prompt, a « Don't show this again » checkbox, « Hide for today » (submitting `rule_prompt_dismissed_at` now and the checkbox to `rule_prompts_disabled` through `PATCH /users/:id/rule_prompt_settings`), « Create rule » linking to `rules#new` with `name` (the line's label), `action_type` and `action_value`, and the hint that « Hide for today » pauses suggestions for 24 hours. `rules#new` presets a « name contains » condition and the category action. Archant shows no prompt.

**Approach:** Two user columns as Sure's, `rule_prompts_disabled` and `rule_prompt_dismissed_at`. `GET /api/transactions/:id/rule-prompt` answers whether to offer the prompt for the signed-in administrator; `PATCH /api/preferences/rule-prompt` records a dismissal. After a category change from the row or the sheet, the interface asks and, when offered, shows Sure's prompt as a lasting toast; « Créer une règle » opens « Règles » with the preset dialog through search parameters, as Sure's `new_rule_path` query.

## Boundaries & Constraints

**Always:** eligibility as Sure's: enabled rules with a category action naming the line's category, none of which `matches` the line (effective date and conditions); a viewer never sees the prompt and cannot write the settings (`viewerReadOnly`, `requireRole("admin")` on the read); a new rule from the prompt goes through the existing save and confirmation (Story 32.9).

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no prompt after a bulk edit, a rule or an import (Sure prompts on the two hand paths only); no setting control elsewhere (Sure has none); no change to the PATCH response contract.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No rule | line set to « Courses » | prompt « Catégorie changée en Courses » | none |
| Matching rule | enabled rule « libellé contient X » → Courses, line « X… » | no prompt | none |
| Non-matching rule | same rule, line « Y » | prompt | none |
| Disabled rule | matching but disabled | prompt | none |
| Cleared | category set to none | no prompt | none |
| Hidden today | dismissed < 24 h ago | no prompt | none |
| Turned off | `rule_prompts_disabled` | no prompt | none |
| Viewer | GET or PATCH | 403 `FORBIDDEN` | refused |
| Read fails | network error on the GET | no prompt, no error toast | swallowed |

</frozen-after-approval>

## Code Map

- Sure `00dd977fb`: `app/models/transaction/ruleable.rb`, `app/controllers/transaction_categories_controller.rb` and `transactions_controller.rb#needs_rule_notification?`, `app/views/rules/_category_rule_cta.html.erb`, `app/views/shared/notifications/_cta.html.erb`, `app/controllers/users_controller.rb#rule_prompt_settings`, `app/controllers/rules_controller.rb#new`, `config/locales/views/rules/en.yml` `category_rule_cta` (no French keys), `test/models/transaction/ruleable_test.rb`, `test/system/category_rule_prompt_test.rb`.
- Data: `packages/data/schema/auth.ts` `users` (two columns), migration `0101_rule_prompt_settings.sql` through `pnpm data generate`.
- API: `services/rule-prompt.ts` (new: `offersRulePrompt`, `dismissRulePrompts`), `services/ledger/rule-plans.ts` `ruleCandidates` (an `entryId` filter), `routes/transactions.ts` (`GET /:id/rule-prompt`), `routes/preferences.ts` and `schemas/preferences.ts` (`PATCH /rule-prompt`).
- Interface: `components/RulePrompt.tsx` (new), `hooks/useTransactions.ts` (row success, sheet success), `components/TransactionForm.tsx`, `lib/rule-form.ts` (`presetValues`), `components/RuleDialog.tsx` (`preset`), `routes/_authed.rules.tsx` (search `newRule`, `name`, `categoryId`), `locales/fr.json`.
- Tests: `routes/transactions.spec.ts` (eligibility through the route), `routes/preferences.spec.ts` (dismissals), `routes/middleware/roles.spec.ts` (an administrator's read), `lib/rule-form.spec.ts`, e2e `rule-prompt.spec.ts`.
- Docs: `docs/sure-parity.md` Rules row, `docs/architecture.md` AD-21's administrator reads.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: eligibility with no rule, a matching rule, a non-matching rule, a disabled one, no category; both dismissals; viewer refusals.
- [x] Columns and migration; service and routes.
- [x] Prompt, preset dialog, both hand paths; e2e categorises a line, creates the offered rule, then hides the prompt for the day.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given no enabled rule for the category matches, when the owner sets a category from the row or the sheet, then the prompt « Catégorie changée en nom » appears with « Ne plus afficher », « Masquer pour aujourd'hui » and « Créer une règle ».
- Given the prompt, when the owner picks « Créer une règle », then « Règles » opens the rule form named after the label, with « Libellé » « Contient » the label and « Catégorie » the chosen one.
- Given the prompt, when the owner picks « Masquer pour aujourd'hui », then no prompt shows for 24 hours; with « Ne plus afficher » ticked, never again.

## Design Notes

Assumptions taken alone, each settled by Sure:

- The prompt shows Sure's close button (« Fermer », hides this prompt only, writes nothing) and the hint « Masquer pour aujourd'hui suspend ces suggestions pendant 24 heures. », both in Sure's partial though the story lists five texts.
- « Masquer pour aujourd'hui » writes the dismissal time and the checkbox, unticked writing `false`, as Sure's form submits both fields; the server sets the time, not the browser.
- Eligibility runs on the line as stored after the save, among active accounts only, as Sure's `matching_resources_scope` reads visible transactions.
- The prompt is a lasting toast with one id, so a newer prompt replaces the older one as Sure's `turbo_stream.replace("cta")`, in a toaster of its own at the top centre, where Sure's notification tray sits: stacked in the corner with the row's « Catégorie modifiée », an Archant addition kept, it hid that toast's « Annuler » (two e2e tests of `categorise.spec.ts` failed on it). « Annuler » withdraws the prompt.
- The rule name is the label cut to `RULE_NAME_MAX_LENGTH`; the condition keeps the whole label. Sure's name has no limit.
- « Règles » is desktop only: on a phone the link lands on its « use a wider screen » note, as any other link there.
- Upgrade: every user starts with prompts on and never dismissed, as Sure's migration defaults; nothing else changes.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff of `docs` and `packages`, `docs/sure-parity.md` and the Drizzle snapshot aside for size; no second `bmad-code-review` pass over the same diff, to keep usage low. Implemented in the main session rather than a sub-agent.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | The route's comment for `unlock` sat above the new prompt route | low | patch | Moved back above `/:id/unlock`. |
| 2 | Eligibility read every account where the design note says active ones | medium | patch | A deactivated account's line is now eligible, as Sure's visible scope; `transactions.spec.ts` covers it. |
| 3 | The Code Map named `services/rule-prompt.spec.ts`, never written | low | patch | The service is covered through its two routes; the map now lists the real tests. |
| 4 | An unknown id answers `offered: false`, not `NOT_FOUND` | low | reject | A read that offers nothing; the interface only asks right after its own save. |
| 5 | An undo, or a newer pick, before the read answers still shows a stale prompt; answers out of order replace the newer one | medium | patch | `useOfferRule` keeps the latest offer; `withdrawRulePrompt` from « Annuler » cancels a pending one too. |
| 6 | The row offers a rule for an unchanged category | false | reject | `TransactionList` mutates only when the pick differs from the row's category. |
| 7 | Prompts in files before `rule-prompt.spec.ts` may cover controls; the file hides prompts for the rest of the run | medium | patch | Confirmed by the full run: the prompt stacked over « Catégorie modifiée » and two `categorise.spec.ts` tests timed out on « Annuler ». The prompt now has its own toaster at the top, as Sure's tray; both files pass. |
| 8 | The message reads an empty name while categories load | low | reject | Every picker that sets a category has the categories query loaded already. |
| 9 | On a phone « Créer une règle » lands on « Règles » without a form | low | reject | « Règles » is desktop only in Archant; recorded in Design Notes. |
| 10 | A failed load of « Règles » kept the preset in the address and opened the form later | low | patch | The effect clears the address when a query failed. |
| 11 | A deleted category in the address presets a dead action | low | reject | The save refuses it with the form's own error; needs a deletion between prompt and click. |
| 12 | AD-21's list read « … and … and … » | low | patch | Comma restored. |
| 13 | `roles.spec.ts` matches the admin read by replacing the id | low | reject | One admin read under `:id`; the list stays explicit. |
| 14 | Undoing row A closes row B's prompt | low | reject | Needs two rows in flight; closing a prompt loses nothing. |
| 15 | Fake timers could leak on a failed assertion | low | patch | `afterEach` restores real timers. |
| 16 | No test drives the sheet path | medium | patch | e2e categorises from the sheet and sees the prompt. |
| 17 | The 24-hour window was not pinned | medium | patch | The test reads one minute before and one second after. |
| 18 | Negative e2e checks may pass before the client handled the answer | low | defer | The server's eligibility is covered in Vitest; recorded in `deferred-work.md`. |
| 19 | No test proves « Annuler » withdraws the prompt | medium | patch | e2e undoes a row and sees the prompt go. |

