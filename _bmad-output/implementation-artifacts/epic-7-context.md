# Epic 7 Context: Loans, investments and physical assets

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The user adds a loan, an investment account (PEA and similar), a property and a vehicle, so net worth reflects the whole household rather than only bank and card accounts. These accounts are tracked mostly through balance snapshots (valuations), not transactions: a loan's outstanding amount follows the lender's statements and the payments made to it, an investment account follows its recorded value without holdings or trades, and a property or vehicle follows its estimated value. Transfers into a loan or an investment account get their own kind, and their outflow side counts as an expense, so the dashboard's cash flow shows loan repayments and contributions as spending instead of hiding them as internal moves.

## Stories

- Story 7.1: Loan accounts
- Story 7.2: Investment accounts (PEA)
- Story 7.3: Property and vehicle accounts

## Requirements & Constraints

- Loan: a liability, created with its outstanding balance and optionally its original amount, rate and end date. Its outstanding amount is tracked through balance snapshots from the lender's statement and through payments; a matched payment lowers it. Listed under liabilities.
- Investment: an asset with subtype PEA, assurance-vie, compte-titres or other, tracked through value snapshots only. No holdings, trades or security prices (deferred to later). Listed under assets.
- Property and vehicle: assets created with a value at a date; a new estimated value updates the history with no transaction needed.
- Transfer kinds: a matched transfer from a depository into a loan account is a loan payment; into an investment account, an investment contribution. For both, the outflow side counts as an expense in the monthly cash flow, and the inflow side on the loan or investment account counts in neither income nor expenses.
- These accounts feed net worth (assets minus liabilities, accounts not excluded from reports) through the existing daily balances.
- Money is integer minor units plus a currency, never a float; no code path assumes EUR.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest. Money paths (balance computation, transfer matching) are covered to the branch.

## Technical Decisions

- Account types: add the new types to the one `ACCOUNT_TYPES` const in `packages/data/account-types.ts`, each with its classification (`asset` or `liability`) and allowed subtypes. Enumerations are `text` columns with a check constraint built from a `const` array in `@archant/data`. Type-specific attributes (a loan's original amount, rate, end date) live in `accounts.details`, a JSON column validated by a Zod schema per type. Never a second list of types.
- Sign convention: an entry amount is signed from the account's point of view (negative leaves the account), for assets and liabilities alike. Stored balances are the asset's value and the amount owed on a liability (positive). A liability's day balance is `previous - sum(amounts)`, so a positive inflow on a loan lowers what is owed. Net worth is `sum(assets) - sum(liabilities)`.
- Valuations: `entries` has `kind` `transaction` or `valuation`. A valuation's amount is the stored balance, never a delta. Every account has exactly one `opening_anchor`, created with it; a balance snapshot is a `reconciliation` that sets the end-of-day balance on its date. Manual accounts compute forward from the opening anchor. Every reader uses `balanceOn(accountId, date)`.
- Ledger is the single writer: only `services/ledger.ts` writes `entries`, `transactions`, `balances`, `transfers`; each call takes an `origin` and runs in one immediate transaction that recomputes balances before commit.
- Transfer kind derives from the inflow account's type: credit card gives `credit_card_payment`, loan gives `loan_payment`, investment gives `investment_contribution`, anything else `internal_move`. Matching rules are unchanged (opposite amount, different account, same currency, within 4 days, mutual uniqueness for automatic matching).
- Cash flow lives only in `domain/cash-flow.ts`: `countsInCashFlow(tx)` and `direction(tx)`. The exception for the outflow side of `loan_payment` and `investment_contribution` is already part of that definition; the transaction list's direction filter lists such an outflow under expense. Reports go through the one query builder in `services/reports.ts`.
- API: `{ data }` / `{ error }` envelope, `fields` on validation errors, request schemas in `packages/api/src/schemas/`, closed `AppError` union.

## UX & Interaction Patterns

- New accounts appear in the sidebar and on `/comptes` in the Actifs or Passifs group with name, subtype caption and balance. The mockup shows « PEA » with caption « Titres » under Actifs, and « Prêt immobilier » with caption « Emprunt » under Passifs.
- A liability's balance reads as the positive amount owed under Passifs; balances and totals are never coloured.
- Snapshots are recorded from the account detail (tabs Opérations, Soldes, Imports, Paramètres); the balance chart follows them.
- Amount inputs go through `parseAmount`; dates use shadcn `Calendar` in French. Every visible string goes through `locales/fr.json`; French, vouvoiement, no exclamation marks.

## Cross-Story Dependencies

- Builds on Epic 1's account form, `ACCOUNT_TYPES`, valuations and daily balances, Epic 5's transfer matching and kinds, and Epic 6's net worth and cash flow, which pick up the new accounts and the expense-counting outflows without changes to their code.
- Stories 7.1 and 7.2 both extend transfer kinds and the cash-flow exception; Story 7.3 needs no transfer work.
