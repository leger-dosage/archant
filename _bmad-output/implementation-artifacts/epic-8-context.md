# Epic 8 Context: Rules

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

New transactions are categorised and cleaned up automatically, whatever their source, and the user can run rules over past transactions after seeing how many would change. The rule model follows Sure's `Rule`, `Rule::Condition` and `Rule::Action` (`app/models/rule*.rb`, `app/models/rule/`): a rule has conditions on transaction fields and actions that set category, merchant, tags or label, exclude the transaction, or mark it as a transfer. Each story names its departures from Sure. A field the user set by hand is never overwritten by a rule. Out of scope: AI actions, the email notification action, Sure's investment activity label and provider-details conditions, the prompt to create a rule after categorising, the quick-categorise wizard, deleting every rule at once, and rule import and export.

## Stories

- Story 8.1: Create a categorisation rule
- Story 8.2: More rule conditions and actions
- Story 8.3: Apply rules to existing transactions

## Requirements & Constraints

- Rules run on every new transaction, whether created by hand, imported from a file, or later synced from a bank.
- A rule matches only when every top-level condition does; a condition group, one level deep only, matches on all or any of its conditions. A rule without conditions matches every transaction, as in Sure. An optional start date (Sure's `effective_date`) limits the transactions a rule reaches.
- Enabled rules apply in creation order, each seeing what earlier ones wrote. A rule may overwrite a value another rule wrote; it never overwrites a user-set value. Disabling a rule leaves what it wrote in place. A new rule is enabled at once.
- At ingestion a rule reaches only the new transactions. The history is reached only through an explicit, confirmed application whose count includes only transactions that would actually change (field not locked, not already at that value). Only confirmed applications are recorded as runs; imports are not.
- A "mark as transfer" action never creates an entry or a transfer: it records an expected counterpart account that the transfer matcher reads.
- Money is integer minor units plus a currency, never a float; amount conditions compare against the transaction's absolute amount.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. Rule evaluation lives in `domain/`, which has a 100% branch coverage threshold, as does `services/ledger.ts`.

## Technical Decisions

- Ingestion pipeline: `ledger.ingest` runs per account in one transaction, in a fixed order: reject lines before the opening anchor, key matching, pending reconciliation, insert entries, **rules (step 5)**, transfer matching (step 6), statement balance, balance recompute. Rules therefore see no transfer yet at ingestion, so a « Virement » type condition never matches a new transaction there; the balance recompute follows any exclusion a rule sets. Manual creation goes through the same function, and a `dryRun` preview runs the same steps.
- Field locks: `transactions.locked_fields` is a JSON array of field names. Only a ledger call with `origin: "user"` adds to it; every other origin, `rule` included, never writes a locked field. Rules write with `origin: "rule"`, which sets `transactions.category_origin` to `rule` and locks nothing. Tags are locked as a whole.
- The ledger is the single writer of `entries`, `transactions`, `balances`, `transfers`; a rule service calls ledger functions, never those tables. Applying rules to history writes in one immediate transaction, runs transfer matching for transactions a transfer action marked, and recomputes balances before commit.
- Rules live in `domain/rules/`, pure functions with no Drizzle or Hono imports. The rules tables are settled by Story 8.1, following Sure's model. Enumerations (operators, action kinds, condition fields) are `text` columns with a check constraint built from a `const` array in `@archant/data`.
- Transfer matching is unchanged: opposite amount, different account, same currency, within 4 days, mutual uniqueness for automatic matching; the kind follows the inflow account. An expected counterpart narrows candidates to that account.
- Label comparison trims and collapses runs of spaces; label normalisation already lives in `domain/normalize-label.ts`.
- API: `{ data }` / `{ error }` envelope, `fields` (`{ path, code }[]`) on validation errors so the form can point at the faulty field, request schemas in `packages/api/src/schemas/`, closed `AppError` union, paginated lists as `{ items, page, pageSize, total }`. A route calls exactly one service function.

## UX & Interaction Patterns

- Rules page at `/regles`, reached from the sidebar and `g u`; the nav entry appears with this epic. Below 768 px it shows « Disponible sur ordinateur ».
- The list shows rules in application order, each with its name or a summary built from its first condition and action; a switch toggles each rule, a menu holds the per-rule actions.
- Confirmation dialogs state counts, the destructive button repeats the verb, focus starts on Annuler. Dialogs stack one level deep at most.
- Forms use shadcn `Form` with react-hook-form; amounts through `parseAmount`, dates through shadcn `Calendar` in French. Comboboxes for category, merchant, tag and account type to filter and pick with `Enter`.
- Every visible string goes through `locales/fr.json`: French, vouvoiement, infinitive-verb buttons, no exclamation marks. Errors are translated from `errors.<CODE>`; server errors show a destructive Sonner toast.
- Accessibility floor: keyboard reach, visible focus, focus returns on `Esc`, `aria-live` toasts, 24 px targets, WCAG 2.2 AA contrast.

## Cross-Story Dependencies

- Builds on Epic 2's ingestion pipeline (step 5 was a no-op until now), Epic 4's categories, merchants, tags, exclusion and `locked_fields`, and Epic 5's transfer matcher at step 6.
- Story 8.1 creates the rule tables, the evaluator, the page and step 5; Story 8.2 extends conditions and actions on that model and adds the expected-counterpart input to the transfer matcher; Story 8.3 adds the application to history, the count preview and the runs log, and reuses the evaluator and lock handling of 8.1 and 8.2.
- Epic 10's sync reuses `ledger.ingest`, so rules apply to synced transactions without further work.
