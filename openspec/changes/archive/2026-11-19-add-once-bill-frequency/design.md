## Context

[Sure #4975](https://github.com/we-promise/sure/pull/4975), merged at `eaca5de62496a055d0027a92d37102eb2ec89fa7`, writes a yearly rule with a one-payment cap in `FrequencyPreset`. Its `OccurrenceGenerator` includes overdue anchors and replaces the specific old date when moved. The patch also updates Sure's paycheck planner and Smart Fill. Archant has neither of those features.

## Decisions

- Read and write the existing annual rule, anchor and one-payment cap through `detectFrequency`, `applyFrequency` and the bill service. Keep installment counts and transfer cadence as their own contracts. A new stored frequency would require translating archives and migrating the schedule schema.
- Use `generateOccurrences` and the existing unique occurrence key. On a date edit, check the old anchor for a closed occurrence or an allocation inside the bill update transaction. Let `regenerateFuture` replace that anchor alongside its usual future cleanup.
- Let existing matching and budget reservations read the same occurrence. For Upcoming, use its existing window and omit closed one-off occurrences. The general occurrence and payment actions still apply. Recurring cost summaries exclude the one-off amount, as Sure’s All Bills and detail screens do.

## Risks / Trade-offs

- A fixed yearly pattern can accidentally repeat if an edit drops its cap. Exercise metadata edits and yearly boundary generation in service tests.
- A date edit can discard history if it targets the whole series. Exercise editing an overdue one-off and preserving obligations from its former cadence.

## Migration Plan

Archive imports and exports already carry the rule, anchor and end count. Deploy the application without a database migration.
