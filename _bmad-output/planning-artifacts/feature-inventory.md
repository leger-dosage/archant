# Feature inventory and epic order

Input for `bmad-create-epics-and-stories`. It lists what Sure offers, what Archant keeps, and the order in which the kept features are built. Decisions recorded here were taken with the project owner on 2026-09-21.

Sure was read from its source: `config/routes.rb`, `app/models`, and the Enable Banking code under `app/models/enable_banking_*`.

## Product decisions

- **One running instance is one household.** There is no household or family entity in the schema. Sure's `Family` model is not reproduced.
- **One user at first.** The user model carries a role from day one, with `admin` as the only role in use. A read-only `viewer` role and an invitation flow come later.
- **Everything is in euros.** Every amount still stores its ISO 4217 currency code, and no code path assumes EUR. Conversion and historical exchange rates are out of scope until a non-euro account exists.
- **Enable Banking is the only bank connector, and it comes late.** File imports carry the product until then.
- **Connectors are pluggable.** Enable Banking, and any later bank connector, implements a small shared interface: list institutions, authorise, list accounts, fetch balances and transactions, report consent expiry. File formats follow the same idea: CSV, QIF and OFX are parsers behind one import pipeline. Adding a connector or a format must not touch the ledger code. The interface itself is an architecture decision, taken before the first file import is built, since the file importer is its first implementation.

## Inventory

| Area | What Sure does | Archant |
| --- | --- | --- |
| Users | `Family` groups users; invitations, per-account sharing with permissions, MFA, passkeys, OIDC single sign-on, impersonation, API keys, subscriptions. | Single user with email and password through Better Auth, `admin` role. `viewer` role and invitations later. Everything else out. |
| Account types | Depository, credit card, loan, investment, crypto, property, vehicle, other asset, other liability. Each is an asset or a liability and can be excluded from reports. | Depository and credit card first. Loan, investment (PEA), property and vehicle soon after. Crypto and the "other" types later. |
| Entries and balances | An `Entry` is a `Transaction`, a `Valuation` (balance snapshot) or a `Trade`. Daily balances are materialised: forward from the opening balance for manual accounts (`Balance::ForwardCalculator`), backward from the provider's current balance for linked accounts (`Balance::ReverseCalculator`). | Kept, it is the core of the domain. No `Trade` at first: investment accounts are tracked through valuations. |
| Bank sync | 25+ providers. For Enable Banking: consent expiry from `access.valid_until`, re-authorisation, linking to an existing account, pending transactions, deduplication on `external_id`. | Enable Banking only, behind the connector interface. |
| File import | CSV with column, account, category and tag mapping, reusable templates, revert. Also QIF, Mint, YNAB, Actual, AI-parsed PDF, Sure export. No OFX. | CSV, QIF and OFX. OFX is written from scratch, Sure has nothing to reuse. |
| Transactions | List with search and filters, single and bulk edit, splits, attachments, notes, tags, exclusion from reports. | List, filters, single and bulk edit, notes, tags, exclusion. Splits and attachments later. |
| Internal transfers | Opposite-sign transactions on two owned accounts within a date window are matched automatically and leave the expense totals. Credit card and loan payments have their own kind. | Kept, early: without it every transfer to a savings account counts as both an expense and an income. |
| Classification | Two-level categories with a default set, mergeable merchants, tags. | Kept. |
| Rules | Conditions (account, amount, name, merchant, category, notes, tag, type) trigger actions (set category, merchant, name, tags; exclude; mark as transfer). Rules can run on past transactions. AI auto-categorisation. | Kept, following Sure's rule model, with the departures listed in Epic 8 (decided on 2026-09-23). No AI actions, no email notification. |
| Recurring transactions | Detects transactions repeating over three months, grouped by merchant or name and amount. | Kept, shortly after the core. |
| Budgets | Monthly budget per category, rollover, copy from previous month. | Deferred. |
| Dashboard and reports | Net worth and its history (`BalanceSheet`); income and expenses by category (`IncomeStatement`); reports page with period picker and CSV export. | Net worth with history, monthly flows by category. |
| Currencies | Historical exchange rates from an external provider. | Deferred, see product decisions. |

## Later, not dropped

These matter and come back once the core is in daily use:

- AI categorisation plugged into the rules engine
- Budgets
- `viewer` role and invitations
- Currency conversion with historical rates
- Investment holdings and security prices (`Trade`, `Holding`, `Security` in Sure)
- Savings goals
- Generated insights and alerts
- Transaction splits and attachments
- Reconciliation against account statements
- Full data export

## Epic order

Each epic delivers something used for real and installs only what it needs, the lesson of `_bmad-output/implementation-artifacts/scaffolding-lessons.md`.

The detailed breakdown, with stories and acceptance criteria, is in `epics.md`. Manual tracking was split from file import there, which gives ten epics:

1. **Track accounts and transactions by hand.** Sets the data model: integer minor units, entries, daily balances.
2. **Import bank files.** CSV, QIF and OFX behind the connector interface, with deduplication and revert.
3. **Protected access and deployment.** Better Auth sign-in for the single `admin` user, then the container.
4. **Classification.** Default categories, merchants, tags, bulk edit.
5. **Internal transfers.** Automatic matching and transfer kinds.
6. **Dashboard.** Net worth with history, monthly income and expenses by category.
7. **Loans, investments and physical assets.** Net worth becomes complete.
8. **Rules.** Sure's rule model: conditions, actions, and application to past transactions.
9. **Recurring transactions.**
10. **Enable Banking sync.** Consent, account linking, daily sync, pending transactions, consent renewal, convergence with file imports.

Epics 4 and 5 come before the dashboard: without them the charts show wrong numbers.

## Visual identity

To settle through `bmad-ux` before the first interface story. Direction agreed so far: shadcn/ui with Tailwind CSS, Sure and Linear as inspiration, departures from Sure allowed. `docs/tech-stack.md` records the choice when the first interface story installs it.
