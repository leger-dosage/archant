---
title: "Story 32.5: Match an amount in any currency"
type: 'feature'
created: '2026-10-24'
status: 'done'
baseline_commit: '7a88d89be7ba203f9c5d8545733ef9f56b07ce61'
route: 'dispatch'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sure (`00dd977fb`) `Rule::ConditionFilter::TransactionAmount#apply` compares `ABS(entries.amount)` with `value.to_d` whatever the entry's currency, and the form's number field steps by `number_step`, the family currency's `step`. Archant stores an amount condition in minor units of the reporting currency and `amountMatches` in `domain/rules/matching.ts` leaves every line in another currency out.

**Approach:** the condition's value becomes Sure's decimal text in major units (« 50 », « 12.5 »). The evaluator compares each line in integers: the value's digits and `abs(amount)` scaled to the larger of the value's decimals and the line's currency exponent, as `BigInt`. A migration rewrites every stored amount condition, and every rule run's snapshot, from EUR minor units to decimal text at two decimals. The form's field becomes a number field stepping by the reporting currency's minor unit; the summary, the assistant read and the Sure export show the decimal without a currency.

## Boundaries & Constraints

**Always:**
- Accepted value: unsigned digits with an optional `.` or `,` fraction, any number of decimals, trimmed; stored with a `.` and the integer part without leading zeros. Anything else, a sign included, is `invalid_amount` as today.
- Comparison never goes through a float and rounds neither side.
- A line in a code outside ISO 4217 compares at two decimals, as `toDecimalString` reads it.
- The migration keeps every rule, condition and run; only amount values change.

**Ask First:** none; the owner is unavailable and Sure settles every decision below.

**Never:** no exchange rate (AD-6); no change to the amount operators' symbols (deferred since Story 32.4); no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Any currency | `>` « 50 », lines −60 EUR, −60 USD, −60 JPY | all match | none |
| JPY scale | `>=` « 50 », line 50 JPY (minor 50) | match | none |
| More decimals | `<` « 12.345 », line 12.35 EUR / 12.34 EUR | no / match | none |
| Value finer than JPY | `=` « 50.5 », line 50 JPY / 51 JPY | no / no; `!=` matches both | none |
| Comma typed | « 12,5 » | stored « 12.5 » | none |
| Sign | « -5 » | nothing written | `400` `value` `invalid_amount` |
| Upgrade | condition `5000`, run snapshot value `5000` | « 50.00 » in both | none |

</frozen-after-approval>

## Code Map

- `~/github/sure` `00dd977fb`: `app/models/rule/condition_filter/transaction_amount.rb`, `condition_filter.rb` (`number_step`), `app/javascript/controllers/rule/conditions_controller.js`, `app/models/rule/condition.rb` (`value_display`), `app/views/api/v1/rules/_condition.json.jbuilder`.
- Data: `packages/data/money.ts` (new `Decimal`, `parseUnsignedDecimal`, `compareWithDecimal`), `rules.ts` and `schema/rules.ts` comments, a custom migration `0096` through `pnpm data generate --custom`, `migrate.spec.ts`.
- API: `domain/rules/matching.ts` (`AmountCondition`, `amountMatches`, drop `reportingCurrency` from `matches` and `planActions`), `services/rule-reader.ts` (`toLeaf`), `schemas/rules.ts` (`checkLeaf`, `storedValue`, `ruleSchema` without a currency), `services/rules.ts`, `sure-import.ts`, `csv-import-rules.ts`, `sure-rules.ts` (`conditionOf`), `export.ts` (`conditionOperand`), `mcp/rules.ts` (`valueOf`), `schemas/assistants/rules.ts`; their specs.
- Interface: `components/RuleDialog.tsx`, `components/RuleConditionRows.tsx` (number field, `step`), `lib/rule-form.ts` (`leafValues`), `lib/rule-summary.ts` (`valueText`), callers of `SummaryNames`.
- e2e: `packages/app/e2e/rules.spec.ts` (amount rule tests near line 190, a new rule applied to a USD line).
- Docs: `docs/sure-parity.md` row « Amount condition », `deferred-work.md` item of Story 8.1.

## Tasks & Acceptance

**Execution:**
- [x] Specs first: `matching.spec.ts` each operator on EUR, USD and JPY lines and a value with more decimals; `money.spec.ts` for the parser and comparison; `schemas`/`routes/rules.spec.ts` storage and refusal; `migrate.spec.ts` for 0096; summary, assistant, export and Sure import specs updated.
- [x] Data: helpers, migration.
- [x] API: evaluator, reader, schema, imports, export, assistant.
- [x] Interface: number field with step, form values, summary; e2e.
- [x] Docs, story and sprint status.

**Acceptance Criteria:**
- Given a rule « Montant » « > » 50, when it runs, then a line of 60 € and a line of 60 $ both match.
- Given the rule form on « Montant », then the value field is a number field whose `step` is `0.01` in EUR.
- Given a saved amount rule « > » 50, then the list reads « Si Montant > 50, alors … », without a currency.
- Given an existing amount rule of `5000`, after migration its value is « 50.00 » and it matches what it matched in EUR.

## Design Notes

Assumptions taken alone, the owner unavailable, each settled by Sure:

- The summary and the assistant show the value without a currency: Sure's `value_display` prints the raw value and its API returns `condition.value`; a « € » would claim a currency the comparison no longer reads. The summary formats it the French way, « 12,5 », keeping the decimals stored.
- A comma is still accepted in the API, as `parseAmount` accepted it before, so a rule typed « 50,00 » keeps saving; Sure's number field sends a dot.
- Rule run snapshots are migrated too, so a past run's summary reads « 50,00 » rather than « 5 000 ».
- The migration hard-codes two decimals: `getReportingCurrency()` returns `DEFAULT_CURRENCY`, EUR, and has never been a setting.
- `ruleSchema` loses its currency parameter, since the amount no longer depends on it.

## Review Triage Log

Review by `bmad-build` step 4 (Blind Hunter, Edge Case Hunter, Verification Gap) on the diff without the generated snapshot and the planning files; no second `bmad-code-review` pass over the same diff.

| # | Finding | Verdict | Route | Evidence |
|---|---------|---------|-------|----------|
| 1 | A value with more than 100 decimals passes the API and makes `Intl.NumberFormat` throw in the rule summary, crashing the rules page | medium | patch | `checkLeaf` now refuses more than `AMOUNT_MAX_DECIMALS`, eight, with `invalid_amount`; `routes/rules.spec.ts` covers it. |
| 2 | No test refuses an amount over 200 characters | low | patch | `routes/rules.spec.ts` adds the case. |
| 3 | `docs/deployment.md` still says the rule tools format amounts | medium | patch | Both sentences now say a rule's amount is a decimal string in no currency. |
| 4 | `toLeaf` parsed a decimal for every condition, an id included | low | patch | The parse now sits in the amount branch, an unreadable stored amount throwing `malformed()` as any hand-edited row. |
| 5 | The migration's `CAST` turns a hand-edited non-integer value into `0.00` | false | reject | Every amount condition was written by `String(parseAmount(...))` behind a refusal of negatives: only non-negative integers reach 0096. |
| 6 | The rule's value leaves AD-6's `{ amount, currency }` | low | reject | It is no money held in a currency but Sure's comparator, matched against each line's own money; the comparison stays in integers. |
| 7 | Existing rules now reach lines in other currencies after upgrade, so the change needs `breaking-change` | low | reject | That is the story's intent, as Sure; no self-hoster action follows, and the PR says so. |
| 8 | The API now refuses grouped digits such as « 1 234,5 » | low | reject | The form's number field and the assistant send a plain decimal, as Sure's `number_field`. |
| 9 | A number field in a dot-locale browser drops « 12,50 » | low | reject | The browser's own number field, as Sure's. |
| 10 | `amountText` hard-codes `fr-FR` | low | reject | The interface is French only; `formatMoney` defaults to the same locale. |
| 11 | No route or e2e round trip of a three-decimal amount | low | reject | `matching.spec.ts` and `money.spec.ts` cover the comparison and the storage; the route stores a comma decimal as a dot. |
| 12 | A Sure archive amount with three decimals is now kept | low | reject | Intended: Sure's value is kept as Sure holds it. |
| 13 | Spec helper names `eur(minor)` and `jpy(yen)` differ | low | reject | Cosmetic. |
