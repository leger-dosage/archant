# Epic 32 Context: Categories, merchants, tags and rules as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's categories, merchants, tags and rules back to Sure's behaviour (Sure at `00dd977fb`, `~/github/sure`). Story 27.25's review of `docs/sure-parity.md` found these departures citing a spec, an Epic 8 decision or nothing, none of the admitted reasons: money as integer minor units, French text a French user expects, accessibility and security. The epic is parity work, with no new FR.

## Stories

- Story 32.1: Categories without a kind
- Story 32.2: Sure's default categories, merged, deleted and restored
- Story 32.3: Merchants and tags as Sure
- Story 32.4: Every rule operator
- Story 32.5: Match an amount in any currency
- Story 32.6: Add several tags in one rule action
- Story 32.7: Filter rules by provider details
- Story 32.8: Set an investment activity label by rule
- Story 32.9: Confirm a rule before it runs, sort the list, apply every rule
- Story 32.10: Run rules over the history after each sync, and list every run
- Story 32.11: Offer a rule after categorising
- Story 32.12: Categorise uncategorised lines in groups
- Story 32.13: Delete every rule

## Requirements & Constraints

- Each story names the Sure file it mirrors (`app/models/rule/condition_filter.rb` and its subclasses, `rule/action_executor/*`, `rules_controller.rb`, `Family::Syncer#perform_post_sync`, `RuleJob`, `category.rb`, `family_merchant.rb`, `tag.rb`, their mergers and controllers). Read it at `00dd977fb` before building, and match its fields, order, words and refusals.
- Visible text uses Sure's `config/locales/**/fr.yml` wording, except where it reads as Quebec French or a mistranslation; Archant keeps its own words for the same thing (« étiquette », not « balise »).
- Departures that stay: French default category names, no merchant logo (the Content-Security-Policy refuses Brandfetch), and the owner's additions of 2026-10-14: replace in the label, the transfer action without a mirror entry, rules applied in creation order, a manual application that respects locks, creation from the rule pickers. No AI or e-mail action.
- Every write is a mutating method refused to a viewer by `viewerReadOnly`; the interface shows write controls only when `useIsAdmin()` is true.
- Each story ships Vitest and Playwright tests for its acceptance criteria and updates its `docs/sure-parity.md` row.

## Technical Decisions

- Rule condition types and operators are closed lists in `@archant/data/rules.ts`; the `rule_conditions` check constraints are built from them, so a change of operators is a migration that rebuilds the table.
- Rules are evaluated in TypeScript (`domain/rules/matching.ts`), not SQL, because SQLite's `LIKE` does not fold case beyond ASCII as Sure's `ILIKE` does.
- The ingestion pipeline (AD-4) runs rules after key matching and before transfer matching; AD-4 changes with Story 32.10.

## Cross-Story Dependencies

Story 32.1 comes first; Story 35.2 follows it. Story 32.2 comes before Story 31.7. Story 32.10 follows 32.9. Story 32.8 follows Story 28.21. The others come in any order. Story 30.3 imports categories, merchants and rules from CSV, and Story 29.4 creates merchants from the bank's counterparties.
