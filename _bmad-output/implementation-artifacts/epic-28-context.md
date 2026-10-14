# Epic 28 Context: Accounts and balances as Sure

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Bring Archant's accounts and balances back to Sure's behaviour: Sure's account types, subtypes and per-type details, Sure's account list (inactive rows, row menu, default account, ordering, institution and notes) and its step-by-step creation, and balances computed and confirmed as Sure computes and confirms them. Story 27.25 reviewed `docs/sure-parity.md` (« Accounts », « Entries and balances ») against Sure `00dd977fb` and found these departures without an admitted reason. The owner's rule holds: follow Sure exactly; only money as integer minor units, French text a French user expects, accessibility contrast and security justify a departure. An Archant planning document, an AD-n decision or the API error contract is no reason to keep a divergence. No new FR; the epic is parity work.

## Stories

- Story 28.1: Every depository subtype a French household uses
- Story 28.2: Credit card details and the available-credit toggle
- Story 28.3: Loan chart periods and payoff rendering
- Story 28.4: Save a loan whose terms cannot be amortised
- Story 28.5: Investment subtypes for Europe and everywhere
- Story 28.6: Sell more than is held
- Story 28.7: Delete a position and remap its security
- Story 28.8: Property and vehicle details and overview
- Story 28.9: Property and vehicle values only valuations move
- Story 28.10: Other asset and other liability accounts
- Story 28.11: Crypto accounts
- Story 28.12: Inactive accounts listed, and a menu on each account row
- Story 28.13: A default account for new transactions
- Story 28.14: Account order preference
- Story 28.15: Account notes and institution
- Story 28.16: Create an account in Sure's steps
- Story 28.17: Honour a linked account's opening balance
- Story 28.18: Date the bank's balance today
- Story 28.19: Confirm a balance before saving it
- Story 28.20: Opening balance and snapshot refusals as Sure's
- Story 28.21: An activity label on investment transactions, as Sure

## Requirements & Constraints

- Each story names the Sure file or method it mirrors; read Sure at `00dd977fb` (`~/github/sure`) before building, and match its order, words and validation, not only its outcome.
- Visible text uses Sure's `fr.yml` wording where a key exists; where Sure falls back to English or a French word reads wrong (« position » for « holding »), the word a French user expects.
- Money stays integer minor units (NFR1): card details, annual fee, minimum payment and every amount in `accounts.details` are minor units; rates follow the existing integer conventions (AD-25 millionths for loans), APR shown with two decimals.
- Server refusals match Sure's: drop Archant-only checks (loan term bounds, `QUANTITY_UNAVAILABLE`, future-dated valuations, opening date bounds beyond Sure's, `not_found` on `get_valuations`), keep exactly what Sure's models validate.
- Roles: every write is admin-only through `viewerReadOnly`; the interface hides write controls for a viewer (`useIsAdmin()`), and the server refuses them.
- Tax-advantaged subtypes (`pillar_3a`, `riester`, `pension`, `retirement`, and crypto `tax_deferred`/`tax_exempt`) are left out of cash-flow reports and list totals as Sure's `Family#tax_advantaged_account_ids`, but count in net worth.
- Security: no logo fetched from an institution domain (Brandfetch stays out).
- The export carries new details in the account's `accountable` as Sure's exporter; `get_accounts`, `get_holdings`, `get_transactions` carry what Sure's carry.
- Every story ships Vitest and Playwright tests for its acceptance criteria, and sets each `docs/sure-parity.md` row it changes to Parity.

## Technical Decisions

- Account types stay in one list, `ACCOUNT_TYPES` in `packages/data/account-types.ts`, with classification and subtypes; type-specific attributes live in `accounts.details`, validated by a Zod schema per type (AD-6). New types: `other_asset`, `other_liability`, `crypto`. Empty depository subtype allowed as Sure's `allow_blank`.
- Balance kinds as Sure's `Account#balance_type`: property, vehicle, other asset and other liability are non-cash (flows move no balance, only valuations do, forward from each valuation's day); crypto is `:investment` (cash plus holdings). Existing property and vehicle accounts are recomputed by migration.
- Linked accounts: the backward pass in `domain/balances/reverse.ts` honours the opening anchor and records the gap the next day as a cash adjustment; the bank's balance is dated today, an older bank balance becomes a reconciliation on its own date, and an earlier-day anchor rotates into a reconciliation (`services/ledger/bank-link.ts`). `set_opening_balance` still refuses a linked account with Sure's `linked_account`.
- Holdings: overselling saves; quantity may go negative as Sure's `ForwardCalculator`; the cost basis relieves only what was held and restarts at zero. Deleting a position deletes every trade of that security on the account; remapping moves them to another security and merges with an existing position. Crypto `exchange` takes trades, `wallet` none.
- Credit cards: `treat_balance_as_available_credit` stored per bank account; with it on, debt is the limit (bank `credit_limit`, else « Crédit disponible ») less the balance, floored at zero; off, « Crédit disponible » is refreshed from a bank limit.
- Loans: save whatever Sure's `Loan` model accepts; schedule, payoff chart and « Échéancier » only when Sure's `Loan#amortizable?` holds (1 200 periods max). Loan chart periods are Sure's `WINDOW_KEYS`, falling back to « Tout ».
- Per-user settings: `default_account_id` (eligible: active, unlinked depository or credit card; cleared on deactivate, link or delete) and `default_account_order` (Sure's `AccountOrder::ORDERS`, unknown refused).
- Investment transactions carry `investment_activity_label`, locked against sync once set; the four internal-movement labels leave the income statement and the budget.
- Balance confirmation computes the result as a dry run without writing.
- AD changes land with the story that makes them, never before: AD-8 (28.9, 28.17, 28.18, 28.20), AD-18 (28.18), AD-22 (28.6, 28.7, 28.11). `packages/api/src/architecture-references.spec.ts` checks cited AD-n headings.

## UX & Interaction Patterns

- Creation in Sure's steps (`accounts/new`): type list in Sure's order with icon and colour; then « Comment voulez-vous l'ajouter ? » with « Saisir le solde du compte » or « Lier un compte européen »; then the type's own form, « Solde à la date : » and « Date du solde d'ouverture »; property in « Vue d'ensemble », « Valeur », « Adresse » steps. Every field of `CreateAccountDialog.tsx` stays reachable.
- Accounts list: inactive accounts muted in their group, no hide toggle; row menu « Modifier », « Désactiver/Activer le compte », « Exclure de tous les rapports/Inclure dans les rapports », « Supprimer le compte » (unlinked only), « Définir/Retirer par défaut »; « Par défaut » badge; « Exclu des rapports » icon; institution after « • » on wide screens, under the name on phones.
- « Détails supplémentaires » closed disclosure for institution name, domain and notes.
- Property and vehicle get a « Vue d'ensemble » tab with Sure's cards, « Inconnu » for missing values.
- Balance confirmation step: « Confirmer le nouveau solde » / « Mettre à jour le solde » with Sure's recalculation notice; investment accounts split « Valeur des positions » and « Trésorerie de courtage ».
- Loan chart greys « Solde enregistré » past the cursor; contract and projection lines are not split.

## Cross-Story Dependencies

- Stories 28.1 to 28.9 and 28.12 to 28.15 first, any order. 28.10 after 28.9 (non-cash rule); 28.11 after 28.10. 28.16 after 28.2, 28.8 and 28.10, since the steps host their forms. 28.17 to 28.21 then, any order; 28.17, 28.18 and 28.20 all edit AD-8 and the balance ledger, so build them one at a time.
- Story 32.8 of Epic 32 follows 28.21.
- Two rows of the same parity sections belong to Epic 34: chart vertical axis labels (Story 34.2) and snapshot notes (Story 34.10).
- Builds on Epic 27: Story 27.17's opening balance sheet, 27.21's opening-date rules (balances start at the oldest entry), 27.5's cost basis, 27.19's Enable Banking balance selection, and 27.9's assistant formats.
