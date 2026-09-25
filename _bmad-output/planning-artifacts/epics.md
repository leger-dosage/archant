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
  - _bmad-output/implementation-artifacts/deferred-work.md
  - docs/sure-parity.md
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

FR36: The user can define rules made of conditions on transaction fields and actions that set category, merchant, tags or label, exclude the transaction, or mark it as a transfer. The rule model follows Sure's, with the departures Epic 8 names.
FR37: Rules run on every new transaction, whatever its source, and the user can run them on existing transactions after seeing how many would change.
FR38: A field the user set by hand is never overwritten by a rule.
FR39: Withdrawn. A categorisation provider interface with no provider behind it would be code nothing calls; AI categorisation comes back later as a real action.

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
- Every story ships automated tests for its acceptance criteria: Playwright end-to-end tests for what the interface shows, Vitest for domain, services and routes. A story is not done while one of its criteria is only checked by hand. Story 1.7 creates the Playwright harness and covers Stories 1.1 to 1.4; every story after it adds its own tests.
- The architecture spine, `architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md`, binds every story; its `AD-n` rules win over any wording here.
- Ordering constraints outside this document: `bmad-architecture` settles the connector interface and the data model before Story 2.1, and `bmad-ux` produces `DESIGN.md` and `EXPERIENCE.md` before Story 1.1, the first interface story.

### UX Design Requirements

Source: `ux-designs/ux-archant-2026-09-21/DESIGN.md` and `EXPERIENCE.md`. Both bind every interface story; they win over any wording here.

UX-DR1: The shadcn/ui neutral base with the brand layer of `DESIGN.md` (colours for light and dark mode, Geist and Geist Mono, radii 6/8/10/12, Sure's grey page with white cards and ring shadow, tinted icons, category pills, the arch logo), dark mode following the system with a manual override. Story 1.1; revised by Epic 12, Stories 12.1 to 12.4.
UX-DR2: One `Money` component renders every amount: `fr-FR`, tabular figures, income green with a plus, expenses in the foreground colour with a true minus, muted for pending and excluded with a badge or icon. Story 1.1.
UX-DR3: Sidebar with navigation entries and the accounts grouped under Actifs and Passifs with totals and balances, collapsing below 1024 px and becoming a sheet below 768 px. Stories 1.1, 1.6.
UX-DR4: Transaction sheet with save on `⌘Enter`, `Esc` to close, a prompt only when changes are unsaved, and the transaction's source shown. Story 1.2.
UX-DR5: Charts with a text summary and a « Voir les données » table alternative, keyboard cursor, no animation under reduced motion. Stories 1.3, 6.1, 6.2.
UX-DR6: Transactions list grouped by day headers, filters as removable chips kept in the URL, result count and signed total of the filtered rows. Story 1.5.
UX-DR7: Command palette on `⌘K` / `Ctrl+K` and the keyboard shortcuts of `EXPERIENCE.md` (`g` navigation, `j`/`k`, `x`, `e`, `/`, `?`), off inside text fields, each with a visible equivalent. Story 1.8; the `x` selection and its `Shift` extension, Story 4.5.
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
FR39: Withdrawn
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

Epic 11 adds no requirement. It fixes shipped behaviour that breaks FR1, FR18, FR31, FR33, FR35, FR40, FR41, FR50, FR51, FR52, FR56 and NFR8, and acts on the owner's manual QA: FR3, FR29, FR30, FR36, FR48, NFR4 and NFR12 get easier to reach, and UX-DR7 is withdrawn. Epic 12 revises UX-DR1.

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

New transactions are categorised and cleaned up automatically, following Sure's rule model.
**FRs covered:** FR36, FR37, FR38

### Epic 9: Recurring transactions

The user sees their subscriptions and regular bills, and when the next one is due.
**FRs covered:** FR40, FR41

### Epic 10: Enable Banking synchronisation

Accounts update themselves every day from the bank, and converge with the history already imported from files.
**FRs covered:** FR43 (partial), FR48, FR49, FR50, FR51, FR52, FR53, FR54, FR55, FR56

### Epic 11: Reliability and first-use fixes

Every figure Archant shows can be trusted with real bank data, and a first-time user gets from `git clone` to a connected bank without reading code: the bugs found after Epic 10 and the findings of the owner's manual QA are fixed before a real bank is connected.
**FRs covered:** none new; hardens FR1, FR18, FR31, FR33, FR35, FR40, FR41, FR50, FR51, FR52, FR56; eases FR3, FR29, FR30, FR36, FR48

### Epic 12: A warmer interface, close to Sure

Archant stops looking austere: Sure's grey page and white cards, colour through tinted icons and category pills, a donut and a trend-coloured net worth chart, a balance sheet by account type, a logo and a favicon, as `DESIGN.md` now specifies.
**FRs covered:** none new; revises UX-DR1

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

**Given** a date on or before the account's opening date (the opening balance is an end-of-day balance, as in Sure)
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
**Then** every branch is covered, including the opening date carrying exactly the opening balance, several transactions on one day, and a liability account

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
**Then** only matching transactions are shown, with the result count and the signed total, and the filters are kept in the URL as removable chips so a reload keeps them (UX-DR6)

**Given** a transaction
**When** I mark it as excluded from reports
**Then** it stays in the list with a visual marker and keeps affecting its account balance

**Given** 50,000 transactions in a local SQLite file
**When** the first page loads with no filter
**Then** the API answers in under 300 ms

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 1.7: End-to-end tests for the interface

As the household's administrator,
I want every screen shipped so far checked by automated browser tests,
So that a later story cannot break accounts, transactions, the chart or snapshots unnoticed.

**Requirements:** NFR11, NFR13

This story runs before Story 1.5, which needs its harness.

**Acceptance Criteria:**

**Given** a fresh clone
**When** I run `pnpm test:e2e`
**Then** Playwright starts the API on a new temporary SQLite file and the Vite server, never reuses a running server, runs in Chromium, and fails on `test.only` in CI
**And** any request leaving `localhost` fails the test and names the URL

**Given** the acceptance criteria of Stories 1.1 to 1.4
**When** the end-to-end suite runs
**Then** each one has a test through the interface: creating an account and seeing it in its group and the sidebar; creating, editing and deleting a transaction with the header balance following; the chart periods, the `1M` fallback on an unknown `period` and `period` kept across pagination; the Soldes tab opened from `?tab=snapshots`, recording, replacing, editing and deleting a snapshot with its gap

**Given** `unwrap` in `packages/web/src/lib/api.ts`
**When** the web unit tests run
**Then** a 400 with fields, an unknown code, the proxy's HTML page and a rejected fetch are covered

**Given** a pull request
**When** GitHub Actions runs
**Then** it runs the verification gate of `AGENTS.md` and `pnpm test:e2e`, and `AGENTS.md` lists `pnpm test:e2e` in that gate

### Story 1.8: Command palette and keyboard shortcuts

As the household's administrator,
I want to reach every page and action from the keyboard,
So that I can work through my transactions without the mouse.

**Requirements:** NFR13

**Acceptance Criteria:**

**Given** any page
**When** I press `⌘K` or `Ctrl+K`
**Then** the command palette opens with Aller à, Actions and Comptes, `Enter` runs the highlighted item, and `Esc` closes it (UX-DR7)

**Given** any page outside a text field
**When** I type `g c` or `g o`
**Then** the accounts page or the transactions page opens

**Given** a transactions list
**When** I press `j`/`k` or the arrows, `e` or `Enter`, `/`
**Then** focus moves between rows, the focused transaction's sheet opens, and the search filter takes focus

**Given** any page
**When** I press `?`
**Then** a dialog lists every shortcut, and each shortcut also has a visible equivalent whose tooltip shows it

**Given** focus inside a text field
**When** I type a single letter
**Then** no shortcut fires

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** lines dated on or before the account's opening date
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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 4.5: Bulk edit

As the household's administrator,
I want to change many transactions at once,
So that cleaning up an import takes seconds.

**Requirements:** FR26

**Acceptance Criteria:**

**Given** the transactions list
**When** I select rows with their checkbox or `x`, extend the selection with `Shift`, or select all rows matching the current filters
**Then** a bar shows the selection count and the bulk actions, and `Esc` clears the selection (UX-DR7, UX-DR9)

**Given** a selection
**When** I set a category, a merchant, add tags, exclude from reports, or delete
**Then** the change applies to every selected transaction in one database transaction, and balances are recomputed after a delete

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 8: Rules

New transactions are categorised and cleaned up automatically. The rule model follows Sure's `Rule`, `Rule::Condition` and `Rule::Action` (`app/models/rule*.rb`, `app/models/rule/`); each story names its departures from Sure, and AD-4 and AD-10 still bind. Out of this epic: AI actions, the email notification action, Sure's investment activity label and provider-details condition, the prompt to create a rule after categorising a transaction, the quick-categorise wizard, deleting every rule at once, and rule import and export.

### Story 8.1: Create a categorisation rule

As the household's administrator,
I want a rule that sets a category when a transaction matches conditions,
So that recurring shops are categorised without my help.

**Requirements:** FR36, FR37, FR38

**Acceptance Criteria:**

**Given** the « Règles » page at `/rules`, reached from the sidebar or `g u`
**When** I create a rule
**Then** I give it an optional name, one or more conditions, a « Catégorie » action and an optional start date « À partir du »; without a start date it applies to transactions of any date, as Sure's `effective_date`

**Given** the rule form
**When** I add a condition
**Then** it is a field, an operator and a value: « Libellé » with « contient » (substring, case ignored) or « est égal à » (exact, case kept), both after trimming and collapsing runs of spaces on each side; « Montant » with `>`, `≥`, `<`, `≤`, `=` or `≠`, entered as a positive amount and compared with the transaction's absolute amount; « Compte » with « est »

**Given** several conditions
**When** a transaction is tested
**Then** it matches only when every top-level condition does; a condition group, one level deep, matches when all or any of its conditions do, as the group chooses; a rule without conditions matches every transaction, as in Sure

**Given** the rule form
**When** I save a rule without an action, with two actions of the same kind, with a group inside a group, or with a condition missing its value
**Then** it is refused and the faulty field is shown

**Given** enabled rules
**When** transactions are created, by hand or by an import
**Then** at step 5 of the ingestion pipeline each enabled rule applies to the new transactions it matches, in the order the rules were created, each rule seeing what the earlier ones wrote; the category is written with `origin: "rule"`, which records `category_origin` `rule` and locks nothing, so a later rule may overwrite it, as in Sure

**Given** a transaction whose category the user set
**When** a rule matches it
**Then** its category is left unchanged

**Given** the rules page
**When** I open it
**Then** rules are listed in the order they apply, each with its name or, without one, a summary built from its first condition and first action, such as « Si Libellé contient CARREFOUR, alors Catégorie Courses » followed by « et 2 autres conditions »; a switch enables or disables each rule, and its menu offers « Modifier » and « Supprimer », which asks for confirmation; a new rule is enabled, and disabling a rule leaves what it wrote in place

**Given** a screen narrower than 768 px
**When** I open the rules page
**Then** it shows « Disponible sur ordinateur », as `EXPERIENCE.md` specifies

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

Departures from Sure: rules apply in creation order, where Sure runs them in no set order, and the list shows that order rather than Sure's sort by name. A new rule is enabled at once, where Sure keeps it disabled until the confirmation that Story 8.3 brings. At ingestion a rule reaches the new transactions only, where Sure re-runs every rule over the whole history after each sync; Story 8.3 covers the history.

### Story 8.2: More rule conditions and actions

As the household's administrator,
I want rules to set merchant, tags or label, exclude a transaction or mark it as a transfer,
So that one rule cleans up a transaction completely.

**Requirements:** FR36, FR38

**Acceptance Criteria:**

**Given** the rule form
**When** I add a condition
**Then** I can also choose « Marchand », « Catégorie » or « Étiquette » with « est » or « est vide »; « Notes » with « contient », « est égal à » or « est vide »; and « Type » with « est » « Revenu », « Dépense » or « Virement »
**And** « Catégorie » matches that category only, not its subcategories; « Étiquette est » matches a transaction carrying that tag, « Étiquette est vide » one carrying none; a transaction in a transfer is a « Virement », any other is a « Revenu » or a « Dépense » by the sign of its amount, so at ingestion, before transfer matching, no new transaction is yet a « Virement »

**Given** the rule form
**When** I add an action
**Then** I can also choose « Marchand », which sets the merchant; « Ajouter une étiquette », which adds one tag and keeps the others; « Renommer », which sets the label and refuses an empty value; « Exclure », which excludes the transaction from reports; and « Virement avec un compte », described below

**Given** a field the user set: merchant, tags, label or excluded
**When** a rule's action targets it
**Then** it is left unchanged, the tags as a whole when the tags are locked

**Given** a « Virement avec un compte » action naming an account
**When** it matches a transaction not already in a transfer
**Then** the transaction records that account as its expected counterpart, and the transfer matcher at step 6 pairs it with its only candidate on that account, even when other accounts also hold candidates
**And** with no candidate yet, the pair forms when the other side is ingested; with several candidates on that account, the transaction stays unmatched for the user to pair by hand; the kind follows the inflow account, as for any transfer; no entry is created

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

Departures from Sure: Sure's transfer action creates the mirror entry in the chosen account and ignores locks. Archant imports every account, so that entry would double the line the other statement brings, and the architecture spine lets a rule only set an expectation that the matcher reads.

### Story 8.3: Apply rules to existing transactions

As the household's administrator,
I want to run rules on past transactions after seeing how many would change,
So that a new rule cleans up my history too.

**Requirements:** FR37, FR38

**Acceptance Criteria:**

**Given** a rule I have just created or edited
**When** I save it
**Then** a dialog offers to apply it to existing transactions and states how many it would change, such as « 12 opérations seront modifiées »: only matching transactions whose targeted field is neither locked nor already set to that value count
**And** « Appliquer » writes the changes; « Plus tard » closes the dialog, and the rule keeps applying to new transactions

**Given** a rule's menu
**When** I choose « Appliquer aux opérations existantes »
**Then** the same dialog opens for that rule

**Given** the rules page
**When** I choose « Appliquer toutes les règles »
**Then** the dialog states how many distinct transactions the enabled rules would change, and confirming applies every enabled rule in order

**Given** a confirmed application
**When** it runs
**Then** the changes are written in one database transaction with `origin: "rule"`, locked fields are left unchanged as at ingestion, transfer matching runs for the transactions a « Virement avec un compte » action marked, and balances are recomputed

**Given** a confirmed application
**When** it has run
**Then** it is recorded with its date, the rule's name or summary at that time, the number of matching transactions and the number changed, and the rules page lists these « Exécutions récentes », newest first, paginated

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

Departures from Sure: Sure ignores the user's locks when a rule is applied by hand; Archant never does (FR38, AD-10). Sure's count includes locked and unchanged transactions; Archant counts what would change. Sure's « Appliquer tout » runs disabled rules too; Archant runs enabled ones only. Closing Sure's dialog leaves a new rule disabled; here it stays enabled. Only applications the user confirms are recorded: an import runs every enabled rule, and one row per rule per import would bury the runs the user asked for.

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
**Then** transactions grouped by account, merchant or else normalised label, and same amount, form a recurring item when there are at least three, the last within 45 days, on days of the month within 5 days of each other, as in Sure

**Given** a recurring item
**When** it is stored
**Then** it carries the expected day of month, amount, last date and occurrence count

**Given** the detection logic
**When** its tests run
**Then** every branch is covered, including month-end days such as the 31st

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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
**Then** it is attached to the existing transaction of the same amount at the nearest date within 3 days that carries no Enable Banking key; with no candidate it is created, and with a tie it is created and flagged as a possible duplicate, which Story 10.6 lets me merge or dismiss

**Given** a failure on one account
**When** sync runs
**Then** that account's writes are rolled back, others are synced, and the connection records the error without an amount, IBAN or token in the logs

**Given** a connection
**When** its page shows
**Then** it displays the last successful sync time and the last error

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

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

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 10.6: Merge or dismiss a possible duplicate

As the household's administrator,
I want to merge a transaction flagged as a possible duplicate with the one it repeats, or dismiss the flag,
So that a file import and a bank sync never leave me with two copies of one operation.

**Requirements:** FR52

**Acceptance Criteria:**

**Given** a transaction flagged as a possible duplicate, by a file import or a sync
**When** the list or its sheet shows it
**Then** it carries a warning icon and « Doublon possible », never colour alone

**Given** a flagged transaction
**When** I choose « Fusionner avec… » and pick the transaction it repeats
**Then** the picked transaction survives with its id through `ledger.absorb`, gains the flagged one's keys, tags, transfer and recurring link, keeps the fields I set by hand, and the flagged one is deleted

**Given** a flagged transaction
**When** I choose « Ce n'est pas un doublon »
**Then** the flag is cleared and a later sync never raises it again for that transaction

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 11: Reliability and first-use fixes

Every figure Archant shows can be trusted with real bank data, and a first-time user gets from `git clone` to a connected bank without reading code. Stories 11.1 to 11.8 each fix a bug recorded in `_bmad-output/implementation-artifacts/deferred-work.md`, found after Epic 10 while comparing Archant with Sure (`docs/sure-parity.md`). Stories 11.9 to 11.14 act on the owner's manual QA of 2026-09-25, run from `_bmad-output/implementation-artifacts/manual-qa-scenarios.md`: each makes something that exists easier to find or to use, or removes something the owner does not want. The differences with Sure marked « No decision recorded » in `docs/sure-parity.md` stay out until the owner decides them. Where Sure's behaviour settles a design question, the story follows it, as every epic before. Stories 11.4 to 11.7 touch the bank sync and come before a real bank is connected.

### Story 11.1: Opening dates that accept today and survive a revert

As the household's administrator,
I want a new account to take today's transactions, and a reverted import to leave the account as it found it,
So that neither the first minute nor an undo corrupts a balance.

**Requirements:** FR1, FR18

**Acceptance Criteria:**

**Given** the account form with its default opening date
**When** I create an account, then record a transaction dated today
**Then** the transaction is accepted and the balance includes it

**Given** an import that moved the account's opening date and amount after I accepted the move
**When** I revert that import
**Then** the opening anchor gets back both its previous date and its previous amount, and importing the same file again yields the same balance as the first time

**Given** an import preview whose matched lines were created by another file
**When** the preview explains the matched group
**Then** the explanation does not say those transactions were entered by hand

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.2: Transfer matching ignores excluded transactions and inactive accounts

As the household's administrator,
I want transfer matching to leave aside what I excluded and accounts I deactivated,
So that a real transfer is never blocked or mismatched by a row I set aside.

**Requirements:** FR31

**Acceptance Criteria:**

**Given** an excluded transaction, or a transaction of a deactivated account
**When** automatic matching runs, or the manual transfer dialog lists candidates
**Then** that transaction is never a candidate, as in Sure's `Family::AutoTransferMatchable`

**Given** a real transfer pair and a third, excluded transaction of the opposite amount within the window
**When** automatic matching runs
**Then** the real pair is matched: the excluded row does not break mutual uniqueness

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.3: The category of a loan payment or an investment contribution

As the household's administrator,
I want to see and change the category of a loan payment or an investment contribution,
So that what the dashboard counts is what the list shows.

**Requirements:** FR33, FR35

**Acceptance Criteria:**

**Given** the outflow side of a loan payment or an investment contribution
**When** the list or its sheet shows it
**Then** its category is shown and editable, as Sure lets a loan payment keep one, while internal moves and card payments keep hiding theirs

**Given** such an outflow with a category
**When** the dashboard shows the month
**Then** it counts in that category, and without one it counts as uncategorised, so the dashboard and the list agree

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.4: A bank read survives a partial failure

As the household's administrator,
I want one failing call to the bank to cost as little as possible,
So that an account keeps syncing when the bank misbehaves in a small way.

**Requirements:** FR50, NFR8

**Acceptance Criteria:**

**Given** a linked account whose balance call fails while its transactions answer
**When** sync runs
**Then** the transactions are synced, the previous balance stays the reference, and the connection records the balance error

**Given** a bank that refuses the requested period with `WRONG_TRANSACTIONS_PERIOD`
**When** sync runs
**Then** it retries with shorter windows, 89, 60 then 30 days as Sure's `Provider::EnableBanking` does, and the account syncs within the window the bank accepts

**Given** a bank that fails after the first page of transactions
**When** sync runs
**Then** the pages already read are written, the account is marked failed so the next sync reads again from its last success, and no pending entry absent from the partial read counts as missed

**Given** one response that lists the same operation twice under two references with identical content
**When** it is synced
**Then** one transaction is created, as Sure removes such repeats

**Given** a bank advertising a maximum consent validity
**When** a consent is requested
**Then** it asks for 60 seconds less than that maximum, capped at 90 days, since Sure found banks refusing the exact maximum

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.5: Pending and booked versions never count twice

As the household's administrator,
I want a card payment to count once, from the moment it is pending to the day it is booked,
So that my current balance is right between two syncs.

**Requirements:** FR51

**Acceptance Criteria:**

**Given** a bank that keeps listing a pending line beside its booked version
**When** sync runs
**Then** the pending line is dropped when a booked line matches it by `entry_reference` or fingerprint, as Sure's `EnableBankingItem::Importer` does, and the balance counts the operation once

**Given** a pending entry missing from the bank's answer
**When** sync runs
**Then** it counts as missed only when that sync ran on a later day than the previous miss, so two button syncs an hour apart never delete it

**Given** a pending line the import pipeline rejects, such as one dated before the opening date
**When** sync runs
**Then** it does not count as a miss for the entry it matched

**Given** two identical pending lines without a reference on the same day
**When** the bank books the first
**Then** the second stays the same entry until it is booked in turn: it is never taken for the first, deleted, then created again

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.6: A transaction I delete stays deleted

As the household's administrator,
I want a synced transaction I delete to stay gone,
So that the next sync does not bring it back.

**Requirements:** FR50, FR52

**Acceptance Criteria:**

**Given** a transaction that came from a bank sync
**When** I delete it
**Then** its bank keys are kept as a tombstone, and a later sync whose overlap covers its date does not create it again

**Given** a transaction that never came from a bank
**When** I delete it
**Then** nothing is kept, as today

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.7: A synced account keeps each bank balance it received

As the household's administrator,
I want every balance the bank reported to stay a fixed point of the account's history,
So that a missing or deleted line shifts the history only since the last bank figure.

**Requirements:** FR56

**Acceptance Criteria:**

**Given** a synced account with a current anchor from an earlier day
**When** a sync brings a new bank balance
**Then** the earlier anchor becomes a reconciliation at its date, as Sure's `Account::CurrentBalanceManager` does, and the new balance becomes the current anchor

**Given** a line missing between two bank figures
**When** the history is computed backward
**Then** only the days between those two figures move, and net worth before the older figure stays the same

**Given** AD-8 in the architecture spine
**When** this story ships
**Then** AD-8 describes the chain of reconciliations

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.8: Recurring series stay single and current

As the household's administrator,
I want each subscription listed once, with a next date that is not in the past,
So that the recurring page can be trusted.

**Requirements:** FR40, FR41

**Acceptance Criteria:**

**Given** a recurring series
**When** I rename it or set its merchant, then detection runs again
**Then** the same series is updated and no second one appears

**Given** a confirmed or manual series whose next date has passed
**When** detection runs, or a matching transaction arrives
**Then** its dates move forward from its latest occurrence, as Sure's separate pass over manual series does

**Given** an import that fed a series' occurrences
**When** I revert it
**Then** the series' count and dates no longer include the deleted transactions

**Given** a transaction whose merchant, or label without a merchant, already has a series
**When** its sheet opens
**Then** the « Récurrence » block names that series and links to the recurring page instead of offering « Ajouter aux récurrences », and the API never creates a second series for the same merchant or label

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.9: A first start that says what is wrong

As someone starting Archant for the first time,
I want the API and the interface to tell me what is wrong in words,
So that a busy port or a missing server never ends on a raw error code.

**Requirements:** NFR12

**Acceptance Criteria:**

**Given** another server already answers on `localhost` at the API's port, as `wrangler dev` did during the manual QA while the API listened beside it
**When** the API starts
**Then** it stops with a log that names the port and the `PORT` variable, instead of listening while the other server answers

**Given** the interface cannot reach the API, or gets an answer that does not come from Archant
**When** a page loads
**Then** a page in French says that the API does not answer, names `pnpm api start:dev` and `PORT`, and offers to retry: the root route has an error page, and a code such as `NETWORK_ERROR` is never the only thing shown

**Given** the README's « Getting started »
**When** I read it
**Then** it says that the database is the SQLite file `local.db` at the root of the repository, which the API creates and migrates at start, so that no container or database server is needed

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.10: The interface package is named app

As a contributor,
I want the interface package to be called `app`,
So that `web` stays free for a public site or a documentation site.

**Requirements:** none; a rename

**Acceptance Criteria:**

**Given** the repository
**When** this story ships
**Then** `packages/web` is `packages/app`, `@archant/web` is `@archant/app`, and the root alias is `pnpm app`

**Given** the `Dockerfile`, the CI workflows, the Playwright configuration, `AGENTS.md`, `README.md` and `docs/`
**When** I search them for `packages/web`, `@archant/web` or `pnpm web`
**Then** nothing is left, while `_bmad-output/` keeps its history as written

**Given** the renamed package
**When** the verification gate runs and the CI job `image` builds and starts the container
**Then** everything passes, with the same behaviour as before

### Story 11.11: Account actions in the account's menu

As the household's administrator,
I want to edit or delete an account from its own page,
So that I do not have to look for a « Paramètres » tab.

**Requirements:** FR3, FR4

**Acceptance Criteria:**

**Given** an account's page
**When** I open the « … » menu beside its name, as Sure's account menu
**Then** it offers « Modifier », « Exclure des rapports » or « Inclure dans les rapports », « Désactiver » and « Supprimer le compte », and the « Paramètres » tab is gone

**Given** « Modifier »
**When** I choose it
**Then** a dialog edits what the « Paramètres » tab edited, with the same rules

**Given** an account linked to a bank
**When** I open its menu
**Then** « Supprimer le compte » is not offered and the menu says to disconnect the bank first, as Sure offers deletion only for an account that is not linked, and the API refuses the deletion of a linked account with its own error code

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.12: Create tags, merchants and categories where they are picked

As the household's administrator,
I want to create a tag, a merchant or a category wherever I manage or pick one,
So that writing a rule or tidying the settings never sends me elsewhere first.

**Requirements:** FR29, FR30, FR36

**Acceptance Criteria:**

**Given** « Réglages › Étiquettes » or « Réglages › Marchands »
**When** I choose « Nouvelle étiquette » or « Nouveau marchand »
**Then** a dialog creates it, as Sure's tag and merchant pages each have a « New » button, and the empty state offers the same action

**Given** the rule dialog
**When** I type a name that does not exist in its merchant, category or tag picker
**Then** the picker offers to create it, as the transaction sheet's pickers do, and the rule uses the new item

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.13: No command palette and no single-key shortcuts

As the household's administrator,
I want an interface without the command palette and the keyboard shortcuts,
So that the screens carry only what I use.

**Requirements:** withdraws UX-DR7; NFR13 still holds

**Acceptance Criteria:**

**Given** the interface
**When** this story ships
**Then** the command palette, the shortcuts dialog, the single-key shortcuts (`g` navigation, `j`/`k`, `x`, `e`, `/`, `?`) and the shortcut hints in tooltips and in the sidebar are gone

**Given** the transaction sheet and every dialog
**When** I use the keyboard
**Then** `Esc` closes, `⌘Enter` saves the sheet, and every page and action stays reachable with `Tab` and the arrow keys, as NFR13 requires

**Given** a dependency that no code uses any more
**When** the story ships
**Then** it is removed from `package.json` and from `docs/tech-stack.md`

**Given** `EXPERIENCE.md`, UX-DR7 in this file and the « Keyboard » row of `docs/sure-parity.md`
**When** the story ships
**Then** they describe the interface without shortcuts, and UX-DR7 is marked withdrawn

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 11.14: Enable Banking set up from the interface

As the household's administrator,
I want to enter my Enable Banking application in the interface,
So that connecting a bank never requires editing a file on the server.

**Requirements:** FR48, NFR4

**Acceptance Criteria:**

**Given** no Enable Banking application configured
**When** I open « Réglages › Banques »
**Then** the page lists the steps, as Sure's Enable Banking panel does: create an application on the Enable Banking portal, register the redirect address shown with a copy button, then enter the application ID and upload the private key `.pem` file

**Given** an application ID and a private key
**When** I save them
**Then** a call to Enable Banking checks them before anything is stored, a refusal is shown in words, and an accepted key is stored encrypted with `ENCRYPTION_KEY`, never logged and never returned by an endpoint

**Given** no `ENCRYPTION_KEY`
**When** I open the page
**Then** it says that this variable is needed and links to `docs/deployment.md#connecting-a-bank`

**Given** `ENABLE_BANKING_APPLICATION_ID` and `ENABLE_BANKING_PRIVATE_KEY` set in the environment
**When** I open the page
**Then** the environment wins and the page shows the application as configured by the server, read-only

**Given** at least one bank connection
**When** I try to change the application
**Then** the change is refused until every connection is disconnected, as Sure locks its configuration while a connection is authenticated

**Given** the architecture spine and `docs/deployment.md`
**When** the story ships
**Then** the spine records where the Enable Banking credentials live, and the « Connecting a bank » section, whose anchor the interface links to, describes the interface first

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 12: A warmer interface, close to Sure

The owner's manual QA of 2026-09-25 found the interface austere next to Sure: little colour, few icons, plain charts, no favicon. The BMAD UX step then compared three directions and two Evidence-inspired variants in HTML mocks; the owner chose the one closest to Sure and approved its logo and favicon. `DESIGN.md` and `EXPERIENCE.md` in `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/` now specify it, with [mockups/key-direction-a.html](ux-designs/ux-archant-2026-09-21/mockups/key-direction-a.html) as the visual reference; the spines win on conflict with the mock.

No story adds a feature or an endpoint: every figure the new screens show is already served by the API. Epic 12 starts after Epic 11, whose Story 11.10 renames the interface package and Story 11.13 removes the shortcut hints these screens would otherwise carry. Story 12.1 comes first; the three others can follow in any order.

### Story 12.1: The brand foundation

As the household's administrator,
I want Archant to look like one product from the sidebar to the browser tab,
So that every later screen builds on the same surfaces, icons and logo.

**Requirements:** UX-DR1, UX-DR3, NFR13

**Acceptance Criteria:**

**Given** the theme in the interface's stylesheet
**When** this story ships
**Then** it carries the tokens of `DESIGN.md` for light and dark mode: the grey page, white cards, the tray, the ring shadow, radii 6, 8, 10 and 12, the account type colours and the trend colours

**Given** one component for tinted icons and one for category pills
**When** they render a category, an account type, a transfer, an uncategorised row or a merchant without a category
**Then** they follow `DESIGN.md`: the colour at 10% behind a lucide icon in the full colour, or the merchant's first letter, and a pill whose text is the colour darkened until it reaches 4.5:1 on its tint, for any colour the household picks

**Given** the sidebar
**When** it renders
**Then** it shows the arch logo beside « Archant », a lucide icon before each entry, the active entry as a white raised tile, and each account with its tinted type icon, subtype and balance

**Given** the browser tab and a home-screen bookmark
**When** Archant is open
**Then** the tab shows the arch favicon as an SVG with a 32 px PNG fallback, in the logo colour of the current mode

**Given** the settings navigation
**When** it renders
**Then** each entry has its lucide icon, as Sure's settings navigation

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest, including the contrast of the pill text helper

### Story 12.2: The dashboard

As the household's administrator,
I want the dashboard to greet me and show my money at a glance,
So that one look tells me where the household stands this month.

**Requirements:** FR34, FR35, UX-DR5

**Acceptance Criteria:**

**Given** the dashboard with at least one account
**When** it loads
**Then** it opens with « Bonjour » and the user's first name, one muted sentence and the two actions, as in the reference mock

**Given** the net worth card
**When** it renders a period
**Then** it shows the value, the change with a trend arrow, the assets and liabilities totals, and an area chart whose 2 px line and 6 % to 0 % gradient take the trend colour of that period, with no grid and only the first and last dates, keeping the text summary and « Voir le tableau »

**Given** the month's flow card
**When** it renders a month
**Then** it shows income, expenses and « Épargne du mois », an outflows donut in the category colours with the total in its centre, and a tray listing each category with its tinted icon, amount and share

**Given** the balance sheet card
**When** it renders
**Then** Actifs and Passifs each show their total, a 6 px weight bar split by account type in the type colours with a dot legend and percentages, and a tray of their accounts

**Given** a fresh instance with no account
**When** the dashboard loads
**Then** it shows the empty state card of `DESIGN.md` with « Ajouter un compte »

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 12.3: Transactions and accounts

As the household's administrator,
I want the transactions and accounts pages to carry the same colour and icons as the dashboard,
So that I recognise a category or an account without reading its name.

**Requirements:** FR5, UX-DR6

**Acceptance Criteria:**

**Given** the transactions list, on its page or an account's page
**When** it renders
**Then** each day group is a tray with the day's subtotal, and each row shows the category's tinted icon or the merchant's letter, the label with its caption, the category pill, the account and the amount

**Given** a pending, recurring, internal transfer or possible duplicate row
**When** it renders
**Then** it carries the matching badge of `DESIGN.md`, each with an icon

**Given** the accounts page and an account's page
**When** they render
**Then** accounts are grouped in trays under Actifs and Passifs with their tinted type icon, and the account's page opens with its type icon, name and balance in `amount-hero` inside cards

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 12.4: The remaining screens

As the household's administrator,
I want every other screen to match,
So that no page looks left over from before.

**Requirements:** UX-DR1, UX-DR8, UX-DR10, UX-DR11

**Acceptance Criteria:**

**Given** the recurring page, the rules page, the settings pages (banks, categories, merchants, tags, security), the import dialog, the sign-in page and the first-launch setup page
**When** they render
**Then** they use the cards, trays, tinted icons, pills, badges and empty states of `DESIGN.md`, and the sign-in and setup pages show the arch logo

**Given** any empty list in those screens
**When** it renders
**Then** it shows the empty state card of `DESIGN.md` with one action

**Given** light and dark mode
**When** each screen of Epic 12 renders
**Then** every text pair meets WCAG 2.2 AA, checked by a Vitest test over the theme's token pairs

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest
