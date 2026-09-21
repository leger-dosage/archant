---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - _bmad-output/planning-artifacts/feature-inventory.md
  - AGENTS.md
  - docs/project-overview.md
  - docs/tech-stack.md
  - docs/adr/0001-technology-stack.md
  - docs/adr/0002-container-reference-target.md
  - docs/deployment.md
  - _bmad-output/implementation-artifacts/scaffolding-lessons.md
  - _bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md
---

# archant - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for archant, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

No PRD, architecture or UX document exists. `feature-inventory.md` stands in for the PRD; `AGENTS.md`, `docs/` and the ADRs stand in for the architecture. Functional requirements below are derived from the inventory and validated with the project owner.

## Requirements Inventory

### Functional Requirements

#### Accounts and balances

FR1: The user can create an account by hand with a name, a type, a currency (EUR by default) and an opening balance at a given date.
FR2: Every account type is classified as an asset or a liability. Depository is an asset, credit card is a liability.
FR3: The user can rename and edit an account, deactivate it (hidden from lists, history kept), and delete it (its entries are deleted with it, after confirmation).
FR4: The user can exclude an account from net worth and reports.
FR5: The user can see all accounts grouped by type, each with its current balance.
FR6: The user can record a balance snapshot for an account at a date. From that date, the snapshot overrides the computed balance.
FR7: The system computes a daily balance history for each account from its opening balance, transactions and balance snapshots, and recomputes it after any change to them.
FR8: The user can see an account's balance history as a chart over a chosen period.
FR9: The user can create a loan account, a liability whose outstanding amount is tracked through balance snapshots and payments.
FR10: The user can create an investment account (PEA) tracked through balance snapshots only, without holdings.
FR11: The user can create a property or a vehicle account, an asset tracked through balance snapshots.

#### File import

FR12: The user can import a CSV, QIF or OFX file into an existing account.
FR13: For a CSV file, the user maps columns (date, label, a signed amount or separate debit and credit columns, optional notes), and chooses the date format, decimal separator, delimiter and sign convention. The mapping is saved per account and reused on the next import.
FR14: The QIF importer reads bank-type records: date, amount, payee, memo, and number.
FR15: The OFX importer reads OFX 1.x (SGML) and 2.x (XML) statements: transaction id (`FITID`), posting date, amount, name and memo, plus the ledger balance and its date.
FR16: Before anything is written, the user sees a preview: transactions to create, transactions recognised as already present, and rejected lines with the reason.
FR17: Importing the same file twice, or two overlapping files, creates no duplicate. The key is the source's transaction id when one exists (`FITID`), otherwise a fingerprint of account, date, amount and normalised label, with an occurrence counter so that two identical lines on the same day both survive.
FR18: Each import is recorded with its file name, format, date and counts. The user can revert an import, which deletes the transactions it created and only those.
FR19: When an OFX file carries a ledger balance, the import records it as a balance snapshot at its date, so the computed balance matches the bank's.

#### Transactions

FR20: The user can list transactions across all accounts, most recent first, paginated.
FR21: The user can filter the list by account, date range, category, amount range, direction (income, expense, transfer), tag, and text in the label or notes.
FR22: The user can create a transaction by hand in an account.
FR23: The user can edit a transaction's date, label, amount, category, merchant, notes and tags. Editing an imported transaction does not break its deduplication key.
FR24: The user can delete a transaction.
FR25: The user can exclude a transaction from reports without deleting it.
FR26: The user can select several transactions and set their category, merchant, tags or exclusion, or delete them, in one action.

#### Classification

FR27: A fresh instance comes with a default set of two-level categories suited to a French household, each marked as income or expense.
FR28: The user can create, rename, move, merge and delete categories. Deleting a category moves its transactions to another category or leaves them uncategorised, as the user chooses.
FR29: The user can create, rename, merge and delete merchants, and set a merchant on a transaction.
FR30: The user can create, rename and delete tags, and put several tags on a transaction.

#### Internal transfers

FR31: The system matches two transactions of opposite amounts, in two different accounts, within a date window (default 4 days), as a transfer. A transaction with more than one candidate is not matched automatically.
FR32: The user can match two transactions as a transfer by hand, undo a match, and reject a proposed match. A rejected pair is never proposed again.
FR33: A transfer has a kind: internal move, credit card payment, loan payment, investment contribution. Internal moves and credit card payments are left out of income and expense totals.

#### Dashboard

FR34: The user sees net worth, assets minus liabilities over accounts not excluded, with its history over a chosen period (1 month, 3 months, 6 months, 1 year, all).
FR35: The user sees income and expenses for a chosen month, broken down by category, leaving out excluded transactions and internal moves. The uncategorised total is shown separately.

#### Rules

FR36: The user can define rules made of conditions on transaction fields and actions that set category, merchant, tags or label, exclude the transaction, or mark it as a transfer. The rule model itself is designed with the project owner when the epic starts; Sure's model is a reference, not a contract.
FR37: Rules run on every new transaction, whatever its source, and the user can run them on existing transactions after a preview of what would change.
FR38: A field the user set by hand is never overwritten by a rule.
FR39: The rules engine exposes an extension point where a categorisation provider, such as an AI model, can propose a category.

#### Recurring transactions

FR40: The system detects recurring transactions: same merchant or label, similar amount, regular interval, over the last months.
FR41: The user sees recurring transactions with their expected next date and amount, and can confirm, dismiss or add one by hand.

#### Access

FR42: On first launch with no user, a setup screen creates the administrator account with an email and a password. Public sign-up does not exist.
FR43: The user signs in and out. Every API route requires a session, except health, sign-in and first-launch setup. `POST /api/sync` requires the shared secret instead.
FR44: Every user has a role. `admin` is the only role in use; the schema allows adding `viewer` later without a data migration.
FR45: The user can change their password. A forgotten password is reset through a command run on the server, since a self-hosted instance may have no email service.

#### Deployment

FR46: One container image serves the built interface and the API on the same port, against a SQLite file on a volume, and applies pending migrations at start.
FR47: `GET /api/health` reports that the API and its database answer.

#### Enable Banking synchronisation

FR48: The user picks a country and a bank from the Enable Banking list, is sent to the bank to consent, and comes back through a callback.
FR49: The user chooses which bank accounts to link. Each one links to a new account or to an existing account, for instance one already fed by files.
FR50: A sync fetches balances and transactions for every linked account since the last sync, with an overlap window. It runs from `POST /api/sync` and from a button in the interface.
FR51: A pending transaction is stored as pending. When its booked version arrives, it updates the pending one in place without creating a duplicate, even if the label changed, or the amount when the bank keeps the same reference.
FR52: A transaction that arrives both from a file and from Enable Banking ends up as one transaction.
FR53: The interface warns when a consent expires within 14 days and lets the user renew it. After expiry, sync stops for that connection with a visible status, and no data is lost.
FR54: The user can disconnect a bank. Its accounts stay, with their history, as manual accounts.
FR55: Each connection shows its last successful sync and its last error.
FR56: A linked account uses the balance reported by the bank as its reference and computes its history backward from it.

### NonFunctional Requirements

NFR1: Money is never a float. Every amount is an integer in minor units with an ISO 4217 currency code.
NFR2: No code path assumes EUR. Totals are computed in one reporting currency; an account in another currency is left out of totals with a visible notice until conversion exists.
NFR3: Every input crossing a boundary is parsed by a Zod schema: request bodies, uploaded files, provider responses, environment variables.
NFR4: Provider tokens and keys are encrypted at rest, never logged, never returned by an endpoint.
NFR5: Logs and error reports never contain an amount tied to an identity, an IBAN, or a token.
NFR6: Sessions are handled by Better Auth with its defaults intact.
NFR7: The API answers `{ "data": ... }` or `{ "error": { "code", "message" } }`. Codes are a closed union in `AppError`; an unexpected error returns a generic `INTERNAL_ERROR` 500 without stack trace or provider payload. Messages are in English.
NFR8: An import or a sync is atomic per account: a failure writes nothing for that account.
NFR9: The whole application runs as one process with no queue and no broker. A sync runs inside the request that triggers it.
NFR10: With 50,000 transactions in SQLite, the first page of the transaction list answers in under 300 ms and a 5,000-line file imports in under 10 seconds on a small server.
NFR11: No test reaches the network; an unmocked request fails the test and names the URL. Money paths (import, deduplication, balance computation, transfer matching, provider sync) are covered to the branch.
NFR12: The interface is in French first. Every visible string goes through a translation layer so another language can be added without touching components.
NFR13: The interface is usable with the keyboard alone and meets WCAG 2.2 AA contrast.
NFR14: Dependencies stay few and popular; each new one is justified in its pull request.

### Additional Requirements

- No starter template. The first story that needs a package creates it with only the dependencies it uses. The pitfalls in `scaffolding-lessons.md` apply: `.ts` import extensions, recursive `include`, `onlyBuiltDependencies: [esbuild]`, the shared `DATABASE_URL` path, `:memory:` databases in tests, the `/api` prefix before the API serves the interface, `init: true` in the container.
- The connector interface is decided through `bmad-architecture` before the first import story. File parsers and bank connectors both produce normalised transactions; one ledger service deduplicates and writes them. Adding a connector or a format never touches the ledger.
- `@archant/api` has a single entrypoint, `packages/api/src/index.ts`, and never branches on the platform.
- SQLite through Drizzle only, snake_case columns mapped to camelCase, derived types in `packages/data/types.ts`, no raw SQL in application code. Migrations applied with `drizzle-orm/libsql/migrator`.
- Environment validated by a `validateEnv(runtimeEnv)` function built on `@t3-oss/env-core`; `.env.example` lists every variable and what degrades without it.
- The interface calls the API through Hono's typed client (`hc<AppType>()`), with chained route mounts and the same Hono version in both packages.
- Interface built with Vite, React, TanStack Router, TanStack Query, shadcn/ui and Tailwind CSS.
- `POST /api/sync` is protected by a shared secret and meant to run once a day, triggered by a cron or a scheduled GitHub Action.
- GitHub Actions runs the verification gate on every pull request and exercises the container once it exists.
- Enable Banking credentials (application id and private key) come from the environment.
- Backups are documented in `docs/deployment.md`, not automated by the application.
- Amounts are signed from the account's point of view: negative means money leaving the account. A liability's balance is displayed as a positive outstanding amount. The architecture fixes the storage convention.
- The architecture spine, `architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md`, binds every story; its `AD-n` rules win over any wording here.
- Ordering constraints outside this document: `bmad-architecture` settles the connector interface and the data model before Story 2.1, and `bmad-ux` produces `DESIGN.md` and `EXPERIENCE.md` before Story 1.1, the first interface story.

### UX Design Requirements

Source: `ux-designs/ux-archant-2026-09-21/DESIGN.md` and `EXPERIENCE.md`. Both bind every interface story; they win over any wording here.

UX-DR1: The shadcn/ui neutral base with the brand layer of `DESIGN.md` (colours for light and dark mode, Geist and Geist Mono, radii 4/6/8), dark mode following the system with a manual override. Story 1.1.
UX-DR2: One `Money` component renders every amount: `fr-FR`, tabular figures, income green with a plus, expenses in the foreground colour with a true minus, muted for pending and excluded with a badge or icon. Story 1.1.
UX-DR3: Sidebar with navigation entries and the accounts grouped under Actifs and Passifs with totals and balances, collapsing below 1024 px and becoming a sheet below 768 px. Stories 1.1, 1.6.
UX-DR4: Transaction sheet with save on `⌘Enter`, `Esc` to close, a prompt only when changes are unsaved, and the transaction's source shown. Story 1.2.
UX-DR5: Charts with a text summary and a « Voir les données » table alternative, keyboard cursor, no animation under reduced motion. Stories 1.3, 6.1, 6.2.
UX-DR6: Transactions list grouped by day headers, filters as removable chips kept in the URL, result count and signed total of the filtered rows. Story 1.5.
UX-DR7: Command palette on `⌘K` / `Ctrl+K` and the keyboard shortcuts of `EXPERIENCE.md` (`g` navigation, `j`/`k`, `x`, `e`, `/`, `?`), off inside text fields, each with a visible equivalent. Story 1.5.
UX-DR8: Import dialog with steps Fichier, Colonnes, Aperçu, preview tabs per group with counts, and a confirm button stating the count. Stories 2.1, 2.3.
UX-DR9: Bulk bar at the bottom of the transactions list with « Tout sélectionner (N résultats) ». Story 4.5.
UX-DR10: Warning banners for consent expiry, expired consent and stale sync, one action each. Story 10.5.
UX-DR11: Accessibility floor of `EXPERIENCE.md`: keyboard reach, visible focus, focus return, `aria-live` toasts, 24 px targets, WCAG 2.2 AA contrast. Every interface story.

### FR Coverage Map

FR1: Epic 1 - Create an account by hand
FR2: Epic 1 - Asset or liability classification
FR3: Epic 1 - Edit, deactivate, delete an account
FR4: Epic 1 - Exclude an account from reports
FR5: Epic 1 - Accounts grouped by type with balance
FR6: Epic 1 - Balance snapshots
FR7: Epic 1 - Daily balance history
FR8: Epic 1 - Balance history chart
FR9: Epic 7 - Loan account
FR10: Epic 7 - Investment (PEA) account
FR11: Epic 7 - Property and vehicle accounts
FR12: Epic 2 - Import a file into an account
FR13: Epic 2 - CSV column mapping saved per account
FR14: Epic 2 - QIF import
FR15: Epic 2 - OFX import
FR16: Epic 2 - Import preview
FR17: Epic 2 - Deduplication on re-import
FR18: Epic 2 - Import history and revert
FR19: Epic 2 - OFX ledger balance as snapshot
FR20: Epic 1 - Transaction list across accounts
FR21: Epic 1 (account, date, amount, text), Epic 4 (category, tag), Epic 5 (direction) - Transaction filters
FR22: Epic 1 - Create a transaction by hand
FR23: Epic 1 (date, label, amount, notes), Epic 4 (category, merchant, tags) - Edit a transaction
FR24: Epic 1 - Delete a transaction
FR25: Epic 1 - Exclude a transaction from reports
FR26: Epic 4 - Bulk edit
FR27: Epic 4 - Default categories
FR28: Epic 4 - Category management
FR29: Epic 4 - Merchants
FR30: Epic 4 - Tags
FR31: Epic 5 - Automatic transfer matching
FR32: Epic 5 - Manual match, undo, reject
FR33: Epic 5 (internal move, credit card payment), Epic 7 (loan payment, investment contribution) - Transfer kinds
FR34: Epic 6 - Net worth and history
FR35: Epic 6 - Monthly income and expenses by category
FR36: Epic 8 - Rule definition
FR37: Epic 8 - Rules on new and existing transactions
FR38: Epic 8 - Manual edits win over rules
FR39: Epic 8 - Categorisation provider extension point
FR40: Epic 9 - Recurring detection
FR41: Epic 9 - Recurring list and management
FR42: Epic 3 - First-launch administrator setup
FR43: Epic 3 (sessions), Epic 10 (sync secret) - Route protection
FR44: Epic 3 - User roles
FR45: Epic 3 - Password change and server-side reset
FR46: Epic 3 - Container image
FR47: Epic 3 - Health endpoint
FR48: Epic 10 - Bank consent flow
FR49: Epic 10 - Link bank accounts
FR50: Epic 10 - Sync from route and button
FR51: Epic 10 - Pending transactions
FR52: Epic 10 - File and API deduplication
FR53: Epic 10 - Consent expiry and renewal
FR54: Epic 10 - Disconnect a bank
FR55: Epic 10 - Connection status
FR56: Epic 10 - Bank balance as reference

## Epic List

### Epic 1: Track accounts and transactions by hand

The user creates depository and credit card accounts, records transactions and balance snapshots, and follows each account's balance over time. This epic creates the three packages and sets the data model every later epic builds on.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR20, FR21 (partial), FR22, FR23 (partial), FR24, FR25

### Epic 2: Import bank files

The user feeds an account from the CSV, QIF or OFX files their bank exports, without ever creating a duplicate, and can undo an import. This epic lays the import pipeline that the Enable Banking connector reuses in Epic 10.
**FRs covered:** FR12, FR13, FR14, FR15, FR16, FR17, FR18, FR19

### Epic 3: Protected access and deployment

The user runs Archant on a server of their own, behind a sign-in, from one container.
**FRs covered:** FR42, FR43 (partial), FR44, FR45, FR46, FR47

### Epic 4: Classify transactions

The user sorts transactions into categories, merchants and tags, one by one or in bulk, and filters on them.
**FRs covered:** FR21 (partial), FR23 (partial), FR26, FR27, FR28, FR29, FR30

### Epic 5: Internal transfers

Money moved between two of the user's accounts is recognised as a transfer and stops counting as both an expense and an income.
**FRs covered:** FR21 (partial), FR31, FR32, FR33 (partial)

### Epic 6: Dashboard

The user sees their net worth and its history, and where the month's money came from and went.
**FRs covered:** FR34, FR35

### Epic 7: Loans, investments and physical assets

The user adds a loan, a PEA, a property and a vehicle, so net worth reflects the whole household.
**FRs covered:** FR9, FR10, FR11, FR33 (partial)

### Epic 8: Rules

New transactions are categorised and cleaned up automatically. The stories below follow Sure's model as a placeholder: the project owner reworks this epic with their own approach before it starts.
**FRs covered:** FR36, FR37, FR38, FR39

### Epic 9: Recurring transactions

The user sees their subscriptions and regular bills, and when the next one is due.
**FRs covered:** FR40, FR41

### Epic 10: Enable Banking synchronisation

Accounts update themselves every day from the bank, and converge with the history already imported from files.
**FRs covered:** FR43 (partial), FR48, FR49, FR50, FR51, FR52, FR53, FR54, FR55, FR56

## Epic 1: Track accounts and transactions by hand

The user creates depository and credit card accounts, records transactions and balance snapshots, and follows each account's balance over time.

### Story 1.1: Create an account and see it listed

As the household's administrator,
I want to create a depository or credit card account with an opening balance,
So that I can start tracking my money in Archant.

**Requirements:** FR1, FR2, FR5

**Acceptance Criteria:**

**Given** a fresh clone
**When** I run `pnpm install --frozen-lockfile`, `pnpm data migrate:local`, `pnpm api start:dev` and `pnpm web start:dev`
**Then** the interface opens on an empty accounts page with a button to add an account
**And** `@archant/data`, `@archant/api` and `@archant/web` exist, each with only the dependencies this story uses, and the verification gate in `AGENTS.md` passes
**And** every visible string goes through the translation layer, with French as the only locale
**And** the brand layer of `DESIGN.md`, the sidebar with account groups and the `Money` component are in place, in light and dark mode (UX-DR1, UX-DR2, UX-DR3)

**Given** the account form
**When** I enter a name, choose a type (depository with subtype checking or savings, or credit card), keep the currency at EUR and enter an opening balance of `1 234,56` at a date
**Then** the account is stored with currency `EUR`, and an `opening_anchor` valuation of `123456` minor units is created at that date
**And** it appears on the accounts page under its type, with its balance formatted in French (`1 234,56 €`)

**Given** a depository account and a credit card account
**When** the accounts page loads
**Then** the depository is listed under assets and the credit card under liabilities, each group with its total

**Given** an empty name, an unparsable amount or an unknown currency code
**When** I submit the form
**Then** the API answers `400` with `{ "error": { "code": "VALIDATION_ERROR", ... } }` and the form shows the message next to the field

**Given** any request to an unknown API route
**When** it reaches the server
**Then** it answers `404` with `{ "error": { "code": "NOT_FOUND", ... } }`, and an unexpected throw answers `500` `INTERNAL_ERROR` without a stack trace

### Story 1.2: Record transactions by hand

As the household's administrator,
I want to add, edit and delete transactions in an account,
So that the account reflects what actually happened.

**Requirements:** FR22, FR23, FR24

**Acceptance Criteria:**

**Given** an account
**When** I add a transaction with a date, a label, an amount of `-42,90` and optional notes
**Then** it is stored as `-4290` minor units in the account's currency, a negative amount meaning money leaving the account
**And** it appears on the account page, most recent first

**Given** an existing transaction
**When** I change its date, label, amount or notes
**Then** the change is saved and the account's current balance reflects it immediately

**Given** an existing transaction
**When** I delete it and confirm
**Then** it disappears and the balance is updated

**Given** the transaction sheet with unsaved changes
**When** I press `Esc`
**Then** I am asked whether to discard them, and `⌘Enter` saves instead (UX-DR4)

**Given** a date before the account's opening date
**When** I submit the transaction
**Then** it is refused with `VALIDATION_ERROR`

**Given** a credit card account
**When** I record a purchase of `-30,00`
**Then** the card's outstanding balance, shown as a liability, grows by `30,00 €`

### Story 1.3: Daily balance history

As the household's administrator,
I want to see how an account's balance evolved day by day,
So that I understand where my money went over time.

**Requirements:** FR7, FR8

**Acceptance Criteria:**

**Given** an account with an opening balance and transactions
**When** any transaction of the account is created, edited or deleted
**Then** the daily balances from the earliest affected date to today, or to the latest entry date if later, are recomputed and stored in the same database transaction as the change

**Given** an account page
**When** I choose a period among 1 month, 3 months, 6 months, 1 year and all
**Then** a line chart shows the end-of-day balance for each day of the period

**Given** the balance chart
**When** I use it with the keyboard or a screen reader
**Then** a text summary sits above it and « Voir les données » shows the same series as a table (UX-DR5)

**Given** a day without transactions
**When** the history is computed
**Then** that day carries the previous day's balance

**Given** the balance computation
**When** its unit tests run
**Then** every branch is covered, including a transaction on the opening date, several transactions on one day, and a liability account

### Story 1.4: Balance snapshots

As the household's administrator,
I want to record the balance my bank shows at a date,
So that Archant's balance matches reality even if a transaction is missing.

**Requirements:** FR6, FR7

**Acceptance Criteria:**

**Given** an account
**When** I record a balance snapshot of `2 000,00` at a date
**Then** the end-of-day balance on that date is exactly `2 000,00 €`, and later days continue from it with the transactions that follow

**Given** a snapshot that disagrees with the computed balance
**When** the account page shows it
**Then** the gap between the computed and the recorded balance is displayed on that date

**Given** a second snapshot on the same date for the same account
**When** I save it
**Then** it replaces the first one

**Given** a snapshot
**When** I edit or delete it
**Then** the history is recomputed from that date

### Story 1.5: List and filter transactions across accounts

As the household's administrator,
I want one list of all transactions with filters,
So that I can find any operation quickly.

**Requirements:** FR20, FR21, FR25

**Acceptance Criteria:**

**Given** transactions in several accounts
**When** I open the transactions page
**Then** they are listed most recent first, 50 per page, each with date, label, account and amount

**Given** the list
**When** I filter by account, date range, amount range, or text contained in the label or notes, alone or combined
**Then** only matching transactions are shown, and the filters are kept in the URL so a reload keeps them

**Given** a transaction
**When** I mark it as excluded from reports
**Then** it stays in the list with a visual marker and keeps affecting its account balance

**Given** any page
**When** I press `⌘K` or `Ctrl+K`
**Then** the command palette opens with Aller à, Actions and Comptes, and in the list `j`/`k`, `x`, `e` and `/` work as described in `EXPERIENCE.md`, `?` listing them all (UX-DR6, UX-DR7)

**Given** 50,000 transactions in a local SQLite file
**When** the first page loads with no filter
**Then** the API answers in under 300 ms

### Story 1.6: Manage accounts

As the household's administrator,
I want to edit, deactivate, exclude or delete an account,
So that the list stays accurate as my situation changes.

**Requirements:** FR3, FR4

**Acceptance Criteria:**

**Given** an account
**When** I change its name or subtype
**Then** the change is saved

**Given** an account
**When** I deactivate it
**Then** it is hidden from the accounts page and the transaction filters, its history is kept, and I can show inactive accounts and reactivate it

**Given** an account
**When** I exclude it from reports
**Then** it is flagged, still listed, and a later net worth computation leaves it out

**Given** an account with transactions
**When** I delete it
**Then** a confirmation states how many transactions will be deleted, and confirming deletes the account, its transactions, snapshots and daily balances

## Epic 2: Import bank files

The user feeds an account from the CSV, QIF or OFX files their bank exports, without ever creating a duplicate, and can undo an import.

### Story 2.1: Import an OFX file with preview

As the household's administrator,
I want to import the OFX file exported by my bank into an account,
So that I don't type transactions by hand.

**Requirements:** FR12, FR15, FR16, FR17

**Acceptance Criteria:**

**Given** an account and an OFX 1.x (SGML) or 2.x (XML) file
**When** I upload it from the account page
**Then** the file is parsed by the OFX source behind the connector interface decided in the architecture, and each transaction becomes a normalised transaction with its `FITID`, posting date, amount in minor units, and a label built from `NAME` and `MEMO`

**Given** a parsed file
**When** the preview opens
**Then** it groups transactions to create, already present (same key in this account), matched to an existing entry from another source, possible duplicates, and rejected lines with their reason, and nothing is written yet

**Given** the preview
**When** I confirm
**Then** new transactions are written, the import recorded at preview time is marked confirmed with file name, format, date and counts, and the balance history is recomputed, all in one database transaction

**Given** the same file imported a second time
**When** the preview opens
**Then** every transaction is listed as already present, and confirming creates nothing

**Given** lines dated before the account's opening date
**When** the preview opens
**Then** they are rejected with `BEFORE_OPENING_DATE`, and the preview offers to move the opening date

**Given** a preview left open while the account changed
**When** I confirm
**Then** the API answers `409` `IMPORT_PREVIEW_STALE` and shows the new preview

**Given** a file that is not valid OFX, or larger than 5 MB
**When** I upload it
**Then** the API answers `400` with `INVALID_IMPORT_FILE` and writes nothing

**Given** fixtures from at least two French banks, anonymised, committed under the importer's tests
**When** the tests run
**Then** both parse to the expected transactions

### Story 2.2: Use the OFX ledger balance

As the household's administrator,
I want the balance in my OFX file to set the account balance,
So that Archant shows the same balance as my bank.

**Requirements:** FR19

**Acceptance Criteria:**

**Given** an OFX file with `LEDGERBAL`
**When** I confirm its import
**Then** a reconciliation snapshot tied to the import is recorded at the `DTASOF` date, unless I entered a snapshot on that date by hand, in which case mine stays and the preview shows the gap

**Given** a credit card OFX file whose ledger balance is negative
**When** it is imported
**Then** the card shows the corresponding positive outstanding debt

**Given** an OFX file without `LEDGERBAL`
**When** it is imported
**Then** no snapshot is created

### Story 2.3: Import a CSV file with a saved mapping

As the household's administrator,
I want to map the columns of my bank's CSV once,
So that later imports of the same account take one click.

**Requirements:** FR12, FR13, FR16, FR17, FR23

**Acceptance Criteria:**

**Given** a CSV file
**When** I upload it into an account for the first time
**Then** I see its first rows and map columns to date, label, and either a signed amount or separate debit and credit columns, plus optional notes

**Given** the mapping screen
**When** I choose the delimiter, date format (`DD/MM/YYYY` by default), decimal separator (comma by default) and sign convention
**Then** the preview updates, and lines that fail to parse are listed as rejected with their line number and reason

**Given** a confirmed CSV import
**When** I import another file into the same account
**Then** the saved mapping is applied and I go straight to the preview, with a way to change the mapping

**Given** CSV lines without a source id
**When** they are compared with existing transactions
**Then** the key is a fingerprint of date, amount, normalised label (lower case, accents and repeated spaces removed) and occurrence index within the file, unique per account and source, so two identical lines on the same day are both kept on first import and both recognised on re-import

**Given** an imported transaction whose label or amount I edited since
**When** I import a file containing it again
**Then** it is still recognised as present, because the fingerprint is stored at import time and never recomputed

**Given** a 5,000-line file
**When** I confirm its import
**Then** it completes in under 10 seconds

**Given** a file encoded in Windows-1252 or UTF-8 with or without BOM
**When** it is parsed
**Then** accented labels come out correctly

### Story 2.4: Import a QIF file

As the household's administrator,
I want to import a QIF file,
So that I can use banks or older tools that only export QIF.

**Requirements:** FR12, FR14

**Acceptance Criteria:**

**Given** a QIF file of type `Bank` or `CCard`
**When** I upload it
**Then** each record becomes a normalised transaction from its `D` (date), `T` or `U` (amount), `P` (payee), `M` (memo) and `N` (number) fields, and goes through the same preview and deduplication as a CSV line

**Given** a QIF file with an ambiguous date format
**When** the preview opens
**Then** I can choose between day-first and month-first, day-first being the default

**Given** a QIF file of an unsupported type such as `Invst`
**When** I upload it
**Then** it is refused with `INVALID_IMPORT_FILE` and a message naming the type

### Story 2.5: Import history and revert

As the household's administrator,
I want to see my past imports and undo one,
So that a wrong file never pollutes my history for good.

**Requirements:** FR18

**Acceptance Criteria:**

**Given** past imports
**When** I open an account's import history
**Then** each import shows its file name, format, date, and counts of created, skipped and rejected lines

**Given** an import
**When** I revert it and confirm
**Then** the keys it wrote are deleted, a transaction it created is deleted unless another source, such as the bank, has confirmed it since, a snapshot it created is deleted, and the balance history is recomputed

**Given** a reverted import
**When** I import the same file again
**Then** its transactions are created again

## Epic 3: Protected access and deployment

The user runs Archant on a server of their own, behind a sign-in, from one container.

### Story 3.1: First-launch setup and sign-in

As the household's administrator,
I want to create my account on first launch and sign in afterwards,
So that nobody else can read my bank data.

**Requirements:** FR42, FR43, FR44

**Acceptance Criteria:**

**Given** a database with no user
**When** I open the interface
**Then** I land on a setup page that creates the administrator with an email and a password through Better Auth, with role `admin`

**Given** a user already exists
**When** anyone calls the setup endpoint or opens the setup page
**Then** it answers `403` `FORBIDDEN` and the page redirects to sign-in

**Given** no valid session
**When** any API route other than health, sign-in and setup is called
**Then** it answers `401` `UNAUTHORIZED`, and the interface redirects to the sign-in page

**Given** the user table
**When** its schema is inspected
**Then** `role` is a text column checked against `USER_ROLES` in `@archant/data`, not writable through Better Auth's user update endpoint, so adding `viewer` later needs no data migration

**Given** repeated failed sign-ins
**When** Better Auth's rate limit is reached
**Then** further attempts are refused for the configured window

### Story 3.2: Sign out, change password, reset from the server

As the household's administrator,
I want to sign out, change my password, and recover access without email,
So that I stay in control of my instance.

**Requirements:** FR43, FR45

**Acceptance Criteria:**

**Given** a signed-in user
**When** I sign out
**Then** the session is revoked and the next API call answers `401`

**Given** a signed-in user
**When** I change my password with the current one
**Then** it is updated and other sessions are revoked

**Given** shell access to the server
**When** I run `pnpm api reset-password <email>`
**Then** it prompts for a new password, updates it, revokes all sessions, and never prints the password

### Story 3.3: Run Archant from one container

As the household's administrator,
I want one Docker image to run the interface and the API,
So that I can host Archant anywhere a container runs.

**Requirements:** FR46, FR47

**Acceptance Criteria:**

**Given** the repository
**When** I run `docker compose up`
**Then** one container serves the built interface and the API on the same port, under `/` and `/api` respectively, against a SQLite file on a volume

**Given** a container start
**When** migrations are pending
**Then** they are applied before the server listens, with the runtime driver, without `drizzle-kit` in the image

**Given** a running container
**When** `GET /api/health` is called
**Then** it answers `200` with `{ "data": { "status": "ok" } }` after a query to the database, and `503` if the database does not answer

**Given** an unknown `/api/...` route
**When** it is called
**Then** it answers the `NOT_FOUND` JSON, not the interface page

**Given** `docker compose stop`
**When** the container receives SIGTERM
**Then** it exits within one second

**Given** a pull request
**When** CI runs
**Then** it builds the image and checks the health endpoint of the running container

## Epic 4: Classify transactions

The user sorts transactions into categories, merchants and tags, one by one or in bulk, and filters on them.

### Story 4.1: Default categories and category management

As the household's administrator,
I want a ready-made set of categories that I can adapt,
So that I can classify spending from day one.

**Requirements:** FR27, FR28

**Acceptance Criteria:**

**Given** a fresh instance
**When** the categories page opens for the first time
**Then** a default set exists, adapted from Sure's (income, groceries, restaurants, transport, housing, utilities, subscriptions, insurance, health, taxes, fees, leisure, travel, gifts, savings and investments), each with a colour, an icon, and a kind of income or expense, with names in French

**Given** the categories page
**When** I create, rename, recolour, or move a category under a parent
**Then** the change is saved, and a category can have at most one level of parent

**Given** a category used by transactions
**When** I delete it
**Then** I choose another category to receive its transactions, or leave them uncategorised

**Given** two categories
**When** I merge one into the other
**Then** all transactions of the first move to the second and the first is deleted

### Story 4.2: Categorise transactions and filter by category

As the household's administrator,
I want to set a category on a transaction and filter by it,
So that I know what I spend on.

**Requirements:** FR21, FR23

**Acceptance Criteria:**

**Given** a transaction
**When** I pick a category from a searchable list in the transactions page
**Then** it is saved without leaving the page

**Given** the transactions list
**When** I filter by one or several categories, or by "uncategorised"
**Then** only those transactions are shown

**Given** a transaction whose category was set by hand
**When** it is saved
**Then** the category is marked as set by the user, for the rules of Epic 8 to respect

### Story 4.3: Merchants

As the household's administrator,
I want to attach a merchant to transactions,
So that "CB CARREFOUR 1234" and "CARREFOUR MARKET" read as one shop.

**Requirements:** FR21, FR23, FR29

**Acceptance Criteria:**

**Given** a transaction
**When** I set its merchant by picking an existing one or typing a new name
**Then** the merchant is created if needed and linked

**Given** the merchants page
**When** I rename, merge or delete a merchant
**Then** merging moves its transactions to the target, and deleting unlinks them

**Given** the transactions list
**When** I filter by merchant
**Then** only its transactions are shown

### Story 4.4: Tags

As the household's administrator,
I want to put tags on transactions,
So that I can follow a trip or a project across categories.

**Requirements:** FR21, FR23, FR30

**Acceptance Criteria:**

**Given** a transaction
**When** I add several tags, creating them on the fly if needed
**Then** they are saved and shown on the row

**Given** the tags page
**When** I rename or delete a tag
**Then** the change applies to all its transactions

**Given** the transactions list
**When** I filter by a tag
**Then** only tagged transactions are shown

### Story 4.5: Bulk edit

As the household's administrator,
I want to change many transactions at once,
So that cleaning up an import takes seconds.

**Requirements:** FR26

**Acceptance Criteria:**

**Given** the transactions list
**When** I select rows, or all rows matching the current filters
**Then** a bar shows the selection count and the bulk actions

**Given** a selection
**When** I set a category, a merchant, add tags, exclude from reports, or delete
**Then** the change applies to every selected transaction in one database transaction, and balances are recomputed after a delete

## Epic 5: Internal transfers

Money moved between two of the user's accounts is recognised as a transfer and stops counting as both an expense and an income.

### Story 5.1: Mark two transactions as a transfer

As the household's administrator,
I want to link the outflow and the inflow of a transfer between my accounts,
So that it no longer looks like spending.

**Requirements:** FR21, FR32, FR33

**Acceptance Criteria:**

**Given** a transaction
**When** I choose "match as transfer"
**Then** I see candidates in other accounts with the opposite amount within 4 days, and can pick one

**Given** a matched pair
**When** it is saved
**Then** both transactions show the other account, and the transfer kind is set to credit card payment if the inflow is on a credit card, internal move otherwise

**Given** a matched pair
**When** I undo the match
**Then** both transactions become standard again

**Given** the transactions list
**When** I filter by direction income, expense or transfer
**Then** internal moves and credit card payments appear under transfer, using the same `direction` function as the dashboard

### Story 5.2: Automatic transfer matching

As the household's administrator,
I want transfers found automatically after an import,
So that I don't match them by hand.

**Requirements:** FR31, FR32

**Acceptance Criteria:**

**Given** new transactions from an import or a manual entry
**When** they are written
**Then** each unmatched transaction with exactly one candidate (opposite amount, other account, same currency, within 4 days, not already matched, not rejected) is matched

**Given** a transaction with two or more candidates
**When** matching runs
**Then** nothing is matched and the transaction shows a suggestion to match by hand

**Given** an automatic match
**When** I reject it
**Then** it is undone and that pair is never proposed again

**Given** the matching logic
**When** its tests run
**Then** every branch is covered, including a candidate at exactly 4 days and one at 5

## Epic 6: Dashboard

The user sees their net worth and its history, and where the month's money came from and went.

### Story 6.1: Net worth and its history

As the household's administrator,
I want to see my net worth and how it moved,
So that I know where I stand.

**Requirements:** FR34

**Acceptance Criteria:**

**Given** active accounts not excluded from reports
**When** the dashboard opens
**Then** it shows net worth as assets minus liabilities, with both totals, from the daily balances

**Given** the dashboard
**When** I pick 1 month, 3 months, 6 months, 1 year or all
**Then** a chart shows daily net worth over the period, with the change in amount and percentage

**Given** an account in another currency than the reporting currency (EUR)
**When** totals are computed
**Then** it is left out, and a notice names it

### Story 6.2: Monthly income and expenses by category

As the household's administrator,
I want to see the month's income and expenses by category,
So that I see where my money goes.

**Requirements:** FR35

**Acceptance Criteria:**

**Given** a month
**When** the dashboard shows its cash flow
**Then** income and expense totals exclude excluded transactions, internal moves and credit card payments, and exclude accounts excluded from reports

**Given** the same month
**When** the breakdown is shown
**Then** each category, with sub-categories rolled up into their parent, shows its total and share, and uncategorised transactions have their own line

**Given** a category line
**When** I click it
**Then** the transactions page opens filtered on that category and month

## Epic 7: Loans, investments and physical assets

The user adds a loan, a PEA, a property and a vehicle, so net worth reflects the whole household.

### Story 7.1: Loan accounts

As the household's administrator,
I want to track my mortgage or consumer loan,
So that my debt counts in my net worth.

**Requirements:** FR9, FR33

**Acceptance Criteria:**

**Given** the account form
**When** I create a loan with its outstanding balance, and optionally its original amount, rate and end date
**Then** it is listed under liabilities

**Given** a transfer from a depository to a loan account
**When** it is matched
**Then** its kind is loan payment, it lowers the outstanding balance, its outflow counts as an expense in the monthly cash flow, and its inflow on the loan account counts in neither total

**Given** a loan
**When** I record a balance snapshot from my lender's statement
**Then** the outstanding balance follows it

### Story 7.2: Investment accounts (PEA)

As the household's administrator,
I want to track my PEA by its value,
So that my investments count in my net worth without entering each trade.

**Requirements:** FR10, FR33

**Acceptance Criteria:**

**Given** the account form
**When** I create an investment account with subtype PEA, assurance-vie, compte-titres or other
**Then** it is listed under assets

**Given** an investment account
**When** I record its value at a date
**Then** the balance history follows the snapshots

**Given** a transfer from a depository to an investment account
**When** it is matched
**Then** its kind is investment contribution, its outflow counts as an expense in the monthly cash flow, and its inflow on the investment account counts in neither total

### Story 7.3: Property and vehicle accounts

As the household's administrator,
I want to add my home and my car with their estimated value,
So that net worth includes them.

**Requirements:** FR11

**Acceptance Criteria:**

**Given** the account form
**When** I create a property or a vehicle with a value at a date
**Then** it is listed under assets

**Given** a property or a vehicle
**When** I record a new estimated value
**Then** the history follows it, with no transaction needed

## Epic 8: Rules

New transactions are categorised and cleaned up automatically. Provisional stories modelled on Sure; the project owner reworks them before the epic starts.

### Story 8.1: Create a categorisation rule

As the household's administrator,
I want a rule that sets a category when a transaction matches conditions,
So that recurring shops are categorised without my help.

**Requirements:** FR36, FR37, FR38

**Acceptance Criteria:**

**Given** the rules page
**When** I create a rule with one or more conditions on label (contains, equals), amount (greater, less, equal), or account, combined with all or any, and a "set category" action
**Then** the rule is saved and enabled

**Given** enabled rules
**When** new transactions are written, whatever their source
**Then** each rule applies to the matching ones, in the order shown on the rules page

**Given** a transaction whose category was set by hand
**When** a rule matches it
**Then** the category is left unchanged

### Story 8.2: More rule conditions and actions

As the household's administrator,
I want rules to set merchant, tags or label, exclude a transaction or mark it as a transfer,
So that one rule cleans up a transaction completely.

**Requirements:** FR36, FR38

**Acceptance Criteria:**

**Given** the rule form
**When** I add conditions on merchant, category, notes or tag, and actions set merchant, add tags, rename, exclude, or mark as transfer
**Then** each is applied as described, and fields set by hand are left unchanged

### Story 8.3: Apply rules to existing transactions

As the household's administrator,
I want to run a rule on past transactions after a preview,
So that a new rule cleans up my history too.

**Requirements:** FR37

**Acceptance Criteria:**

**Given** a rule
**When** I ask to apply it to existing transactions
**Then** I see how many transactions would change and a sample of them, before anything is written

**Given** the preview
**When** I confirm
**Then** the changes are written in one database transaction and the run is recorded with its count

### Story 8.4: Categorisation provider extension point

As a contributor,
I want an interface for categorisation providers,
So that an AI model can propose categories without touching the rules engine.

**Requirements:** FR39

**Acceptance Criteria:**

**Given** the rules engine
**When** a provider is registered through the interface
**Then** it receives uncategorised transactions and the category list, and its proposals are applied after rules, never over a category set by hand or by a rule

**Given** no provider configured
**When** transactions are written
**Then** behaviour is unchanged

**Given** the extension point
**When** its tests run
**Then** they use a fake provider and reach no network

## Epic 9: Recurring transactions

The user sees their subscriptions and regular bills, and when the next one is due.

### Story 9.1: Detect recurring transactions

As the household's administrator,
I want Archant to find my subscriptions and regular bills,
So that I don't list them by hand.

**Requirements:** FR40

**Acceptance Criteria:**

**Given** the last three months of transactions, transfers excluded
**When** detection runs after an import or on demand
**Then** transactions grouped by account, merchant or else normalised label, and same amount, form a recurring item when there are at least two, the last within 45 days, on days of the month within 5 days of each other, as in Sure

**Given** a recurring item
**When** it is stored
**Then** it carries the expected day of month, amount, last date and occurrence count

**Given** the detection logic
**When** its tests run
**Then** every branch is covered, including month-end days such as the 31st

### Story 9.2: Recurring transactions page

As the household's administrator,
I want a page listing recurring transactions with their next date,
So that I see what is coming.

**Requirements:** FR41

**Acceptance Criteria:**

**Given** recurring items
**When** I open the page
**Then** each shows its merchant or label, amount, account and next expected date, sorted by that date

**Given** a detected item
**When** I confirm it
**Then** it is marked confirmed and is never marked inactive by detection alone, only by me

**Given** a detected item
**When** I dismiss it
**Then** it is hidden and never detected again

**Given** the page
**When** I add a recurring item by hand from a transaction
**Then** it is listed and kept by later detections

**Given** an item with no occurrence for more than two expected periods
**When** detection runs
**Then** it is marked inactive

## Epic 10: Enable Banking synchronisation

Accounts update themselves every day from the bank, and converge with the history already imported from files.

### Story 10.1: Connect a bank

As the household's administrator,
I want to connect my bank through Enable Banking,
So that Archant can read my accounts.

**Requirements:** FR48

**Acceptance Criteria:**

**Given** `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY` set
**When** I open "connect a bank"
**Then** I choose a country (France by default) and a bank from the Enable Banking list

**Given** a chosen bank
**When** I start the connection
**Then** I am sent to the bank's consent page and come back through the callback, which checks the `state` parameter and stores the session id and its expiry, encrypted at rest

**Given** the variables are missing
**When** I open the page
**Then** it explains which variables to set, and the rest of the application keeps working

**Given** the Enable Banking client
**When** it receives a response
**Then** the response is parsed by a Zod schema, and tests use recorded fixtures with no network access

### Story 10.2: Link bank accounts

As the household's administrator,
I want to choose which bank accounts to follow and where they go,
So that a bank account continues an account I already fed with files.

**Requirements:** FR49, FR56

**Acceptance Criteria:**

**Given** a new connection
**When** its accounts are listed
**Then** each shows its name, masked IBAN and currency, and I choose to skip it, create a new account, or link it to an existing account of a compatible type

**Given** a linked account
**When** its balance comes from the bank
**Then** that balance is the reference, and the history is computed backward from it

### Story 10.3: Sync transactions and balances

As the household's administrator,
I want accounts to update from the bank daily and on demand,
So that I never import a file again.

**Requirements:** FR43, FR50, FR52, FR55

**Acceptance Criteria:**

**Given** linked accounts
**When** `POST /api/sync` is called with the `SYNC_SECRET` bearer token, or I press "sync", which calls `POST /api/bank-connections/:id/sync` with my session
**Then** balances and transactions since the last successful sync minus 7 days of overlap are fetched, go through the import pipeline, and are deduplicated on `entry_reference`, never on `transaction_id`

**Given** `POST /api/sync` without the secret or with a wrong one
**When** it is called
**Then** it answers `401` and does nothing

**Given** an account already fed by files
**When** a synced transaction has no provider match
**Then** it is attached to the existing transaction of the same amount at the nearest date within 3 days that carries no Enable Banking key; with no candidate it is created, and with a tie it is created and flagged as a possible duplicate that I can merge or dismiss

**Given** a failure on one account
**When** sync runs
**Then** that account's writes are rolled back, others are synced, and the connection records the error without an amount, IBAN or token in the logs

**Given** a connection
**When** its page shows
**Then** it displays the last successful sync time and the last error

### Story 10.4: Pending transactions

As the household's administrator,
I want to see card payments not yet booked,
So that my balance is current, without duplicates later.

**Requirements:** FR51

**Acceptance Criteria:**

**Given** pending transactions returned by the bank
**When** they are synced
**Then** they are stored as pending, shown with a marker, and left out of monthly cash flow

**Given** a pending transaction
**When** its booked version arrives, with the same `entry_reference` (the amount may differ), or else with the same amount within 5 days
**Then** the pending entry is updated in place, keeping its id, links and the fields I set by hand

**Given** a pending transaction absent from two consecutive syncs and not booked
**When** sync runs
**Then** it is deleted

### Story 10.5: Consent renewal and disconnection

As the household's administrator,
I want to be warned before my bank consent expires and to renew or remove it,
So that sync never stops silently.

**Requirements:** FR53, FR54

**Acceptance Criteria:**

**Given** a consent expiring within 14 days
**When** I open the interface
**Then** a banner names the bank and the date, with a button to renew

**Given** renewal
**When** I complete the bank's consent again
**Then** the connection keeps its linked accounts and history

**Given** an expired consent
**When** sync runs
**Then** that connection is skipped with the status "consent expired", and no data is deleted

**Given** a last successful sync older than 48 hours
**When** I open the interface
**Then** a banner says sync has stopped, so a broken cron never goes unnoticed

**Given** a connection
**When** I disconnect it
**Then** the session is revoked at Enable Banking, stored secrets are deleted, and its accounts stay as manual accounts, and their balance history is unchanged
