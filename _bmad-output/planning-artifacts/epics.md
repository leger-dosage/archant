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
  - docs/architecture.md
  - _bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/EXPERIENCE.md
  - _bmad-output/planning-artifacts/audit-2026-09-30.md
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
FR10: The user can create an investment account (PEA) tracked through balance snapshots only, without holdings. Revised by Epic 22: trades and holdings join the snapshots (FR80 to FR83), and an account without trades stays as it is.
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
FR44: Every user has a role. `admin` is the only role in use; the schema allows adding `viewer` later without a data migration. Revised by Epic 20: `viewer` comes into use (FR74).
FR45: The user can change their password. A forgotten password is reset through a command run on the server, since a self-hosted instance may have no email service.

#### Deployment

FR46: One container image serves the built interface and the API on the same port, against a SQLite file on a volume, and applies pending migrations at start.
FR47: `GET /api/health` reports that the API and its database answer.

#### Enable Banking synchronisation

FR48: The user picks a country and a bank from the Enable Banking list, is sent to the bank to consent, and comes back through a callback.
FR49: The user chooses which bank accounts to link. Each one links to a new account or to an existing account, for instance one already fed by files.
FR50: A sync fetches balances and transactions for every linked account since the last sync, with an overlap window. It runs from `POST /api/sync`, from a button in the interface, and on the first visit of the day.
FR51: A pending transaction is stored as pending. When its booked version arrives, it updates the pending one in place without creating a duplicate, even if the label changed, or the amount when the bank keeps the same reference.
FR52: A transaction that arrives both from a file and from Enable Banking ends up as one transaction.
FR53: The interface warns when a consent expires within 14 days and lets the user renew it. After expiry, sync stops for that connection with a visible status, and no data is lost.
FR54: The user can disconnect a bank. Its accounts stay, with their history, as manual accounts.
FR55: Each connection shows its last successful sync and its last error.
FR56: A linked account uses the balance reported by the bank as its reference and computes its history backward from it.

#### Running in production

FR57: Creating the first administrator requires a setup token that only someone with access to the server can read, so a stranger who finds a fresh instance cannot claim it.
FR58: The user can turn on two-factor sign-in with a time-based one-time code (TOTP) and single-use backup codes, as in Sure.
FR59: Every release publishes a versioned container image, for amd64 and arm64, that a self-hoster pulls and pins; the interface shows the running version.
FR60: Before applying a pending migration, the server copies the database beside it, so a failed upgrade can go back to the previous version with that copy.

#### AI assistants

FR61: The user connects an AI assistant to Archant through MCP, the Model Context Protocol, at `/api/mcp`: the assistant signs the user in through Better Auth, and the user grants it read access, or read and write access, on a consent page.
FR62: The user sees every connected assistant with what it may do, when it last called Archant and the writes it made, and disconnects it at once.
FR63: An assistant can create, edit, enable, disable, delete, preview and apply rules, and create the categories, merchants and tags a rule names.
FR64: An assistant can read accounts, transactions, net worth, income and expenses, and recurring transactions.
FR65: An assistant can set a transaction's category, merchant, tags, notes, label and exclusion, one at a time or in bulk.

#### Budgets

FR66: The user sets a month's planned spending and expected income, suggested from earlier months, and follows actual spending and income against them, as in Sure.
FR67: The user spreads the month's spending over expense categories, subcategories sharing or ring-fencing their parent's amount, and sees each category over budget, near its limit or on track.
FR68: The user copies a month's budget from the latest month set up, and moves money between categories.
FR69: The user carries a category's unspent amount into the next month, category by category.
FR70: An assistant can read a month's budget with its earlier months, and set its amounts.

#### Data export

FR71: The user downloads every account, transaction, balance, category, merchant, tag, rule and recurring item in one archive, in Sure's export format, without any secret.

#### Splits and attachments

FR72: The user splits a transaction into lines that sum to it, each with its own label, amount, category, tags and notes; the lines replace the transaction in every balance, report, list, rule and detection.
FR73: The user attaches receipts and invoices, images or PDFs, to a transaction.

#### Household members

FR74: A user with the `viewer` role reads everything an administrator reads, except bank credentials, assistants, members and the export, and writes nothing; the server refuses every write.
FR75: The administrator invites a person by a link that expires, as an administrator or a viewer; the invited person sets their own password.
FR76: The administrator lists members and pending invitations, changes a role, removes a member and revokes an invitation; the last administrator always remains.

#### Savings goals

FR77: The user sets a savings goal with a target and an optional date, funded by the whole balance or a fixed amount of linked accounts, and sees what remains, the monthly amount needed, and whether it is on track.
FR78: The user pauses, completes, archives and reopens a goal, sees its projection, and sees active goals on the dashboard.
FR79: The user keeps a reserve whose target is a fixed amount or a number of months of expenses.

#### Investments

FR80: Archant knows securities by ISIN, ticker and venue, and fetches their daily prices from a provider the user turns on; a security without a provider is priced by hand.
FR81: The user records buys and sells on an investment account.
FR82: An investment account's value is its cash plus its holdings, computed daily from trades and prices, and the user sees each position with its average cost and unrealised gain.
FR83: The user records dividends and interest, and converts a transaction on an investment account into a trade.

### NonFunctional Requirements

NFR1: Money is never a float. Every amount is an integer in minor units with an ISO 4217 currency code.
NFR2: No code path assumes EUR. Totals are computed in one reporting currency; an account in another currency is left out of totals with a visible notice until conversion exists.
NFR3: Every input crossing a boundary is parsed by a Zod schema: request bodies, uploaded files, provider responses, environment variables.
NFR4: Provider tokens and keys are encrypted at rest, never logged, never returned by an endpoint.
NFR5: Logs and error reports never contain an amount tied to an identity, an IBAN, or a token.
NFR6: Sessions are handled by Better Auth with its defaults intact.
NFR7: The API answers `{ "data": ... }` or `{ "error": { "code", "message" } }`. Codes are a closed union in `AppError`; an unexpected error returns a generic `INTERNAL_ERROR` 500 without stack trace or provider payload. Messages are in English.
NFR8: An import or a sync is atomic per account: a failure writes nothing for that account.
NFR9: The whole application runs as one process with no queue and no broker. A sync runs inside the request that triggers it, except the sync of the first visit of the day, which runs in the same process beside the request that started it.
NFR10: With 100,000 transactions, the first page of the transaction list and an account's page answer in under 150 ms, and a 24,000-line OFX file is confirmed in under 3 seconds on a small server.
NFR11: No test reaches the network; an unmocked request fails the test and names the URL. Money paths (import, deduplication, balance computation, transfer matching, provider sync) are covered to the branch.
NFR12: The interface is in French first. Every visible string goes through a translation layer so another language can be added without touching components.
NFR13: The interface is usable with the keyboard alone and meets WCAG 2.2 AA contrast.
NFR14: Dependencies stay few and popular; each new one is justified in its pull request.
NFR15: A request cannot exhaust the server: every route has a body size limit, sign-in attempts are limited per address and overall with a count that survives a restart, and no parser runs in time exponential in its input.
NFR16: The default deployment exposes nothing it does not need: the container publishes its port on loopback only, runs on a read-only filesystem without Linux capabilities, and the interface is served with a Content-Security-Policy. Outside a container, the server listens on loopback only unless told otherwise.
NFR17: The build, its dependencies and its published images are pinned, kept current by a bot, and attested: actions by commit SHA, base images by digest, the package manager by hash, and every release image with an SBOM and a build provenance attestation.
NFR18: A vulnerability can be reported privately, GitHub's secret scanning and code scanning run on the repository, and the default branch and release tags are protected by rulesets.
NFR19: An assistant holds only a token bound to `/api/mcp`, short-lived, scoped to read or write, and revocable from the interface; every tool parses its input with Zod and calls the same service function as the interface; no tool deletes a transaction; every write an assistant makes is recorded without its amounts or labels.
NFR20: An outbound call that tells a third party something about the household, such as a price request naming a security held, is off until the user turns it on, says which host it reaches, and sends identifiers only, never an amount or a quantity.

### Additional Requirements

- No starter template. The first story that needs a package creates it with only the dependencies it uses. The pitfalls in `scaffolding-lessons.md` apply: `.ts` import extensions, recursive `include`, `onlyBuiltDependencies: [esbuild]`, the shared `DATABASE_URL` path, `:memory:` databases in tests, the `/api` prefix before the API serves the interface, `init: true` in the container.
- The connector interface is decided through `bmad-architecture` before the first import story. File parsers and bank connectors both produce normalised transactions; one ledger service deduplicates and writes them. Adding a connector or a format never touches the ledger.
- `@archant/api` has a single entrypoint, `packages/api/src/index.ts`, and never branches on the platform.
- SQLite through Drizzle only, snake_case columns mapped to camelCase, derived types in `packages/data/types.ts`, no raw SQL in application code. Migrations applied with `drizzle-orm/libsql/migrator`.
- Environment validated by a `validateEnv(runtimeEnv)` function built on `@t3-oss/env-core`; `.env.example` lists every variable and what degrades without it.
- The interface calls the API through Hono's typed client (`hc<AppType>()`), with chained route mounts and the same Hono version in both packages.
- Interface built with Vite, React, TanStack Router, TanStack Query, shadcn/ui and Tailwind CSS.
- `POST /api/sync` is protected by a shared secret. It is optional: the first visit of the day syncs on its own, as in Sure, and the route serves a host that stays on, triggered by a cron or a scheduled GitHub Action.
- GitHub Actions runs the verification gate on every pull request and exercises the container once it exists.
- Enable Banking credentials (application id and private key) come from the environment.
- The application copies the database before a migration (FR60). Other backups are taken by hand with the `VACUUM INTO` recipe of `docs/deployment.md`; scheduled and off-site backups are deferred until the owner wants them.
- Amounts are signed from the account's point of view: negative means money leaving the account. A liability's balance is displayed as a positive outstanding amount. The architecture fixes the storage convention.
- Every story ships automated tests for its acceptance criteria: Playwright end-to-end tests for what the interface shows, Vitest for domain, services and routes. A story is not done while one of its criteria is only checked by hand. Story 1.7 creates the Playwright harness and covers Stories 1.1 to 1.4; every story after it adds its own tests.
- The architecture spine, `docs/architecture.md`, binds every story; its `AD-n` rules win over any wording here.
- Ordering constraints outside this document: `bmad-architecture` settles the connector interface and the data model before Story 2.1, and `bmad-ux` produces `DESIGN.md` and `EXPERIENCE.md` before Story 1.1, the first interface story.

### UX Design Requirements

Source: `ux-designs/ux-archant-2026-09-21/DESIGN.md` and `EXPERIENCE.md`. Both bind every interface story; they win over any wording here.

UX-DR1: The shadcn/ui neutral base with the brand layer of `DESIGN.md` (Linear Light and Linear Classic Dark, Inter and Geist Mono, radii 5/6/8/10, the sidebar on the base background with the page in an inset panel, tinted icons, category pills, the arch logo), dark mode following the system with a manual override. Story 1.1; revised by Epic 12, Stories 12.1 to 12.4; revised by Epic 14, Stories 14.1 to 14.4: Sure's shell, type scale, control sizes and inset groups, with Linear's colours, Inter and lines.
UX-DR2: One `Money` component renders every amount: `fr-FR`, tabular figures, income green with a plus, expenses in the foreground colour with a true minus, muted for pending and excluded with a badge or icon. Story 1.1.
UX-DR3: Sidebar with navigation entries and the accounts grouped under Actifs and Passifs with totals and balances, collapsing below 1024 px and becoming a sheet below 768 px. Stories 1.1, 1.6; revised by Epic 14, Stories 14.1 to 14.4: Sure's rail of destinations, a foldable accounts column grouped by type with tabs Tout, Actifs, Passifs, a top bar with breadcrumbs, and below 1024 px a bottom navigation with the accounts column as a full-screen overlay.
UX-DR4: Transaction sheet with save on `⌘Enter`, `Esc` to close, a prompt only when changes are unsaved, and the transaction's source shown. Story 1.2.
UX-DR5: Charts with a text summary and a « Voir les données » table alternative, keyboard cursor, no animation under reduced motion. Stories 1.3, 6.1, 6.2.
UX-DR6: Transactions list grouped by day headers, filters as removable chips kept in the URL, result count and signed total of the filtered rows. Story 1.5.
UX-DR7 (Withdrawn by Story 11.13): Command palette on `⌘K` / `Ctrl+K` and the keyboard shortcuts of `EXPERIENCE.md` (`g` navigation, `j`/`k`, `x`, `e`, `/`, `?`), off inside text fields, each with a visible equivalent. Story 1.8; the `x` selection and its `Shift` extension, Story 4.5.
UX-DR8: Import dialog with steps Fichier, Colonnes, Aperçu, preview tabs per group with counts, and a confirm button stating the count. Stories 2.1, 2.3.
UX-DR9: Bulk bar at the bottom of the transactions list with « Tout sélectionner (N résultats) ». Story 4.5.
UX-DR10: Warning banners for consent expiry, expired consent and stale sync, one action each. Story 10.5.
UX-DR11: Accessibility floor of `EXPERIENCE.md`: keyboard reach, visible focus, focus return, `aria-live` toasts, 24 px targets, WCAG 2.2 AA contrast. Every interface story; revised by Epic 14: 14 px body text and 36 px controls by default.

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
FR50: Epic 10 - Sync from route and button; Epic 13 - Sync on the first visit of the day
FR51: Epic 10 - Pending transactions
FR52: Epic 10 - File and API deduplication
FR53: Epic 10 - Consent expiry and renewal
FR54: Epic 10 - Disconnect a bank
FR55: Epic 10 - Connection status
FR56: Epic 10 - Bank balance as reference
FR57: Epic 13 - Setup token
FR58: Epic 13 - Two-factor sign-in
FR59: Epic 13 - Versioned image and visible version
FR60: Epic 13 - Copy before migration
FR61: Epic 16 - Connect an assistant through MCP and Better Auth
FR62: Epic 16 - Connected assistants, their writes, disconnection
FR63: Epic 16 - Rule tools
FR64: Epic 16 - Read tools
FR65: Epic 16 - Classification tools
FR66: Epic 17 - A month's budget
FR67: Epic 17 - Budget by category
FR68: Epic 17 - Copy a budget, move money
FR69: Epic 17 - Rollover
FR70: Epic 17 - Budget tools for assistants
FR71: Epic 18 - Full data export
FR72: Epic 19 - Split a transaction
FR73: Epic 19 - Attachments
FR74: Epic 20 - Viewer role
FR75: Epic 20 - Invitations by link
FR76: Epic 20 - Members
FR77: Epic 21 - Savings goals funded by accounts
FR78: Epic 21 - Goal lifecycle and projection
FR79: Epic 21 - Reserves
FR80: Epic 22 - Securities and prices
FR81: Epic 22 - Trades
FR82: Epic 22 - Holdings and cash plus holdings
FR83: Epic 22 - Dividends, interest, convert to trade

Epic 11 adds no requirement. It fixes shipped behaviour that breaks FR1, FR18, FR31, FR33, FR35, FR40, FR41, FR50, FR51, FR52, FR56 and NFR8, and acts on the owner's manual QA: FR3, FR29, FR30, FR36, FR48, NFR4 and NFR12 get easier to reach, and UX-DR7 is withdrawn. Epic 12 revises UX-DR1. Epic 13 adds FR57 to FR60, NFR15 and NFR16, revises FR50 and NFR9, and revises the additional requirements on backups and on `POST /api/sync`. Epic 14 revises UX-DR1, UX-DR3 and UX-DR11. Epic 15 adds NFR17 and NFR18 and revises NFR10. Epic 16 adds FR61 to FR65 and NFR19. Epics 17 to 22, chosen by the owner on 2026-10-03, add FR66 to FR83 and NFR20; Epic 20 revises FR44, and Epic 22 revises FR10 and withdraws the overview's non-goal on investment tracking.

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

### Epic 12: A warmer interface in Linear's skin

Archant stops looking austere: Sure's content (a greeting, colour through tinted icons and category pills, a donut, a balance sheet by account type) in Linear's skin (Linear Light, Linear Classic Dark, Inter, an inset panel, borders instead of shadows), with a logo and a favicon, as `DESIGN.md` now specifies.
**FRs covered:** none new; revises UX-DR1

### Epic 13: Ready for real bank data

The owner hosts Archant somewhere other than their laptop, connects a real bank through Enable Banking's production environment, and upgrades it without risking the data: the findings of the security audit of 2026-09-26 are fixed, releases ship as versioned images, the database is copied before every migration, and a guide takes the owner from nothing to Archant running at home, reachable only through Tailscale.
**FRs covered:** FR57, FR58, FR59, FR60; NFR15, NFR16; revises FR50, NFR9

### Epic 14: Sure's proportions under Linear's colours

The interface stops reading small: Sure's shell, pages, type scale and control sizes, with Linear kept as a light layer of colours, Inter and lines, as `DESIGN.md` now specifies.
**FRs covered:** none new; revises UX-DR1, UX-DR3, UX-DR11

### Epic 15: A healthy open-source project

A stranger can trust, install and contribute to Archant, and the owner's instance stays fast and hard to lock: a private way to report a vulnerability, a protected default branch, a pinned and attested supply chain, documents for contributors and self-hosters, the sign-in lockout of the audit of 2026-09-30 fixed, SQLite given the statistics and indexes a decade of history needs, and the ledger split into modules a contributor can read.
**FRs covered:** none new; NFR17, NFR18; revises NFR10

### Epic 16: Ask an assistant to act in Archant

The owner asks an AI assistant, such as Claude Code, to write the rules that clean up their bank lines, then to read and classify their finances: Archant serves MCP from the API's own process, and the assistant signs in through Better Auth with a token the owner can revoke.
**FRs covered:** FR61, FR62, FR63, FR64, FR65; NFR19

### Epic 17: Monthly budgets

The owner plans each month's spending by category, as in Sure: a total and an expected income suggested from past months, an amount per expense category, statuses, a copy from the last month, money moved between categories, and an unspent amount carried over.
**FRs covered:** FR66, FR67, FR68, FR69, FR70

### Epic 18: Export all my data

The owner downloads every figure Archant holds in one archive, in Sure's export format, so they can always leave.
**FRs covered:** FR71

### Epic 19: Split a transaction and attach receipts

A mixed receipt becomes several lines with their own categories, and a receipt or an invoice sits beside its transaction.
**FRs covered:** FR72, FR73

### Epic 20: Share Archant read-only with the household

A member of the household reads the accounts with their own sign-in, invited by a link, and the server refuses them every write.
**FRs covered:** FR74, FR75, FR76; revises FR44

### Epic 21: Savings goals

The owner saves toward targets funded by their accounts' balances and sees what to put aside each month, as in Sure's goals.
**FRs covered:** FR77, FR78, FR79

### Epic 22: Investment holdings and prices

An investment account shows its positions, their average cost and their gain, valued from daily prices the owner allows Archant to fetch.
**FRs covered:** FR80, FR81, FR82, FR83; NFR20; revises FR10

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

**Given** 100,000 transactions in a local SQLite file
**When** the first page loads with no filter
**Then** the API answers in under 150 ms (NFR10, revised by Story 15.5)

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

### Story 8.4: Replace in the label

As the household's administrator,
I want a rule to rewrite part of a label,
So that the noise my bank adds to every card line, a prefix, a suffix, a separator, disappears without one rule per shop.

**Requirements:** FR36, FR37, FR38

**Acceptance Criteria:**

**Given** the rule form
**When** I add the action « Remplacer dans le libellé »
**Then** it shows « Rechercher », a pattern, and « Remplacer par », a text that may stay empty to delete what matched; a rule holds one such action, as every action type is held once

**Given** a pattern
**When** it is evaluated
**Then** it is an RE2 expression read without regard to case and every occurrence is replaced; the replacement is literal text, so `$` and `\` mean nothing special; a label the action changes is trimmed and its runs of spaces collapsed; a label it does not change, or that would end up empty, is left as it is

**Given** a pattern that is empty, longer than 200 characters, or that RE2 refuses, such as an unclosed parenthesis, a back reference or a lookahead
**When** I save the rule
**Then** it is refused and « Rechercher » shows why; a pattern that backtracks without limit in the browser's own engine, such as `(a+)+$`, is accepted and runs in linear time

**Given** a rule with the action `\\` replaced by a space and no condition
**When** a line labelled `LECLERC SANS CONTAC\ANCENIS-SAINT\ FR` is imported
**Then** its label is `LECLERC SANS CONTAC ANCENIS-SAINT FR`, written with `origin: "rule"` and locking nothing

**Given** a transaction whose label the user set
**When** a rule matches it
**Then** its label is left unchanged, as for a rename

**Given** several rules in creation order
**When** a line is created
**Then** each sees the label the earlier ones wrote, so a rule that removes a prefix and a rule that removes a suffix combine

**Given** existing transactions
**When** I apply the rule from the dialog of Story 8.3
**Then** it counts only the labels that would change and rewrites them

**Given** the troubleshooting page
**When** I read « Labels show backslashes or a card prefix »
**Then** it quotes the two labels above and gives three rules to copy, for the backslashes, the `CARTE jj/mm/aa` prefix and the `CB*nnnn` suffix

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest, a pattern of catastrophic backtracking among them

Departures from Sure: Sure has no action that transforms a label; its rename sets a fixed one, and its text operators take no pattern. A bank sends its own formats, so no cleanup is built in and none is shipped as a default rule: each household writes the rules its bank needs. Patterns run in RE2 through `re2js`, not in the built-in `RegExp`, because the text they read is partly chosen by whoever sends a transfer. Out of this story: a pattern operator on the label condition, capture references in the replacement, a pattern on notes or merchants, and rule import and export.

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

## Epic 12: A warmer interface in Linear's skin

The owner's manual QA of 2026-09-25 found the interface austere next to Sure: little colour, few icons, plain charts, no favicon. The BMAD UX step compared HTML mocks: three directions, two Evidence-inspired variants, then Linear's themes. The owner first chose the direction closest to Sure, then locked on 2026-09-26 its content in Linear's skin, Linear Light in light mode and Linear Classic Dark in dark mode, with the arch logo and its favicon. `DESIGN.md` and `EXPERIENCE.md` in `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/` specify it, with [mockups/key-linear-classic-dark.html](ux-designs/ux-archant-2026-09-21/mockups/key-linear-classic-dark.html) as the visual reference; the spines win on conflict with the mock.

Every figure the new screens show is already served by the API. The one addition is the first name the dashboard greets: the administrator has none today, since `/setup` names the user after the e-mail's local part, so Story 12.2 asks for it. Epic 11 is shipped: the interface lives in `packages/app`, the shortcuts are gone, and the screens Epic 11 added (the root error page, the account menu, the creation dialogs, the Enable Banking panel) are restyled in Story 12.4. Story 12.1 comes first; the three others can follow in any order.

### Story 12.1: The brand foundation

As the household's administrator,
I want Archant to look like one product from the sidebar to the browser tab,
So that every later screen builds on the same surfaces, type, icons and logo.

**Requirements:** UX-DR1, UX-DR3, NFR13

**Acceptance Criteria:**

**Given** the theme in `packages/app/src/styles.css`
**When** this story ships
**Then** it carries the tokens of `DESIGN.md` for Linear Light and Linear Classic Dark: surfaces, text, borders and lines, the indigo primary, accent and link colours of each mode, the money colours, the account type colours, radii 5, 6, 8 and 10, and no shadow outside floating layers

**Given** the fonts
**When** the interface loads
**Then** text is set in Inter with `cv01` and `ss03` through `@fontsource-variable/inter`, which replaces `@fontsource-variable/geist`, code stays in Geist Mono, and `docs/tech-stack.md` says so

**Given** every signed-in page
**When** it renders
**Then** it sits in the app shell of `DESIGN.md`: the sidebar on the base background with the arch logo beside « Archant », a lucide icon before each entry, the active entry on the active background, each account with its tinted type icon and balance, and the page in the inset panel under a title bar that holds the page title and its actions

**Given** one component for tinted icons and one for category pills
**When** they render a category, an account type, a transfer, an uncategorised row or a merchant without a category
**Then** they follow `DESIGN.md`, and one helper adjusts the pill text to 4.6:1 in light and 6.5:1 in dark and the icon to 3:1 on the hover row, for any colour the household picks

**Given** the colour choices offered when a category is created or edited
**When** the category dialog opens
**Then** it offers the palette of `DESIGN.md`, and existing categories keep their colour

**Given** the browser tab
**When** Archant is open
**Then** it shows the arch favicon as an SVG that follows the colour scheme, with a 32 px PNG fallback

**Given** the settings navigation
**When** it renders
**Then** each entry has its lucide icon

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest, including the contrast helper and a check of the theme's text pairs in both modes

### Story 12.2: The dashboard

As the household's administrator,
I want the dashboard to greet me and show my money at a glance,
So that one look tells me where the household stands this month.

**Requirements:** FR34, FR35, FR42, UX-DR5

**Acceptance Criteria:**

**Given** the first-launch setup page and « Réglages › Sécurité »
**When** I fill in « Prénom », optional at setup and editable later through Better Auth's user update
**Then** it is stored as the user's name; an administrator created before this story, whose name is the e-mail's local part, keeps it until changing it

**Given** the dashboard with at least one account
**When** it loads
**Then** it opens with « Bonjour » followed by the first name when one is set, or « Bonjour » alone, then one muted sentence, with « Ajouter un compte » in the title bar

**Given** the net worth section
**When** it renders a period
**Then** it shows the value, the change with a trend arrow, the assets and liabilities totals, and an area chart with a 1.5 px accent line, a faint gradient, horizontal gridlines and abbreviated axis labels, keeping the text summary and « Voir le tableau »

**Given** the month's flow section
**When** it renders a month
**Then** it shows income, expenses and « Épargne du mois », a thin outflows donut in the category colours with the total in its centre, and the categories with tinted icon, amount and share

**Given** the balance sheet section
**When** it renders
**Then** Actifs and Passifs each show their total, a 4 px weight bar split by account type in the type colours with a dot legend and percentages, and their accounts

**Given** a fresh instance with no account
**When** the dashboard loads
**Then** it shows the empty state of `DESIGN.md` with « Ajouter un compte »

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
**Then** rows are 36 px, each day opens with a header row holding the day, the count and the subtotal, and each row shows the category's tinted icon or the merchant's letter, the label with its caption and badges, the category pill, the account with its type icon and the amount, with the hover and selection states of `DESIGN.md`

**Given** a pending, recurring, internal transfer or possible duplicate row
**When** it renders
**Then** it carries the matching badge of `DESIGN.md`, each with an icon

**Given** the accounts page and an account's page
**When** they render
**Then** accounts are grouped under Actifs and Passifs in sections with their tinted type icon, and the account's page shows its type icon, name and menu in the title bar and its balance in `amount-hero`

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 12.4: The remaining screens

As the household's administrator,
I want every other screen to match,
So that no page looks left over from before.

**Requirements:** UX-DR1, UX-DR8, UX-DR10, UX-DR11

**Acceptance Criteria:**

**Given** the recurring page, the rules page, the settings pages (banks with the Enable Banking panel, categories, merchants, tags, security), the import dialog, the creation and edit dialogs, the account menu, the root error page, the sign-in page and the first-launch setup page
**When** they render
**Then** they use the sections, tinted icons, pills, badges, buttons and empty states of `DESIGN.md`, and the sign-in, setup and error pages, which sit outside the app shell, show the arch logo on the base background

**Given** any empty list in those screens
**When** it renders
**Then** it shows the empty state of `DESIGN.md` with one action

**Given** light and dark mode
**When** each screen of Epic 12 renders
**Then** every text pair meets WCAG 2.2 AA, checked by a Vitest test over the theme's token pairs

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 13: Ready for real bank data

After Epic 12 the owner ran a manual QA pass and decided to host Archant and connect a real bank through Enable Banking's production environment. A security audit of the code on 2026-09-26 found one high-severity issue, three medium and four low; `pnpm audit --prod` found no known vulnerability. The high one: `/api/setup` creates the administrator for whoever calls it first, and a fresh domain's certificate lands in public certificate transparency logs that bots scan within minutes. Stories 13.1 to 13.4 fix every finding; Stories 13.5 and 13.6 make an upgrade a pull and a restart that cannot lose data; Story 13.7 writes the hosting guide the owner follows.

Where Sure settles a question, the story follows it: two-factor sign-in is TOTP with backup codes, optional per user, as in Sure's `MfaController`; images are published to GHCR on version tags for amd64 and arm64, as in Sure's `publish.yml`; migrations run at boot, as in Sure's `bin/docker-entrypoint`. Archant goes further than Sure on backups, because its database is a single SQLite file the application can copy itself, where Sure delegates to a Postgres sidecar.

The hosting research of 2026-09-26 ranked, for bank data first and cost second: a machine at home reachable only through Tailscale (free), a VPS in France at about 4.60 € a month (OVH VPS-1) or in Germany (Hetzner), then Fly.io at about 2 to 3 dollars a month. Render, Koyeb and Railway's free tiers have no persistent disk; Google Cloud's free VM is outside the EU; Oracle's Always Free tier halved its quota without notice in 2026 and reclaims idle instances; Turso would move the bank history to a third party. Cloudflare Workers with D1, considered in ADR 0001 and set aside by ADR 0002, does not fit the free plan: 10 ms of CPU and 50 subrequests per request, a D1 query counting as one, no interactive transaction where the API opens 46, and every query refused for the rest of the day past 100,000 rows written.

On 2026-09-27 the owner chose the machine at home, reachable only through Tailscale, a private encrypted network between their own devices. Nothing listens on the internet: Enable Banking's consent redirect is a navigation of the owner's browser, which is on the tailnet, and every call to Enable Banking leaves the server outbound. A home machine can die or be stolen. On 2026-09-27 the owner judged scheduled and off-site backups too much for the project's maturity, after comparing Litestream (continuous, but no client-side encryption since v0.5) with offen/docker-volume-backup (nightly, GPG-encrypted, needing a nightly copy from the server): neither is planned. Story 13.6 keeps the one copy that protects the likeliest loss, a failed upgrade, and Story 13.7 documents the manual backup and what a lost machine costs. Stories 13.1 to 13.4 still ship: a tailnet shrinks the attack surface, it does not replace a sign-in that holds on its own.

Stories 13.1 to 13.4 can ship in any order; 13.6 needs 13.5's version number; 13.7 comes last, since it documents all of them.

On 2026-09-29 the owner followed the guide on a Mac with Docker Desktop, a machine that sleeps. Three problems came out of it. First, a daily cron misses every run the machine sleeps through, and the owner wants the code to handle a host that sleeps rather than assume a server that never does. Sure already does: its `AutoSync` concern starts a sync on the first page of the day, and its scheduled sync is an option in the hosting settings. Second, the server listens on every interface, so `pnpm api start:dev` or a plain Node host exposes the sign-in page to the whole Wi-Fi. Third, the first run was harder than it should be: `docker compose up --wait` does not show the setup token, and an `ARCHANT_URL` left empty ended in a raw `INVALID_ORIGIN` code at sign-in. Stories 13.8 to 13.10 fix them, in any order. The same day the owner registered the `ts.net` redirect URL on a production application and Enable Banking accepted it, so the guide can state it. Choosing a bank showed a fourth problem: « Banques disponibles » lists every bank of the country on the page itself, above « Banques connectées », where Sure opens a dialog with a search field focused and a list that scrolls inside it. Story 13.11 follows Sure. Connecting Boursorama then linked no account: Enable Banking listed six, each with its `uid`, but Boursorama gives every account the currency `XXX`, ISO 4217's « no currency », and the session schema silently drops an account whose currency it cannot read. Its balances and transactions carry real currencies. Sure's `EnableBankingAccount` treats `XXX` as missing and keeps the account's known currency, else `EUR`, with a warning. Story 13.12 follows Sure.

### Story 13.1: The first administrator needs a setup token

As the household's administrator,
I want the first-launch setup to ask for a token printed in the server's logs,
So that nobody who finds my fresh instance on the internet can create the administrator before me.

**Requirements:** FR42, FR57

**Acceptance Criteria:**

**Given** a database with no user
**When** the server starts
**Then** it generates a random setup token, keeps it in memory only, and logs it once at `info` with the instruction to open `/setup`; with a user, it generates and logs nothing

**Given** the setup page
**When** I submit it
**Then** it asks for « Jeton de configuration » beside the existing fields, and `POST /api/setup` compares it in constant time; a missing or wrong token answers `403` with a closed error code and creates nothing

**Given** repeated wrong tokens
**When** they arrive from one address
**Then** they are rate-limited like sign-in attempts

**Given** setup is done
**When** anyone calls `POST /api/setup`
**Then** it is refused before the body is read, as today, and `GET /api/setup` still reveals nothing beyond whether setup is open

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest, the e2e `setup` project reading the token the test server prints

### Story 13.2: A request cannot exhaust the server

As the household's administrator,
I want no request, file or run of sign-in attempts to freeze or crash the server,
So that a stranger cannot take Archant down or guess my password by brute force.

**Requirements:** NFR15

**Acceptance Criteria:**

**Given** any route under `/api` except the file upload, which keeps its 5 MB limit
**When** a body larger than 64 KB arrives, signed in or not
**Then** it is refused with `413` before it is read

**Given** an OFX file whose tag names are 40 characters long
**When** it is previewed or imported
**Then** it answers within a second, either parsed or refused as unreadable, because the exponential regular expression in `ofx-js`'s `sgml2Xml` is patched or the input is checked before it reaches it

**Given** Better Auth's sign-in rate limit
**When** the server restarts
**Then** the counts survive, since they are stored in the database, and besides the per-address limit an overall ceiling on `/sign-in/email` across all addresses stops a distributed guess

**Given** the finished story
**When** `pnpm test` runs
**Then** every acceptance criterion above has an automated Vitest test

### Story 13.3: The container exposes nothing it does not need

As the household's administrator,
I want the default container and the pages it serves to be locked down,
So that my password never crosses the network in clear text and injected text cannot run script.

**Requirements:** NFR16

**Acceptance Criteria:**

**Given** the default `docker-compose.yml`
**When** it starts
**Then** it publishes `127.0.0.1:8787` only; reaching it from the home network is a documented `compose.override.yml`, and `docs/deployment.md` drops the loopback override it no longer needs

**Given** the same file
**When** the container runs
**Then** its root filesystem is read-only with a `tmpfs` on `/tmp`, it drops every Linux capability, runs with `no-new-privileges`, and only `/data` is writable; the CI `image` job still passes

**Given** any page the server sends
**When** a browser loads it
**Then** it carries a Content-Security-Policy with `script-src 'self'` plus the hash of the theme script in `index.html`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'` and `frame-ancestors 'none'`, and the interface works under it in the e2e run

**Given** `BETTER_AUTH_URL` in plain `http://` on an address that is neither loopback nor private
**When** the server starts
**Then** it logs a warning that session cookies travel unencrypted

**Given** the finished story
**When** `pnpm test`, `pnpm test:e2e` and the CI `image` job run
**Then** every acceptance criterion above has an automated test

### Story 13.4: Two-factor sign-in

As the household's administrator,
I want to protect my sign-in with a one-time code from an authenticator app,
So that a leaked password alone does not open my bank history.

**Requirements:** FR58, FR45

**Acceptance Criteria:**

**Given** « Réglages › Sécurité »
**When** I turn on two-factor sign-in after confirming my password
**Then** it shows a QR code and the secret, turns on only once I enter a valid code, and shows ten single-use backup codes once, through Better Auth's `twoFactor` plugin

**Given** two-factor sign-in is on
**When** I sign in with the right password
**Then** a second step asks for the code or a backup code; a used backup code never works again

**Given** two-factor sign-in is on
**When** I turn it off or regenerate the backup codes
**Then** it asks for my password first

**Given** a lost authenticator and lost backup codes
**When** I run `reset-password` on the server
**Then** it also turns two-factor sign-in off for that user and says so, since the server shell is the recovery path

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 13.5: Versioned images

As the household's administrator,
I want every release published as an image I can pin,
So that upgrading is a pull, and going back is choosing the previous tag.

**Requirements:** FR59, FR46

**Acceptance Criteria:**

**Given** a `vX.Y.Z` tag pushed to GitHub
**When** the release workflow runs
**Then** it runs the verification gate, builds the image for `linux/amd64` and `linux/arm64`, pushes it to `ghcr.io/leger-dosage/archant` as `X.Y.Z`, `X.Y` and `latest`, and creates a GitHub Release with generated notes; the version comes from the tag, without a commit to bump it

**Given** `docker-compose.yml`
**When** a self-hoster starts it without a checkout
**Then** it runs `ghcr.io/leger-dosage/archant:${ARCHANT_VERSION:-latest}`, and a contributor can still build from source; the CI `image` job keeps testing the image built from the pull request

**Given** « Réglages »
**When** it renders
**Then** it shows the running version, linked to its GitHub Release, and `GET /api/health` stays free of it

**Given** the finished story
**When** `pnpm test` and the CI jobs run
**Then** every acceptance criterion above has an automated test; the release workflow is checked by `actionlint` in CI

### Story 13.6: A copy before every migration

As the household's administrator,
I want the server to copy my database before it migrates it,
So that a failed upgrade never costs me my history.

**Requirements:** FR60, FR46

**Acceptance Criteria:**

**Given** a database file with at least one pending migration
**When** the server starts
**Then** before migrating it writes a consistent copy with `VACUUM INTO` to `backups/` beside the database, named after the running version and the time, keeps the five most recent, and refuses to migrate if the copy fails; with no pending migration, or a `libsql://` database, it copies nothing and says so in the log

**Given** `docs/deployment.md`
**When** a self-hoster reads « Upgrading » and « Backups »
**Then** they describe the pinned tag, `docker compose pull`, the automatic copy, and going back to the previous tag by restoring that copy with the existing restore recipe

**Given** the finished story
**When** `pnpm test` and the CI `image` job run
**Then** every acceptance criterion above has an automated test, the `image` job included: a restart onto a volume with a pending migration leaves a copy in `backups/`

### Story 13.7: Hosting at home behind Tailscale

As the household's administrator,
I want a guide that takes me from a machine at home to Archant reachable only through Tailscale and connected to my real bank,
So that I can run it on real data without guessing what I missed.

**Requirements:** FR46, FR57, FR58, FR59, FR60, NFR16

**Acceptance Criteria:**

**Given** `docs/hosting.md`
**When** a self-hoster follows it on a machine at home
**Then** it covers the hardware (an always-on machine on an SSD with its disk encrypted, not a Raspberry Pi on an SD card), Docker, joining the tailnet, `tailscale serve` giving `https://<machine>.<tailnet>.ts.net` with its certificate, `ARCHANT_URL` set to that address, the port kept on loopback, and the daily `POST /api/sync` from the host's cron; it names the certificate transparency log that makes the machine name public, and the same steps on a VPS joined to the tailnet as the fallback when home is not an option

**Given** the guide
**When** it reaches backups
**Then** it points to the `VACUUM INTO` recipe of `docs/deployment.md`, suggests copying the file to another device from time to time, and states plainly that nothing else is backed up: a dead or stolen machine loses everything since the last manual copy

**Given** the guide
**When** it lists what to keep off the machine
**Then** it names `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`, kept in a password manager apart from the backups, and says what each loss costs: every bank to reconnect, every session signed out

**Given** « Connecting a bank » in `docs/deployment.md`
**When** it covers production
**Then** it walks through registering a production application in restricted mode with « Activate by linking accounts », with the `ts.net` redirect URL, and explains that the redirect reaches Archant through the browser on the tailnet; whether Enable Banking's panel accepts a `ts.net` redirect URL is checked by the owner with a sandbox application before the guide states it, since no official source settles it

**Given** the « Other targets » section of `docs/deployment.md`
**When** it lists Cloudflare
**Then** it states why Workers with D1 does not fit, with the limits above, instead of calling it possible in principle

**Given** the finished story
**When** `pnpm lint:format` runs
**Then** every page is formatted, every internal link resolves, and the `#connecting-a-bank` anchor still exists

### Story 13.8: Sync on the first visit of the day

As the household's administrator,
I want Archant to sync my banks the first time I open it each day,
So that my accounts are current even when the machine slept through the night.

**Requirements:** FR50, NFR9

**Acceptance Criteria:**

**Given** a signed-in user, at least one active bank connection, and no sync attempt on it since the start of today in `APP_TIMEZONE`
**When** any authenticated `/api` request arrives
**Then** the server starts a sync of that connection without making the request wait, as Sure's `AutoSync` does, and a second request, from another tab or device, starts nothing more

**Given** a sync attempt today that failed, a connection whose consent has ended, or a sync already running
**When** a request arrives
**Then** no sync starts automatically until the next day; « Synchroniser » still works under the existing one-hour spacing

**Given** a sync started this way
**When** the interface is open
**Then** it shows that a sync is running, then refetches the accounts and transactions once it ends; a page left open since the day before starts the sync when it gets the focus back, since TanStack Query refetches on focus

**Given** `POST /api/sync`
**When** a host that stays on calls it
**Then** it works as before; `docs/deployment.md` « Scheduled synchronisation » and step 7 of `docs/hosting.md` present it as optional, for a host that stays on

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test, with the clock and Enable Banking mocked

### Story 13.9: The server listens on loopback unless told otherwise

As the household's administrator,
I want the server to listen on `127.0.0.1` unless I say otherwise,
So that running Archant with Node on a laptop does not show my sign-in page to everyone on the same Wi-Fi.

**Requirements:** NFR16

**Acceptance Criteria:**

**Given** no `HOST` variable
**When** the server starts with `pnpm api start:dev` or `pnpm api start`
**Then** it listens on `127.0.0.1` only, and the Vite proxy and `pnpm test:e2e` still reach it

**Given** `HOST=0.0.0.0` or another address
**When** the server starts
**Then** it listens there; the `Dockerfile` sets `HOST=0.0.0.0`, so the container still answers on its published loopback port and the CI `image` job still passes

**Given** `.env.example` and the « Variables » table of `docs/deployment.md`
**When** a self-hoster reads them
**Then** `HOST` is listed with its default and what it exposes when widened, and « A plain Node host » says to keep it on loopback behind the reverse proxy

**Given** the finished story
**When** `pnpm test` and the CI `image` job run
**Then** a test proves the default bind address and the override

### Story 13.10: A first run that says what to do

As the household's administrator,
I want the setup page and a wrong address to tell me exactly what to do,
So that my first run does not end in a log search or a raw error code.

**Requirements:** FR57, FR42

**Acceptance Criteria:**

**Given** `/setup`
**When** it asks for the setup token
**Then** its hint names where to read it: `docker compose logs archant` with the container, the terminal running the server otherwise; `docs/deployment.md` gives `docker compose logs archant | grep 'Setup is open'` right after the first `up`, since `--wait` shows no log

**Given** a browser on an address other than `BETTER_AUTH_URL`, for instance the `ts.net` address while `ARCHANT_URL` is empty
**When** sign-in, setup or an upload is refused for its origin
**Then** the interface says in French that Archant is configured for another address and to set `ARCHANT_URL` to the one in the address bar, instead of `INVALID_ORIGIN` or a bare « Forbidden »; the server logs one `warn` line naming the received origin and the expected one

**Given** `docs/hosting.md` and « Connecting a bank » in `docs/deployment.md`
**When** they reach the `ts.net` redirect URL
**Then** they state that Enable Banking accepts it for a production application, as the owner checked on 2026-09-29, instead of saying no one has confirmed it; step 5 of `docs/hosting.md` says that an empty `ARCHANT_URL` refuses every sign-in from the `ts.net` address

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test

### Story 13.11: Pick a bank in a dialog, as in Sure

As the household's administrator,
I want to pick my bank in a dialog with a search field,
So that I find it without scrolling past every bank of the country, and my connected banks stay at the top of the page.

**Requirements:** FR48

**Acceptance Criteria:**

**Given** « Réglages » › « Banques » with a country chosen
**When** the page loads
**Then** « Banques connectées » comes first, and a button opens the bank picker instead of the list sitting on the page, as Sure's `enable_banking_items/select_bank` opens in a dialog

**Given** the picker
**When** it opens
**Then** « Rechercher une banque » has the focus, the list scrolls inside the dialog at a bounded height, each bank shows its name and its BIC, an empty search says no bank matches, and Escape or « Annuler » closes it with nothing started

**Given** a bank chosen in the picker
**When** the user confirms
**Then** the consent flow starts exactly as before

**Given** the finished story
**When** `pnpm test:e2e` runs
**Then** every acceptance criterion above has an automated test, keyboard only included

### Story 13.12: A bank that sends no account currency

As the household's administrator,
I want Archant to keep the accounts a bank lists even when it gives them no usable currency,
So that connecting Boursorama links my accounts instead of none.

**Requirements:** FR49, FR50

**Acceptance Criteria:**

**Given** a `POST /sessions` account whose `currency` is `XXX`, missing, or not a currency Archant knows
**When** the bank connects
**Then** the account is kept, with the currency of the Archant account it is linked to, else `EUR`, as Sure's `EnableBankingAccount` does; the server logs one `warn` line with the connection id and the count, never the account

**Given** an account the session schema still cannot read, such as one without a `uid`
**When** the bank connects
**Then** the server logs how many accounts were dropped and which fields failed, never a value, and a connection that ends with no account says so on its page instead of an empty list

**Given** the finished story
**When** `pnpm test` runs
**Then** a test replays a session whose accounts carry `XXX`, as Boursorama's did on 2026-09-29, and every acceptance criterion above has an automated test

## Epic 14: Sure's proportions under Linear's colours

On 2026-09-29 the owner found the interface small everywhere. The code confirms it: `packages/app/src/styles.css` sets `--text-sm` and the body to 13px, the page title is 13px inside the title bar (`packages/app/src/components/Page.tsx`), buttons and inputs are 32px (`components/ui/button.tsx`, `components/ui/input.tsx`), transaction rows 36px, dialogs 384px (`components/ui/dialog.tsx`), the transaction sheet 448px, and the content is capped at 1200px without being centred. Sure keeps Tailwind's defaults: 14px body text, page titles from 20 to 30px, 36px buttons, rows near 68px, 550px dialogs and drawer, and content at full width with 40px of padding.

Epic 12 had taken Sure's content and put it in Linear's skin, sizes included. The owner asked for the reverse: Sure's pages, layouts and proportions, improved where useful, with Linear as a light layer of colours and component inspiration. A mockup, [mockups/sure-proportions-frame-and-font.html](ux-designs/ux-archant-2026-09-21/mockups/sure-proportions-frame-and-font.html), compared two frames and two fonts on the transactions page. The owner chose frame A, Sure's shell: an 84px rail of destinations, a foldable 320px accounts column, a top bar with breadcrumbs, and a bottom navigation below 1024px. They kept Inter, which reads larger than Geist at the same size and is already in place. `DESIGN.md` and `EXPERIENCE.md` in `_bmad-output/planning-artifacts/ux-designs/ux-archant-2026-09-21/`, updated on 2026-09-29, specify it; the spines win on conflict with the mocks.

Two proportions depart from Sure on purpose: transaction rows are 56px rather than 68px, so a screen still shows a useful number of them, and cards and trays keep Linear's 1px borders rather than Sure's ring shadow. Sure's per-account sparklines, the accounts column's drag resize and the AI chat panel are left out.

No route changes. Every figure is already served except one: Sure's transactions page shows the income and the expenses of the filtered rows, where Archant's list answers only their count and signed sum, so Story 14.3 adds the two sums to that response. Story 14.1 comes first; the three others can follow in any order.

### Story 14.1: The shell and the scale

As the household's administrator,
I want Archant to use Sure's frame and Sure's sizes,
So that every page reads comfortably and I find my accounts beside every page, as in Sure.

**Requirements:** UX-DR1, UX-DR3, UX-DR11, NFR13

**Acceptance Criteria:**

**Given** the theme in `packages/app/src/styles.css`
**When** this story ships
**Then** no `--text-*` token is overridden and the body is 14px, the radii are Tailwind's defaults (4, 6, 8, 12), the `container` and `inset` tokens of `DESIGN.md` replace `panel` and `section` in both modes, Linear's colours, Inter and its weights stay, and `styles.spec.ts` checks the text pairs on the new `inset` surface

**Given** the shadcn components in `packages/app/src/components/ui`
**When** they render
**Then** buttons are 36px by default, 28px small and 48px large, with a 36px square icon button; inputs and select triggers are 36px; dialogs are 550px wide by default, 300px for confirmations and 700px when a screen asks for it; menus are at least 200px; tabs sit on the grey `inset` track

**Given** any signed-in page from 1024px up
**When** it renders
**Then** it sits in Sure's shell of `DESIGN.md`: the rail with the arch logo, Accueil, Opérations, Comptes, Récurrent, Règles and Réglages, each an icon tile over its label, the current one marked with `aria-current`, and the avatar opening the user menu; the accounts column with « Ajouter un compte », tabs Tout, Actifs and Passifs, and the active accounts grouped by type with each group's total and each account's tinted type icon, subtype and balance; the sticky top bar with the button that folds the accounts column and the breadcrumbs

**Given** the button that folds the accounts column
**When** I fold or unfold it and reload
**Then** the column keeps the state I chose on this device

**Given** any signed-in page
**When** it renders
**Then** `Page.tsx` gives it Sure's page header, the title at 24px, an optional muted sentence and the page's actions, above content at full width with 40px of side padding, and the inset panel and its title bar are gone

**Given** a screen narrower than 1024px
**When** a signed-in page renders
**Then** a top bar holds the menu, the logo and the user menu, a bottom navigation holds the rail's destinations, and the menu opens the accounts column as a full-screen overlay that `Esc` closes

**Given** any settings page
**When** it renders
**Then** a 256px settings navigation replaces the accounts column, each entry with its icon, and the page's content is centred and at most 896px wide

**Given** the sign-in, setup and root error pages
**When** they render
**Then** they keep the arch logo on the base background at the new type scale and control sizes

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, including the folded column surviving a reload and the bottom navigation at a phone width, Vitest for the rest; the end-to-end tests that reached a page through the sidebar reach it through the rail or the accounts column

### Story 14.2: The dashboard and the accounts pages

As the household's administrator,
I want the dashboard and the accounts pages laid out as in Sure,
So that my net worth and my accounts read at a glance, at a comfortable size.

**Requirements:** FR5, FR34, FR35, UX-DR5

**Acceptance Criteria:**

**Given** the dashboard with at least one account
**When** it loads
**Then** its page header shows « Bonjour » and the first name at 30px, the muted sentence and « Ajouter un compte », and its cards follow in one column, two from 1536px wide

**Given** the net worth card
**When** it renders a period
**Then** it shows the value at 30px, the change with its trend arrow, the Actifs and Passifs totals and the segmented period control, above a 208px area chart that keeps the text summary and « Voir le tableau »

**Given** the month's flow card
**When** it renders a month
**Then** income, expenses and « Épargne du mois » form a summary strip with 20px figures, above the outflows donut and the categories with tinted icon, amount and share

**Given** the balance sheet card
**When** it renders
**Then** Actifs and Passifs each show their total and a 6px weight bar by account type with its legend, then their accounts in an inset group of `DESIGN.md`

**Given** the accounts page
**When** it renders
**Then** each group of accounts is an inset group with its name and total in the uppercase header and 36px tinted type icons in its rows

**Given** an account's page
**When** it renders
**Then** its page header shows the type icon, the name, the actions and the account's menu, its balance reads at 30px above the chart card, and its tabs Opérations, Soldes and Imports sit on the grey track

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 14.3: The transactions list and the drawer

As the household's administrator,
I want the transactions list and the transaction drawer laid out as in Sure,
So that I can read and sort my transactions without squinting.

**Requirements:** FR20, FR21, FR23, UX-DR4, UX-DR6, UX-DR9

**Acceptance Criteria:**

**Given** the transactions page, filtered or not
**When** it renders
**Then** a summary strip shows the count of the matching rows, their income and their expenses in 20px figures, and the list response of `GET /api/transactions` carries the two sums beside the existing count and signed sum, computed like that sum in `packages/api/src/services/transactions.ts`: in the reporting currency, with the same rows left out and counted in `skippedCount`

**Given** the list on the transactions page or an account's page
**When** it renders from 1024px up
**Then** a 36px search field and the filters open the card, an uppercase column header on the grey `inset` surface names Opération, Catégorie, Compte and Montant, and each day is an inset group whose header holds the day, the count and the day's subtotal

**Given** a transaction row
**When** it renders from 768px up
**Then** it is 56px high, with its checkbox, a 36px tinted icon or the merchant's letter, the label over its caption with its badges, the 24px category pill, the account with its 20px type icon and the amount, and it keeps the hover and selection states of `DESIGN.md`

**Given** a screen narrower than 1024px
**When** the list renders
**Then** the account column is dropped, and below 768px each row takes two lines, the label and the amount, then the date and the category

**Given** a row I open
**When** the transaction sheet opens
**Then** it is a 550px drawer on the right, inset 12px from the viewport with 12px corners, full screen below 768px, and it keeps saving on `⌘Enter` and closing on `Esc`

**Given** the bulk bar
**When** rows are selected
**Then** it uses the 36px controls of `DESIGN.md`

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest, including the income and expense sums on filtered rows and with a row in another currency

### Story 14.4: The remaining screens

As the household's administrator,
I want every other screen to match,
So that no page keeps the small sizes of before.

**Requirements:** UX-DR1, UX-DR8, UX-DR10, UX-DR11

**Acceptance Criteria:**

**Given** the recurring page, the rules page and the settings pages (banks with the Enable Banking panel, categories, merchants, tags, security)
**When** they render
**Then** their lists are inset groups of `DESIGN.md` inside cards, under the page header, at the new type scale

**Given** the import dialog and the rule dialog
**When** they open
**Then** they are 700px wide; the creation and edit dialogs are 550px, and confirmations 300px

**Given** the banners, the empty states and the badges
**When** they render
**Then** they follow `DESIGN.md`: an empty state is a card with a 36px tinted icon, a title, one sentence and one primary button

**Given** any screen of Archant
**When** it renders
**Then** no body text is set below 14px except captions and uppercase headers at 12px and the rail's labels at 11px, and no control is smaller than 28px

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 15: A healthy open-source project

On 2026-09-30 Epic 14 shipped as v0.2.0 and the owner ran it against a real bank through Enable Banking. Asked what should come next, they chose to check the project's health before adding features: open-source standards, security and performance, a clean structure, and popular maintained libraries rather than reinvented ones. Five read-only audits ran in parallel the same day on `main` at `82ceb39`; [audit-2026-09-30.md](audit-2026-09-30.md) records every finding with its evidence and the story that takes it.

The security audit found no critical or high issue and `pnpm audit --prod` no known vulnerability. One medium issue was reproduced: the global sign-in ceiling of Story 13.2 refuses the right password too, so twenty wrong attempts every ten minutes from anyone who can reach the sign-in page keep the owner out (SEC-1). The performance audit, with 100,000 transactions over ten years, found that SQLite never receives statistics: without them the transfer-candidate query scans every transaction, which makes the transactions page take 217 ms instead of 129, an account's page 146 ms instead of 16, and a 24,000-line OFX import 7.6 seconds instead of 2.5 (PERF-1). The structure audit found `services/ledger.ts` at 4,787 lines, 45 exports and 17 importers: every money story edits it, so stacked pull requests collide there (STR-1). The dependencies are few, current within a patch and compatible with AGPL-3.0; `lib/client-address.ts` rewrites what Better Auth 1.7.6 already exports (DEP-1). GitHub's community profile scores 50 %: no security policy, no protection on `main` or on release tags, secret scanning, CodeQL and Dependabot security updates off, actions pinned by tag in the job that publishes the image.

Where Sure settles a question, the story follows it: Dependabot for npm, GitHub Actions and Docker, as Sure's `.github/dependabot.yml`; a `SECURITY.md`, a `CONTRIBUTING.md` and issue templates, as Sure has them. Where GitHub or OWASP settles it, the story follows them: GitHub's community profile and immutable releases, OpenSSF Scorecard's checks, OWASP's device cookies against account lockout.

Repository settings (private vulnerability reporting, secret scanning and push protection, Dependabot security updates, CodeQL, rulesets, immutable releases, the description and topics) are changed through the GitHub API; the owner approved that exact list on 2026-09-30. The same day the owner settled the five open questions of the audit:

- the `ghcr.io/leger-dosage/archant` package goes public (OSS-1), reversing the deferral of #76; GitHub's API cannot change a package's visibility, so the owner flips it in the package settings and Story 15.3's documents assume an anonymous pull;
- the ruleset on `main` requires a pull request and every CI job, with a bypass for the owner alone, so planning and tracking commits can still reach `main` directly (OSS-3);
- one copy of the vendored agent skills stays, the other and `_bmad/config.user.toml` leave the repository (STR-5), in Story 15.7;
- the repository settings listed above are applied by the stories that need them;
- the `ofx-js` fix goes to its maintainer if the project is maintained and likely to take it, else it stays local and documented (DEP-3); `ofx-js` merged an outside contributor's pull request in May 2026 but has private vulnerability reporting off, so the fix goes as a public pull request framed as linear-time parsing of large files, the flaw being a slowdown a hostile file causes on a server that parses it.

Left out on purpose:

- moving long SQL work to a worker thread (PERF-2), until Story 15.5's fixes are measured;
- translating rule conditions to SQL (PERF-5), an action the user starts and rarely;
- a trimmed import preview (PERF-7), worth it only for imports of tens of thousands of lines;
- keyset pagination (PERF-11): page 1,000 still answers in 107 ms;
- associated data and a rotation command for the encrypted tokens (SEC-6), which only an attacker with write access to the database could exploit;
- one server and database per Playwright worker (STR-8), a large change for a 9.5-minute job;
- sending the `ofx-js` fix upstream (DEP-3), done outside the stories on 2026-09-30 as bradenmacdonald/ofx-js#14; the local patch leaves in whichever story follows the release that includes it.

Stories 15.1 to 15.3 come first: they are small and they are what a stranger sees. Stories 15.4 and 15.5 fix what the audits measured. Story 15.6 splits the ledger after 15.5, whose query changes touch it, and Story 15.7 comes last, since its clean-ups would collide with the split.

### Story 15.1: Report a vulnerability privately, protect the default branch

As a person who finds a vulnerability in Archant,
I want a private way to report it and a repository that cannot be changed behind the owner's back,
So that a fix ships before the flaw is public, and no one can push an image to every self-hoster without review.

**Requirements:** NFR18

**Acceptance Criteria:**

**Given** the repository's root
**When** this story ships
**Then** `SECURITY.md` names the supported versions (the latest minor release), asks for reports through GitHub's private vulnerability reporting and never in a public issue, states the response time, and says what a report should hold without real bank data

**Given** the owner's approval of 2026-09-30
**When** the story applies the settings through the GitHub API
**Then** private vulnerability reporting, secret scanning with push protection, Dependabot security updates and CodeQL's default setup for JavaScript, TypeScript and Actions are on, and `gh api` reads each one back as enabled

**Given** the ruleset on `main`
**When** a commit reaches `main`
**Then** it passed every job of `ci.yml`, force pushes and deletion are refused, and a pull request is required from everyone but the owner, whose bypass lets planning and tracking commits reach `main` directly

**Given** a tag matching `v*`
**When** anyone tries to move or delete it
**Then** the ruleset refuses it

**Given** the finished story
**When** it is verified
**Then** `SECURITY.md` passes `pnpm lint:format`, and the spec records the `gh api` read-back of every setting and a refused force push to `main` on a throwaway branch protected by the same ruleset

### Story 15.2: A pinned, updated and attested supply chain

As a self-hoster pulling `ghcr.io/leger-dosage/archant`,
I want every piece of the build pinned, kept current by a bot and the image attested,
So that a compromised action, base image or package manager cannot slip into the image I run, and I can check where the image came from.

**Requirements:** NFR14, NFR17

**Acceptance Criteria:**

**Given** `.github/dependabot.yml`
**When** Dependabot runs
**Then** it proposes npm updates weekly in one grouped pull request for minor and patch versions and one per major, and GitHub Actions and Docker base image updates weekly, as Sure's configuration does

**Given** `ci.yml` and `release.yml`
**When** they reference an action
**Then** it is pinned by commit SHA with its version in a comment, including `rhysd/actionlint`'s image

**Given** the `Dockerfile`
**When** it names `node:24-alpine`
**Then** the image is pinned by digest, and `package.json`'s `packageManager` carries pnpm's hash

**Given** the root `package.json`
**When** a contributor installs with an older Node
**Then** `engines.node` (`>=24`) and a `.node-version` file say which Node the project needs

**Given** the dependency ranges
**When** this story ships
**Then** every dependency uses a caret range except `ofx-js`, exact because of its local patch, and `AGENTS.md` states the rule

**Given** a `vX.Y.Z` tag
**When** `release.yml` publishes the image
**Then** it attaches an SBOM and maximal provenance to both platforms, records a build provenance attestation with `actions/attest-build-provenance`, and `docs/deployment.md` shows the `gh attestation verify` command a self-hoster runs; releases are immutable, as the owner approved

**Given** the finished story
**When** CI runs
**Then** `actionlint` passes on the pinned workflows, the `image` job builds from the pinned base, a manual dry run of `release.yml` succeeds, and the spec records `gh attestation verify` against the next published image

### Story 15.3: Welcome a contributor and a self-hoster

As a stranger who finds Archant on GitHub,
I want to understand what it does, run it, report a problem and propose a change without reading an agent guide,
So that I can use it and contribute to it on my own.

**Requirements:** NFR12, NFR18

**Acceptance Criteria:**

**Given** the repository's root and `.github/`
**When** this story ships
**Then** it holds a `CONTRIBUTING.md` written for people (setup, the gate's commands, one pull request per change, no real bank data in issues, translations welcome through i18next, `AGENTS.md` for depth), a `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), a `SUPPORT.md`, issue forms for a bug (the version from « Réglages », the deployment target, logs without amounts or IBANs) and a feature request, and a pull request template that asks the reason for any new dependency

**Given** the README
**When** a stranger reads its first screen
**Then** it states that the interface is French-only and the reporting currency EUR, shows screenshots and badges for CI, licence and latest release, clones over HTTPS, links `docs/sure-parity.md` from its feature list, and says what `_bmad-output/` holds

**Given** a release
**When** its notes are generated
**Then** `.github/release.yml` groups pull requests by label and leaves out those labelled `planning`, and `docs/deployment.md` states the versioning policy (semantic versioning; in 0.x a minor release may break), the deprecation policy (announced one minor release ahead) and that breaking changes are listed under « Before upgrading » in the notes

**Given** `docs/`
**When** a self-hoster looks for help
**Then** `docs/troubleshooting.md` covers an image pull refused with 401, a mismatched `ARCHANT_URL`, a lost setup token, an expired bank consent and a disk full during migration, and `docs/security-model.md` says what is encrypted and with which key, what leaves for Enable Banking, that there is no telemetry, what the logs hold, and that every process on the host is trusted when `TRUSTED_PROXIES` names the Docker gateway

**Given** a reference such as « AD-2 » in the code or in a lint message
**When** a contributor looks it up
**Then** it resolves in `docs/architecture.md`, the architecture spine moved from `_bmad-output/`, linked from `AGENTS.md` and `docs/index.md`, with every reference in the code still valid

**Given** the owner's approval of 2026-09-30
**When** the story applies it through the GitHub API
**Then** the repository has a one-sentence description and topics such as `self-hosted`, `personal-finance`, `psd2`, `sqlite` and `hono`

**Given** the finished story
**When** CI runs
**Then** `pnpm lint:format` passes on every new file, a Vitest spec checks that every « AD-n » cited under `packages/` and in `.oxlintrc.json` has a heading in `docs/architecture.md`, and GitHub's community profile reads 100 %

### Story 15.4: A sign-in that cannot be held hostage

As the household's administrator,
I want my own device to sign in even while someone hammers the sign-in page,
So that a stranger cannot lock me out of my finances, and the smaller findings of the audit are closed.

**Requirements:** NFR15, NFR16

**Acceptance Criteria:**

**Given** a browser that signed in successfully before
**When** the global ceiling of failed sign-ins is reached and it signs in with the right password
**Then** it is let through, because a device cookie set at its last successful sign-in, signed with an HMAC of the server secret and naming the user, exempts it from the global ceiling as OWASP's device cookies do; the per-address limit and Better Auth's own still apply to it, and a device that failed too often loses the exemption for the window

**Given** a device cookie that is missing, forged, expired or for another user
**When** the ceiling is reached
**Then** the sign-in is refused with `TOO_MANY_REQUESTS` as today

**Given** any page the server serves
**When** it answers
**Then** its Content-Security-Policy also sets `default-src 'self'`, `img-src` limited to `'self'`, `data:` and the host of the bank logos, `form-action 'self'` and `frame-src 'none'`, and the interface, the bank picker's logos and the charts still render

**Given** a database or a backup created by the server outside a container
**When** it is written
**Then** the file is readable by its owner only (`0600`) and `backups/` is `0700`

**Given** `ENABLE_BANKING_API_URL`
**When** it uses `http://` on anything but a loopback address
**Then** the server refuses to start and names the variable

**Given** a CSV file whose first line splits into more columns than a statement can hold
**When** it is previewed
**Then** the import is refused with `INVALID_IMPORT_FILE` rather than a preview of millions of columns

**Given** Enable Banking's documentation of `identification_hash`
**When** the story reads it
**Then** the spec records what the hash is; if it is an unsalted hash of the IBAN, the stored value becomes an HMAC keyed by `ENCRYPTION_KEY`, with a migration that rewrites existing rows and keeps linked accounts matched

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Vitest for the ceiling, the cookie, the headers, the file modes, the environment and the CSV cap, Playwright for a sign-in that succeeds after the ceiling is reached on a known device

### Story 15.5: Fast at ten years of history

As the household's administrator with a decade of transactions,
I want every page and import to stay quick,
So that Archant still feels immediate as my history grows.

**Requirements:** NFR9, NFR10

**Acceptance Criteria:**

**Given** a database after its migrations, and after an import of more than 1,000 lines
**When** the server runs them
**Then** it runs `PRAGMA analysis_limit=1000` and `ANALYZE`, and the transfer-candidate query's plan no longer scans `entries_kind_amount_date`

**Given** the list's count, signed sum, income and expense
**When** a page is fetched
**Then** they come from a query whose key leaves out the page, computed with a covering index on `entries(kind, currency, amount, id)` and the transfer side found once by joins rather than two correlated subqueries per row, with the same values as today

**Given** the direction filter « Dépenses »
**When** the list is fetched
**Then** its plan reads the date index and sorts only within a day, as `EXPLAIN QUERY PLAN` shows: `transactions.pending` sits between the date and the creation in the order, so no index can give the whole of it

**Given** a response of the API or an asset of the interface
**When** the browser accepts gzip
**Then** it is compressed with gzip through `hono/compress`, except Better Auth's routes, whose answers can carry a session token beside reflected input

**Given** the dashboard and an account's page
**When** the interface loads
**Then** Recharts and the account creation dialog's date picker load only when shown, and React Query keeps data fresh for 30 seconds before a window focus refetches it

**Given** SQLite's connection settings
**When** libSQL opens a connection
**Then** `cache_size` and `synchronous` are left at their defaults: both last one connection, libSQL's pool opens connections lazily with no hook, and `concurrency: 1` would refuse queries while a transaction holds the connection, as the spec's Design Notes record

**Given** NFR10's volume
**When** it is revised
**Then** it reads: with 100,000 transactions, the first page of the transaction list and an account's page answer in under 150 ms, and a 24,000-line OFX file is confirmed in under 3 seconds on a small server

**Given** the finished story
**When** `pnpm test` runs
**Then** a Vitest spec seeds 100,000 transactions in a temporary database and checks NFR10's targets with a margin for CI, another asserts the query plans above with `EXPLAIN QUERY PLAN`, and the existing sum and list tests pass unchanged

### Story 15.6: The ledger in modules

As a contributor changing how money moves,
I want the ledger split into modules by domain,
So that I can find, review and change one part without reading 4,787 lines, and two stories no longer collide in one file.

**Requirements:** NFR11

**Acceptance Criteria:**

**Given** `services/ledger.ts` and `services/rules.ts`, which import each other
**When** this story ships
**Then** the rules they share are read through a new `services/rule-reader.ts`, and madge finds no cycle under `packages/api/src`

**Given** `services/ledger.ts`
**When** this story ships
**Then** it is replaced by modules under `services/ledger/` (shared helpers, balances, accounts, bank link, entry keys, pending, ingest, rule plans, patch, edits, import revert, transfers, duplicates, filter, queries, snapshots), with no module re-exporting another, every importer importing the module it needs, and no behaviour change

**Given** the lint rule that lets only the ledger write entries (AD-2) and the 100 % branch threshold on the ledger
**When** the ledger moves
**Then** both follow it to `services/ledger/**`

**Given** `ledger.spec.ts` and `app.spec.ts`
**When** this story ships
**Then** the ledger's tests sit beside the modules they cover, and `app.spec.ts` becomes one spec per route file beside it, sharing a harness in `src/testing/`

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** they pass with the same number of tests and the same assertions as before the split, only import paths changed, and the ledger's modules keep 100 % branch coverage

### Story 15.7: Fewer home-made parts

As a contributor,
I want Archant to rely on its libraries where they already do the job, and on one copy of each helper,
So that I have less code to read and one place to fix each bug.

**Requirements:** NFR11, NFR14

**Acceptance Criteria:**

**Given** the client address the setup limit keys on
**When** this story ships
**Then** it comes from `getIP` of `better-auth/api` with the same trusted proxies, `lib/client-address.ts` keeps only what Better Auth does not do, and the same addresses map to the same keys

**Given** `pnpm api reset-password`
**When** it prompts for the password
**Then** it reads lines through `readline`'s async iterator, still masks the input and still handles two lines arriving together

**Given** the interface's code
**When** this story ships
**Then** one `FieldMessage` component replaces its nine copies; `TransactionSheet.tsx`, `RuleDialog.tsx` and `_authed.settings.banks.tsx` are split into components each under 400 lines; the constants the interface needs no longer come from Drizzle schema files, so no Drizzle code reaches the browser bundle; authentication calls go through `hooks/useAuthActions.ts`

**Given** the API's routes
**When** they validate a request
**Then** they call one `validated()` helper instead of repeating `throw validationError(...)`

**Given** month arithmetic
**When** the interface or the API adds months
**Then** both use one pure helper in `@archant/data`

**Given** the vendored agent skills
**When** this story ships
**Then** one of the identical copies under `.claude/skills` and `.agents/skills` remains, the tools that read the other find the skills they need, and `_bmad/config.user.toml` leaves the repository and is ignored

**Given** the lint and dead-code tooling
**When** the gate runs
**Then** `@shadcn/lint`'s rules are enabled or the plugin is removed, the unused `ui/card.tsx`, `ui/separator.tsx` and unused exports are gone, knip runs in the gate with Playwright's entry points and `components/ui` excluded, and `packages/data` holds `money.ts` to 100 % branch coverage

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** they pass, a Vitest spec checks that the Better Auth address keys match the former ones for IPv4, IPv6 and trusted proxies, and a build check fails if a Drizzle module lands in the interface's bundle

## Epic 16: Ask an assistant to act in Archant

On 2026-10-02 the owner reopened a subject Archant had left out: letting an AI assistant act in the application. Their first use is to ask an assistant to write rules for them, since cleaning up bank labels and categorising them takes one rule per shop. They asked for a server that runs in the API's own process, never a separate project, signed in through Better Auth if possible, following Sure's tools and choices where they hold and departing where something simpler, safer or more current exists. WebMCP, the browser API through which a page declares tools to an agent in the browser, was considered first and set aside the same day: it is an origin trial in Chrome only, renamed in May 2026, used by no mainstream agent, and it would run with the full rights of the browser's session.

MCP, the Model Context Protocol, lets an assistant call the tools a server declares. Sure serves it at `POST /mcp` since v0.6.8 (`app/controllers/mcp_controller.rb`, read on `origin/main` at `efe34c6ff`, 2 October 2026): a hand-written JSON-RPC controller, an OAuth server through Doorkeeper with dynamic client registration, one `read_write` scope, tokens that live a year, a static `MCP_API_TOKEN` fallback, and the 21 tools of its in-app chat (`Assistant.function_classes`), 14 more behind preview features. None of them touches rules. A separate Python project, `we-promise/sure-mcp-server`, wraps Sure's REST API over stdio; it came first and is no longer maintained.

Archant keeps Sure's shape, an endpoint inside the application and OAuth on its own users, and departs where Sure's weak points matter for bank data:

- The protocol comes from the official TypeScript SDK, `@modelcontextprotocol/server` 2.x, in stateless Streamable HTTP, serving the 2026-07-28 specification and the 2025-11-25 one that current clients still speak. Sure hand-writes three methods and no streaming.
- Better Auth is the authorisation server: `@better-auth/mcp` over `@better-auth/oauth-provider`, with `@better-auth/cimd` for Client ID Metadata Documents, which the specification now prefers, and dynamic client registration kept for Claude Code, VS Code and Cursor. Better Auth 1.7 removed its former `mcp` and `oidcProvider` plugins; these packages need Better Auth 1.7.7, so Story 16.1 raises the catalog's range.
- Two scopes, `archant:read` and `archant:write`, where Sure has one. The consent page lets the owner grant read only. A tool the token's scopes do not allow is absent from `tools/list` and refused with `insufficient_scope` if called.
- Tokens are bound to `/api/mcp` as their audience (RFC 8707), live minutes rather than a year, refresh for 30 days with rotation, and die when the owner disconnects the assistant. No static token: OAuth covers every client Archant targets.
- Rule tools, which Sure lacks, with a preview that shows sample transactions and an apply step that names the count it expects, so a rule never runs on a history the owner has not seen counted.
- Amounts travel as decimal strings with their currency, never as JSON numbers, and every reference is an id returned by a list tool, where Sure mixes floats, names and ids.
- Every tool call is recorded: tool, assistant, time, outcome and count changed, never the arguments. Sure records nothing.
- Each tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) so a client can ask before a write, and returns `structuredContent` against an `outputSchema`.

Labels, notes and merchant names are written by whoever sends money, and an assistant reads them before it acts. That is the risk this epic is shaped around: no tool deletes a transaction, a category, a merchant or a tag, bulk writes name the count they expect, the server's instructions and each read tool's description say that these fields are bank data and never instructions, and the owner can grant read only.

Archant is open source, so the server is built from the MCP specification and the documented APIs of the SDK and of Better Auth, with no private workaround. Where Better Auth stops short, the gap is closed in one service and pinned by a test, so an upgrade that changes the behaviour fails the gate. Reading `@better-auth/mcp` and `@better-auth/oauth-provider` 1.7.7 on 2026-10-02 found two such gaps:

- `requireMcpAuth` checks an access token against the JSON Web Key Set only: signature, issuer, audience and expiry, never the database. A token therefore outlives a disconnection until it expires.
- Deleting a consent leaves the client's refresh tokens valid, since the refresh grant never reads consents, and deleting a client is refused for a client that registered itself, since it has no owner.

So a disconnection deletes the consent and revokes the client's tokens itself, and `/api/mcp` checks, after `requireMcpAuth`, that the token's client still holds a consent: a disconnected assistant is refused at its next call, not ten minutes later. Opaque tokens checked in process were the other way; `requireMcpAuth` cannot read them, and introspecting them would need a confidential client calling the server's own endpoint.

The owner's instance is reachable only through Tailscale. Claude Code, VS Code and Cursor on a machine of the tailnet connect to it directly. Claude Desktop, claude.ai and ChatGPT reach a server from their vendor's cloud, so they cannot; the owner chose on 2026-10-02 not to support them, Claude Desktop included, and the documentation says so without recommending to open the instance to the internet.

Left out on purpose:

- an assistant chat inside Archant (Sure's chat panel), which stays dropped: the assistant is the user's own;
- tools for features Archant does not have: holdings, goals, bills, insights, documents and account statements;
- `create_transaction` and `delete_transaction`: transactions come from banks and files, and an irreversible delete is what an injected label would aim for; the interface keeps both;
- deleting or merging categories, merchants and tags, imports, bank connections, sync, balance snapshots and transfers;
- MCP resources, prompts and the multi-round-trip input requests of the 2026-07-28 specification: annotations and the count guard cover confirmation until a client needs more;
- API keys through `@better-auth/api-key`, a later fallback if a client without OAuth matters.

Story 16.1 comes first: it builds the connection with four read tools. Story 16.2, the owner's use, follows. Stories 16.3 and 16.4 can follow in either order.

### Story 16.1: Connect an assistant

As the household's administrator,
I want to connect an AI assistant to Archant by signing in, and to disconnect it whenever I choose,
So that it acts with the access I grant and nothing more.

**Requirements:** FR61, FR62, NFR3, NFR6, NFR15, NFR19

**Acceptance Criteria:**

**Given** the API
**When** this story ships
**Then** `better-auth` is at `^1.7.7` with the `jwt`, `mcp` (from `@better-auth/mcp`) and `cimd` (from `@better-auth/cimd`) plugins beside `admin` and `twoFactor`; the resource is `${BETTER_AUTH_URL}/api/mcp`, the scopes `archant:read` and `archant:write`; the tables they need are declared in `@archant/data` with snake_case columns and a migration, as AD-13 keeps Better Auth's schema; `/oauth2/create-client` and `/oauth2/update-client` are disabled

**Given** an MCP client with no token
**When** it calls `POST /api/mcp`
**Then** it gets `401` with `WWW-Authenticate` naming the protected resource metadata, and `/.well-known/oauth-protected-resource/api/mcp` and the authorisation server's metadata answer, advertising PKCE with S256, dynamic registration and Client ID Metadata Documents

**Given** Claude Code, which registers through a Client ID Metadata Document, and a client that registers dynamically
**When** the owner adds `https://<host>/api/mcp`
**Then** the browser opens `/sign-in`, then the code step when two-factor is on, then the consent page at `/oauth/consent`, and the client receives its tokens; the sign-in page carries Better Auth's signed OAuth query through both steps and follows the address Better Auth returns rather than its own `redirect`

**Given** the consent page
**When** it opens
**Then** it names the client, the host it returns to, and each requested scope in plain French, « Lire vos comptes, vos opérations et vos règles » and « Créer et modifier vos règles, classer vos opérations »; the write scope can be unticked; « Autoriser » and « Refuser » post through Better Auth's client and the page then sets `window.location`, so `form-action 'self'` stays

**Given** a token
**When** it reaches `/api/mcp`
**Then** the check `requireMcpAuth` makes, signature, issuer, audience and expiry, runs before any tool, through the helpers it is built from; a token issued for another audience, expired or revoked gets `401`; a session cookie alone gets `401`; a request carrying an `Origin` other than `BETTER_AUTH_URL`'s gets `403`, against DNS rebinding

**Given** the application's middleware
**When** a request reaches `/api/mcp`, `/api/auth/oauth2/token`, `/api/auth/oauth2/revoke` or `/.well-known/*`
**Then** `requireSession`, `csrf()` and `sameOrigin` let it through to their own checks, `compress` leaves `/api/mcp` alone, the 64 KB body limit applies, and `/.well-known/*` is answered before the interface's fallback

**Given** a valid token
**When** the client lists and calls tools
**Then** `get_accounts`, `get_categories`, `get_merchants` and `get_tags` answer, each parsing its input with Zod, calling the service function its route calls, returning `structuredContent` with an `outputSchema`, amounts as decimal strings such as `"-12.50"` with their currency, and `readOnlyHint: true`; a failing service returns `isError` with the `AppError` code and message, never a stack

**Given** an access token
**When** it is issued
**Then** it is a JWT that lives 10 minutes, the refresh token lives 30 days and rotates, and the key set is read in process through `auth.api` rather than over HTTP from the server's public name, which a host behind Tailscale may not resolve for itself; `offline_access` is granted with read, since Better Auth issues a refresh token only for it

**Given** a token that passes that check
**When** its client no longer holds the owner's consent
**Then** the call is refused with `401` before any tool runs, so a disconnection takes effect at the next call

**Given** « Réglages › Assistants IA » at `/settings/assistants`
**When** the owner opens it
**Then** it shows the address to give an assistant with a copy button and a link to `docs/deployment.md#connecting-an-assistant`, and lists each connected assistant with its name, its scopes, its connection date and its last call; « Déconnecter » asks for confirmation, then, in one database transaction, deletes its consent and revokes its refresh and access tokens, since Better Auth's consent deletion leaves the refresh tokens valid

**Given** any tool call
**When** it ends
**Then** an `assistant_calls` row records the client, the tool, the time, the outcome code and the number of rows it changed, never its arguments or its result; rows older than 90 days are deleted when a new one is written

**Given** `docs/`
**When** a self-hoster connects an assistant
**Then** `docs/deployment.md` « Connecting an assistant » gives the commands for Claude Code, VS Code and Cursor, says that Claude Desktop, claude.ai and ChatGPT connect from their vendor's cloud and are not supported, and states the scopes; `docs/hosting.md` covers the tailnet case; `docs/security-model.md` says what an assistant can read and write and that labels are text from third parties

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** Vitest covers the metadata, the `401` challenge, a wrong audience, an expired token, a token whose consent was deleted, a refresh after a disconnection, scope filtering, the `Origin` check, each tool and the call record; Playwright drives a client through dynamic registration, sign-in with two-factor, consent with write unticked, a token exchange and a `tools/list` that lists read tools only, then a disconnection from « Assistants IA » after which both the access token, before its expiry, and the refresh token are refused

### Story 16.2: Ask an assistant to write my rules

As the household's administrator,
I want to ask an assistant to look at my transactions and write the rules that clean them up,
So that I describe what I want once instead of writing one rule per shop.

**Requirements:** FR36, FR37, FR38, FR63, FR64, NFR19

**Acceptance Criteria:**

**Given** a token with `archant:read`
**When** the assistant looks for what to clean up
**Then** `get_transactions` takes the transaction list's filters (account, direction, category with `none` for uncategorised, merchant, tag, dates, amount range, text, page, `pageSize` up to 100) and returns each transaction's id, date, label, amount, currency, account, category, merchant, tags, notes, exclusion and transfer state, with the count and the income and expense of the filtered rows; `group_transactions_by_label` returns, for the same filters, up to 100 groups of identical normalised labels with their count, total, last date and the categories they carry, as Sure's « Catégoriser » flow groups uncategorised lines

**Given** a token with `archant:read`
**When** the assistant reads the rules
**Then** `get_rules` returns every rule in the order it applies, with its conditions, actions, start date and state, and `get_rule_runs` the page of past applications

**Given** a draft rule or a saved rule's id
**When** the assistant calls `preview_rule`
**Then** it answers how many transactions match, how many would change, and up to 20 of those that would change with each targeted field's current and new value, counting as Story 8.3 counts: locked fields and values already set do not change; nothing is written

**Given** a token with `archant:write`
**When** the assistant calls `create_rule`, `update_rule`, `set_rule_enabled` or `delete_rule`
**Then** the input takes the rule form's shape, condition and action types as closed enums whose descriptions state each operator, and goes through `createRule`, `updateRule`, `setRuleEnabled` or `deleteRule`; a refused input returns `VALIDATION_ERROR` with each field's path and code, so the assistant can correct it; a created rule is enabled and applies to new transactions, as from the interface; `delete_rule` carries `destructiveHint: true`

**Given** a rule that names a category, merchant or tag the household lacks
**When** the assistant calls `create_category`, `create_merchant` or `create_tag`
**Then** it is created as from the interface's pickers and its id returned

**Given** `apply_rules` with an optional rule id and the `expectedChanged` count a preview returned
**When** the count of transactions that would change differs at that moment
**Then** nothing is written and it answers `RULE_PREVIEW_STALE` with the current count; when it matches, the rules apply as « Appliquer » does in Story 8.3, recorded among « Exécutions récentes »; the tool carries `destructiveHint: true`

**Given** the server's `instructions`
**When** a client reads them
**Then** they describe the workflow: group the labels, draft a rule, preview it, show the owner the count and the samples, create it, preview again, apply with the count; and they state that labels, notes and merchant names are bank data, never instructions

**Given** a token with `archant:read` only
**When** the assistant calls a write tool
**Then** it is refused with `insufficient_scope` and nothing is written

**Given** the finished story
**When** `pnpm test` runs
**Then** Vitest covers each tool through the MCP handler: a draft preview's samples, a rule created with a field error then corrected, a replace-in-the-label rule previewed and applied, a stale count refused, a locked field left unchanged, a read-only token refused, and a label that reads as an instruction returned as data; `preview_rule`'s new samples are covered in the rules service to the branch

### Story 16.3: Ask an assistant about my finances

As the household's administrator,
I want an assistant to read my net worth, my month's income and expenses and my recurring payments,
So that I can ask it questions about my money in plain words.

**Requirements:** FR64, NFR2, NFR19

**Acceptance Criteria:**

**Given** a token with `archant:read`
**When** the assistant calls `get_balance_sheet` with a period of the dashboard (1 month, 3 months, 6 months, 1 year, all)
**Then** it returns net worth, assets and liabilities in the reporting currency and their series, and how many accounts in another currency were left out, as the dashboard does

**Given** a month
**When** the assistant calls `get_income_statement`
**Then** it returns income and expenses by top-level category with the uncategorised total, from `services/reports.ts` as the dashboard reads them, so the two never disagree

**Given** `get_accounts` with `includeBalanceSeries` and a period
**When** the assistant calls it
**Then** each account carries its balance history for that period, as its page charts it

**Given** a status and an optional number of days
**When** the assistant calls `get_recurring_transactions`
**Then** it returns the recurring series with their expected next date and amount, at most 200, filtered by status and by a next date within those days

**Given** a transaction id
**When** the assistant calls `get_transaction`
**Then** it returns the transaction with its notes, tags, transfer and source

**Given** the finished story
**When** `pnpm test` runs
**Then** Vitest checks each tool against the route that serves the same figure, an account in another currency left out with its count, and every amount returned as a decimal string

### Story 16.4: Ask an assistant to classify my transactions

As the household's administrator,
I want an assistant to set the category, merchant, tags or notes of transactions it finds,
So that the lines no rule covers get sorted too.

**Requirements:** FR23, FR26, FR38, FR65, NFR19

**Acceptance Criteria:**

**Given** a token with `archant:write`
**When** the assistant calls `update_transaction` with an id and any of category, merchant, tags, notes, label and exclusion
**Then** it goes through the same service function as the transaction sheet, with `origin: "user"` because the owner asked for it, so the fields it sets are locked against rules as an edit in the interface locks them

**Given** a token with `archant:write`
**When** the assistant calls `bulk_update_transactions` with up to 200 ids, or with the list's filters and the `expectedCount` that `get_transactions` returned
**Then** it sets category, merchant, added tags or exclusion as the bulk bar does; with filters, a count that differs at that moment writes nothing and answers `BULK_COUNT_STALE` with the current count; the tool carries `destructiveHint: true`

**Given** a token with `archant:write`
**When** the assistant calls `rename_category`, `rename_merchant` or `rename_tag`
**Then** the item is renamed as under « Réglages », and a name already taken is refused with the same field error

**Given** the finished story
**When** `pnpm test` runs
**Then** Vitest covers each tool: a field locked after an assistant's edit and left by a rule afterwards, a bulk update by ids and by filters, a stale count refused, a read-only token refused, and every write recorded in `assistant_calls` with its count

## Epic 17: Monthly budgets

On 2026-10-03 the owner chose the next six epics, 17 to 22, from the « Later, not dropped » list of `feature-inventory.md`, and asked that they follow Sure as closely as possible. Sure was read on `origin/main` at `14638a701` (2 October 2026) for all six.

Budgets come first because classification is now reliable: rules, merchants, and an assistant that classifies. Sure's budget is a month with a spending total and an expected income (`app/models/budget.rb`), one amount per category (`budget_category.rb`), statuses per category, a copy from the latest month set up, moving money between categories, and a per-category rollover of what was not spent (`budget/rollover_calculator.rb`). Archant takes all of it, with these departures, each forced by a decision already taken:

- Months are calendar months, `YYYY-MM` in the URL as the dashboard's `?month=`: Spec 6.2 left out Sure's `month_start_day`. Sure writes `oct-2026`.
- Amounts are integer minor units in the reporting currency (AD-6, NFR1); Sure's `decimal(19,4)` and its 1:1 fallback for a missing exchange rate do not exist. Accounts in another currency are left out of actual spending and named, as on the dashboard (NFR2).
- Actual spending comes from `cashFlowByCategory` and `direction()` (AD-9), never a second definition: excluded, pending and transfer lines are out, loan payments and investment contributions count as expenses, as in Sure. A category's actual is the negated signed sum of its counted lines and of its subcategories', floored at zero, so a refund lowers it, as Sure's `max(expense − income, 0)`.
- Only expense categories carry a budget amount. Archant keeps the category kind Sure removed (`sure-parity.md`, Classification); an income category's actual under Sure's formula is always zero. Expected income stays one figure for the month, as in Sure.
- Reading a month never writes. Sure creates a month's rows when its page opens (`Budget.find_or_bootstrap`); Archant creates them on the first save, so a read-only user (Epic 20) sees any month without writing.
- One household, so no `family_id`, no personal budgets and no `budget_shares` (Inventory).
- Sure's rollover takes a Postgres advisory lock; Archant computes the chain in a pure function under `domain/` and writes it in an immediate transaction (AD-1, AD-2).
- Nothing about bills or goals' « cash on hand »: Archant has no bills, and goals arrive in Epic 21 without that panel.

Story 17.1 comes first. 17.2 follows. 17.3, 17.4 and 17.5 can follow in any order.

### Story 17.1: Set up a month's budget

As the household's administrator,
I want to set what I plan to spend and earn in a month, helped by what I usually spend,
So that I see at a glance how the month is going.

**Requirements:** FR66, NFR1, NFR2, NFR12, NFR13

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `budgets (id, month, currency, budgeted_spending, expected_income, created_at, updated_at)` holds one row per month, unique on `month` (`YYYY-MM`), amounts as nullable integers in minor units, and a month is set up when `budgeted_spending` is not null, as Sure's `initialized?`

**Given** `/budgets`
**When** the owner opens it
**Then** it redirects to `/budgets/<current month>`; the month page has previous and next arrows, a month picker by year and « Aujourd'hui », and refuses a month before both the month two years before the current one and the oldest entry's month, or more than two years after the current one, as Sure's `budget_date_valid?`

**Given** a month not set up
**When** its page opens
**Then** nothing is written; the page offers « Définir le budget », a form with « Dépenses prévues » and « Revenus attendus », both required, and « Suggérer » fills each with the median of the earlier months' totals that have counted lines, as Sure's `estimated_spending` and `estimated_income`

**Given** a month set up
**When** its page opens
**Then** a donut shows actual spending by top-level expense category against the month's total, its centre « 1 234,56 € sur 2 000,00 € » with a link to edit, and a summary card shows expected income against earned and planned spending against spent, as Sure's `_budget_donut` and `_budgeted_summary`

**Given** actual spending and income
**When** they are computed
**Then** they come from `services/reports.ts` through `cashFlowByCategory` (AD-9), in the reporting currency, and an account left out for its currency is named as on the dashboard

**Given** the rail
**When** this story ships
**Then** « Budgets » appears between « Comptes » and « Récurrent », `EXPERIENCE.md` lists the surface, and `sure-parity.md`'s Budgets row says what Archant does

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 17.2: Spread the budget over categories

As the household's administrator,
I want to give each expense category its share of the month and see which ones overflow,
So that I know where to hold back.

**Requirements:** FR67, NFR1, NFR12

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `budget_categories (id, budget_id, category_id, budgeted_spending, created_at, updated_at)` is unique on `(budget_id, category_id)`, its amount an integer in minor units, deleted with its budget or its category; merging a category deletes the merged category's rows, as Sure's `dependent: :destroy`

**Given** the budget's second step, « Catégories »
**When** the owner opens it
**Then** each expense category has an amount field saved on change, with its monthly median beside it, as Sure's « /m avg »; a progress bar shows the share of the total allocated, and « Valider » stays disabled while the allocation exceeds the total

**Given** a subcategory without its own amount
**When** the budget is read
**Then** it shares its parent's budget, shown « Partagé »; a subcategory with its own amount is ring-fenced, and the parent's amount becomes the sum of its children plus its own reserve, as Sure's `budget_category.rb`

**Given** spending in no category, or in a category with no amount
**When** the month is shown
**Then** « Sans catégorie » carries what the total leaves unallocated, never stored, and spends the uncategorised outflow, as Sure's synthetic uncategorised row; a category with no amount that spent is a « Dépassé » card of its own, as Sure's `unbudgeted_with_spending?`

**Given** a category card
**When** the month is shown
**Then** it shows spent, budgeted and what remains or overflows, with a status « Dépassé », « Bientôt atteint » from 90 %, or « Dans les clous », and a filter « Toutes, Dépassées, Dans les clous », as Sure's statuses

**Given** a category card
**When** the owner opens it
**Then** a sheet shows the month's spending, the monthly average and median, the three latest transactions, and a link to `/transactions` filtered on the category and the month

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 17.3: Copy a budget and move money

As the household's administrator,
I want to start a month from the last one I set up, and to move money between categories mid-month,
So that a budget takes seconds, not a form each month.

**Requirements:** FR68

**Acceptance Criteria:**

**Given** a month not set up and an earlier month set up
**When** its page opens
**Then** it offers « Copier <mois> » and « Partir de zéro »; copying takes the latest earlier month set up, not necessarily the previous one, and copies the total, expected income and each category's amount, skipping categories since deleted, as Sure's `copy_from!`

**Given** a month already set up
**When** a copy is requested
**Then** it is refused with `BUDGET_ALREADY_SET_UP`

**Given** two categories of a month set up
**When** the owner moves an amount from one to the other
**Then** both amounts change in one transaction; moving from « Sans catégorie », between a parent and its own child, or more than the source holds is refused, as Sure's `move_allocation!`

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 17.4: Carry what is left to next month

As the household's administrator,
I want what I did not spend in a category to carry over when I choose,
So that a yearly expense such as gifts can build up over months.

**Requirements:** FR69

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `budget_categories` gains `rollover_enabled` (default false) and `rolled_over_amount` (integer, never negative)

**Given** a category with rollover on
**When** a month is set up after a month that left money in it
**Then** the surplus `max(0, budgeted + carried in − actual)` carries into the next month set up, crossing months never set up untouched; an overspent month carries nothing; turning rollover off stops the carry, as Sure's `Budget::RolloverCalculator`

**Given** a new month
**When** it is set up, by hand or by copy
**Then** each category inherits its rollover choice from the latest month set up, and changing it applies to the later months too

**Given** a change to an amount, a transaction of a past month or a rollover choice
**When** it is saved
**Then** the next read of a month shows the chain computed again by a pure function in `domain/budgets/rollover.ts`, writing nothing, and each budget write stores the whole chain in its own transaction; the ledger never recomputes it

**Given** a category card
**When** it carries money in
**Then** it shows « +<montant> reporté », and the amount counts in what remains, not in the allocation total, as in Sure

**Given** the rollover function
**When** its tests run
**Then** every branch is covered: gaps, subcategories ring-fenced or shared, a deleted category, an overspent month

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 17.5: Ask an assistant about my budget

As the household's administrator,
I want my assistant to read my budget and to set its amounts when I ask,
So that I can plan a month in conversation.

**Requirements:** FR70, NFR19

**Acceptance Criteria:**

**Given** a read token
**When** the assistant calls `get_budget` with a month
**Then** it returns that month and up to eleven earlier ones, each with its total, expected income, actual spending and income, and each category's budgeted, actual, carried amount and status among `over_budget`, `near_limit`, `on_track`, `unbudgeted` and `no_activity`, as Sure's `GetBudget`, amounts as decimal strings with their currency

**Given** a write token
**When** the assistant calls `update_budget`
**Then** it sets the total, the expected income and category amounts by category id, through the service the interface calls; « Sans catégorie » is refused, as in Sure's `UpdateBudget`; annotations `REPLACES`, the call recorded in `assistant_calls`

**Given** Epic 16's list of tools left out
**When** this story ships
**Then** budgets leave that list, and `docs/deployment.md` names the two tools

**Given** the finished story
**When** `pnpm test` runs
**Then** every acceptance criterion above has a Vitest test through the MCP handler

## Epic 18: Export all my data

The owner can take every figure out of Archant in readable files, and leave for Sure if they ever want to. Sure builds a ZIP in a background job and keeps it until deleted (`app/models/family/data_exporter.rb`, `family_export.rb`): `accounts.csv`, `transactions.csv`, `trades.csv`, `categories.csv`, `merchants.csv`, `rules.csv`, `attachments.json`, `all.ndjson` and `version.txt`. Sure imports its own `all.ndjson` back (`SureImport`).

Archant writes the same files, under the same names and columns, so that Sure's `SureImport` accepts the `all.ndjson`: leaving for Sure is the portability a self-hoster expects. Amounts therefore follow Sure's sign in the files, a purchase positive, as decimal strings; the dialog says so. Departures:

- No job, no stored archive, no list of past exports: the archive is built inside `GET /api/export` and streamed (NFR9). Sure's statuses, polling, cancel and stuck-export reaper exist only because of its queue. `/data` is the only writable directory, and an archive kept there would need a retention rule Sure never had.
- The response is a ZIP, outside the envelope, as AD-15 allows for `/api/auth/*` and `/api/mcp`; the interface downloads it through a plain link, never through `hc`. Compression leaves it alone.
- Fields come from an allowlist per table, never a whole row: Sure's `Account#as_json` leaks provider ids. No authentication table, no bank session, no key, no `identification_hash`, no `provider_uid`, no deduplication key, no raw import file.
- Archant's own fields that Sure lacks, such as locked fields, transfer kinds, dismissed recurring items and loan details, travel in `all.ndjson` under Archant names that Sure's importer ignores.
- No import of an archive: a full restore is the `VACUUM INTO` copy of `docs/deployment.md`, and Sure's own importer duplicates accounts on a second run. `docs/deployment.md` says which to use when.

Every later epic that adds a table adds its rows to the export in the same story, as Sure's exporter covers budgets, splits, trades and holdings: AD-23 records it.

### Story 18.1: Download all my data

As the household's administrator,
I want to download all my accounts, transactions and settings in one archive,
So that my data is never locked in Archant.

**Requirements:** FR71, NFR3, NFR4, NFR5, NFR9, NFR10, NFR14

**Acceptance Criteria:**

**Given** « Réglages › Données » at `/settings/data`
**When** the owner opens it
**Then** it lists what the archive holds and what it leaves out, says that amounts follow Sure's sign, and « Exporter mes données » downloads `archant_export_YYYYMMDD_HHMMSS.zip`

**Given** `GET /api/export`
**When** it answers
**Then** it streams a ZIP with `version.txt`, `accounts.csv`, `transactions.csv`, `categories.csv`, `merchants.csv`, `rules.csv` and `all.ndjson`, under Sure's names and in Sure's column order (`data_exporter.rb`), with `Content-Disposition: attachment` and no compression on top; the ZIP library is one maintained, streaming library justified in the pull request

**Given** `all.ndjson`
**When** it is written
**Then** each line is `{"type", "data"}` with Sure's types (`Account`, `Balance`, `Category`, `Tag`, `Merchant`, `RecurringTransaction`, `Transaction`, `Transfer`, `RejectedTransfer`, `Valuation`, `Rule`) and every field Sure's `SureImport::Preflight` requires, rule operands as names with a `value_ref`, as Sure; a test checks every line against a schema written from that preflight

**Given** the export
**When** it is read field by field
**Then** each table is written through an allowlist, and a test fails when a column is added to a table without being listed as exported or left out; no secret, key, token, deduplication key or raw file appears

**Given** 100,000 transactions
**When** the export runs
**Then** it streams without holding the archive in memory, and the volume project measures it under 10 seconds

**Given** `docs/deployment.md`, `docs/security-model.md` and `docs/sure-parity.md`
**When** this story ships
**Then** they say that the archive is portable, not a backup, that it holds amounts and labels in clear, and how to move to Sure with it

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 19: Split a transaction and attach receipts

A supermarket receipt mixes food and household goods; a transfer to a joint account covers rent and savings. Sure splits a transaction into child entries that sum to it (`Entry#split!`), excludes the parent from reports and counts the children everywhere (`excluding_split_parents`), and attaches up to ten files of 10 MB to a transaction (`Transaction has_many_attached :attachments`).

Archant takes that model: the parent keeps its bank figures and its deduplication keys, is excluded and locked, and its children carry the money in every balance, report, list, rule and detection. AD-20 records it. Departures:

- The foreign key from a child to its parent restricts, and the ledger deletes children first, where Sure cascades (AD-2).
- Editing a split keeps the children it keeps, by id, where Sure deletes and recreates them and loses their tags, notes and attachments silently (AD-17).
- A child is never a candidate for pairing a bank line, for a possible duplicate, or for a transfer; Sure's matcher can take a child by accident (`find_duplicate_transaction`).
- The list always groups children under their parent: Sure's `show_split_grouped` preference contradicts Archant's choice of a theme as the only preference.
- QIF split records stay unread (Spec 2.4).
- Attachments live in SQLite, as `imports.content` does, so the `VACUUM INTO` backup and a Turso database hold them; the root filesystem is read-only.
- An attachment's type is checked from its first bytes, and it is served with `Content-Disposition` and `nosniff`.

Story 19.1 comes first, then 19.2. Story 19.3 is independent.

### Story 19.1: Split a transaction in the ledger

As the household's administrator,
I want a transaction to become several lines, each with its own category and amount,
So that my reports show what I really spent on what.

**Requirements:** FR72, NFR1, NFR8, NFR11

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `entries.parent_entry_id` references `entries` with `ON DELETE RESTRICT`; `services/ledger/splits.ts` owns `splitTransaction`, `editSplit` and `unsplitTransaction`, each in one immediate transaction that recomputes balances

**Given** a transaction
**When** it is split
**Then** the children's amounts sum to the parent's exactly, in minor units, signs mixed allowed; each child copies the account, date, currency and merchant, and has its own label, amount, category, tags and notes; the parent is excluded and its `excluded` field locked with `origin: "user"` (AD-10)

**Given** a transfer side, a pending transaction, an excluded transaction, a parent or a child
**When** a split is requested
**Then** it is refused with `NOT_SPLITTABLE`, as Sure's `splittable?`

**Given** a split
**When** it is edited
**Then** children sent with their id are updated in place, others created, missing ones deleted; unsplitting deletes the children and lifts the parent's exclusion

**Given** every reader
**When** a split exists
**Then** balances, the list, its count and totals, `cashFlowByCategory`, `countsInCashFlow` and its SQL twin, rule candidates, recurring detection and transfer candidates count the children and never the parent; a rule never clears a parent's exclusion; the parity test of AD-9 covers splits

**Given** a bank or file line
**When** it is ingested
**Then** it finds a parent through its keys and writes nothing, and a child is never a pairing or duplicate candidate; a parent cannot be absorbed or merged

**Given** a parent deleted one by one, in bulk, by an import revert or with its account
**When** the ledger deletes it
**Then** its children go first in the same transaction, and its bank keys are tombstoned as today

**Given** the MCP tools and the export
**When** a split exists
**Then** `get_transactions` lists children and not parents; `update_transaction` refuses amount and exclusion changes on a parent or a child; `all.ndjson` nests `split_lines` under the parent and `transactions.csv` lists children, as Sure's exporter

**Given** the ledger's split module
**When** its tests run
**Then** every branch is covered

### Story 19.2: Split from the interface

As the household's administrator,
I want to split a transaction from its sheet and see the split in the list,
So that a mixed receipt takes a minute to sort.

**Requirements:** FR72, NFR12, NFR13

**Acceptance Criteria:**

**Given** a splittable transaction's sheet
**When** the owner chooses « Diviser »
**Then** a dialog lists lines of label, amount and category, « Ajouter une ligne », and a « Reste à répartir » counter that turns red until it reaches zero; « Diviser » stays disabled until then, as Sure's split dialog

**Given** the transactions list
**When** a split exists
**Then** the parent shows muted with a « Divisée » badge and its children indented below it, and the filters, count and totals follow the children

**Given** a parent's or a child's sheet
**When** it opens
**Then** a parent lists its children with « Modifier la division » and « Annuler la division »; a child shows its parent and edits its own label, category, tags and notes, never its date or account

**Given** the finished story
**When** `pnpm test:e2e` runs
**Then** every acceptance criterion above has a Playwright test

### Story 19.3: Attach a receipt to a transaction

As the household's administrator,
I want to attach a receipt or an invoice to a transaction,
So that I find the proof when I need it.

**Requirements:** FR73, NFR3, NFR15

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `transaction_attachments (id, transaction_id, filename, content_type, byte_size, content, created_at)` holds each file as a blob, at most 10 per transaction and 10 MB each, of JPEG, PNG, GIF, WebP or PDF, as Sure's `validate_attachments`

**Given** an upload
**When** it reaches the API
**Then** its route has its own body limit, its type is read from its first bytes and must match an allowed type, its name is cleaned, and an eleventh file or a twelve-megabyte one is refused with a field code

**Given** an attachment
**When** it is opened
**Then** it is served with its type, `Content-Disposition` naming the file, `X-Content-Type-Options: nosniff` and a `sandbox` Content-Security-Policy; images and PDFs open in a new tab, the rest download

**Given** a transaction's sheet
**When** it opens
**Then** « Pièces jointes » lists each file with its size, « Ajouter » and a delete with confirmation; a child of a split has its own attachments

**Given** a transaction deleted, its account deleted or its import reverted
**When** the ledger deletes it
**Then** its attachments go in the same transaction

**Given** the export
**When** attachments exist
**Then** `attachments.json` lists them without their content, as Sure's manifest

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 20: Share Archant read-only with the household

A second person of the household reads the accounts without being able to change them. Sure has four roles and per-account sharing; its `guest` is mostly a layout, and can still edit categories, tags and rules. Self-hosted Sure invites by a link the admin copies, since it sends no email (`invitations_controller.rb`, `settings/profiles/show.html.erb`), with a token that expires after three days.

Archant adds one role, `viewer`, which reads everything and writes nothing, as FR44 planned, and invites by link as self-hosted Sure does. AD-21 records the rules. Departures:

- One global role instead of per-account sharing: one instance is one household, and per-account sharing is dropped (Inventory).
- The viewer cannot edit categories, tags, rules or merchants, which Sure's guest can: the Inventory asked for a read-only role.
- The server refuses every write of a viewer in one middleware on the method, so a route added later is covered without thinking of it; the interface hides write controls, and the server's refusal stays the authority.
- The invitation token is stored hashed, where Sure encrypts it; the link is shown once, at creation.
- No email: the link is copied, as self-hosted Sure does, since Archant has no mail service (FR45).
- No « join with an existing account »: one instance is one household.
- A viewer cannot connect an assistant, since Sure keeps its MCP settings to admins; assistants stay the owner's.

AD-13 names a `requireRole` helper that Stories 3.1 and 3.2 never built; Story 20.1 builds it.

Story 20.1 comes first. 20.2 and 20.3 follow in order.

### Story 20.1: A read-only role, enforced by the server

As the household's administrator,
I want a `viewer` role that the server refuses every write to,
So that sharing my accounts can never cost me a change I did not make.

**Requirements:** FR74, NFR6, NFR7, NFR19

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `USER_ROLES` is `["admin", "viewer"]`, the check constraint is rebuilt by a migration without touching data, and Better Auth's `admin({ defaultRole })` is `viewer`, so a user created without a role fails closed

**Given** `requireSession`
**When** it lets a request through
**Then** the user is on the context, and `requireRole("admin")` exists as AD-13 says

**Given** a viewer's session
**When** it sends `POST`, `PUT`, `PATCH` or `DELETE` to any `/api` route behind `requireSession`
**Then** the answer is `403 FORBIDDEN` before the route runs; a spec walks every mutating route of `AppType` and fails when one answers otherwise

**Given** a viewer
**When** they read `/api/bank-connections/setup`, the assistants list or `/api/export`, or the members list once Story 20.3 adds it
**Then** those routes answer `403`; every other read answers as for the owner

**Given** a viewer
**When** they use Better Auth's own routes
**Then** they change their name, their password and two-factor sign-in, as Sure's members do

**Given** a viewer signing an assistant in
**When** the consent page opens
**Then** it refuses, and `/api/mcp` refuses a token whose user is not an admin

**Given** the first request of the day
**When** a viewer sends it
**Then** the day's bank sync starts as for the owner, as Sure's `AutoSync` runs for every member

**Given** the finished story
**When** `pnpm test` runs
**Then** every acceptance criterion above has a Vitest test

### Story 20.2: Invite someone with a link

As the household's administrator,
I want to invite a member of my household with a link I send myself,
So that they set their own password without me knowing it.

**Requirements:** FR75, NFR3, NFR15

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `invitations (id, email, role, token_hash, inviter_id, expires_at, accepted_at, created_at)` holds the SHA-256 of a 32-byte random token, expires after three days, and allows one pending invitation per email, as Sure's `invitation.rb`

**Given** the owner
**When** they invite an email as `viewer` or `admin`
**Then** the link `/invitations/<token>` is shown once with a copy button; an email that already has a user is refused

**Given** the link
**When** someone opens it
**Then** a page names who invites and the role, and asks for a name and a password; the email is the invitation's, not editable; an expired, used or unknown token answers « Cette invitation n'est plus valable. »

**Given** the acceptance
**When** it is posted
**Then** a public route, rate-limited as `/api/setup`, creates the user through `auth.api.createUser` with the invitation's role, marks the invitation accepted in the same transaction and signs them in; public sign-up stays off (FR42)

**Given** a pending invitation
**When** the owner revokes it
**Then** its link stops working

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 20.3: Members, and what a viewer sees

As the household's administrator,
I want to see who has access, change a role, and remove someone,
So that access follows the household.

**Requirements:** FR76, NFR12, NFR13

**Acceptance Criteria:**

**Given** « Réglages › Membres » at `/settings/members`
**When** the owner opens it
**Then** it lists each member with their role, each pending invitation with its expiry and « Révoquer », and « Inviter »

**Given** a member other than the owner themselves
**When** the owner changes their role or removes them
**Then** the change applies at the member's next request; removing deletes their sessions; the last admin can never be demoted or removed

**Given** a viewer signed in
**When** they browse
**Then** no control that writes is shown: no « Nouveau », « Importer », « Synchroniser », edit, delete, bulk bar, rule editor or budget form; settings show « Sécurité » only; a write the interface missed still fails on the server

**Given** `listAssistants` and `disconnectAssistant`
**When** two users exist
**Then** they read and change the signed-in user's assistants only

**Given** `docs/security-model.md` and `docs/sure-parity.md`
**When** this story ships
**Then** they say what a viewer reads and what they cannot do

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 21: Savings goals

The owner sets a target, such as a holiday or an emergency fund, and sees it fill from the accounts that hold the money. Sure's goals, still behind its preview flag, read linked accounts' balances rather than transactions (`app/models/goal.rb`): each link takes the whole balance or a fixed amount, one calculation keeps two goals from counting the same euros, and a goal reports what remains, the monthly amount needed by its date, and whether it is on track from its accounts' last 90 days. A goal can be paused, completed, archived, and a « maintained » goal is a reserve sized in months of expenses.

Archant takes that model. Departures:

- No pledges (`goal_pledge.rb`): matching a promised deposit to an incoming line would be a new step in AD-4's pipeline and a link from the ledger's rows to goals, for a reminder.
- No spending a goal (`consume!`) and no withdrawal detector: they write goal stamps on transactions, which only the ledger writes (AD-2).
- Progress reads balances only: Archant has no holdings until Epic 22, and Sure's « contributions » basis needs market flows.
- The pace is the change of the linked balances over 90 days divided by three, not Sure's net inflow of transactions: a savings account tracked by snapshots moves through valuations, which Sure's pace leaves out, and would read zero.
- No jobs: a reserve's target in months of expenses is computed when read, where Sure refreshes it monthly (NFR9).
- A goal is in its accounts' currency, as in Sure; the totals across goals keep the reporting currency and name the others (NFR2).

Story 21.1 comes first; 21.2 and 21.3 follow in either order.

### Story 21.1: Save toward a goal

As the household's administrator,
I want to set a target and a date, and link the accounts that hold the money,
So that I know how far I am and what to put aside each month.

**Requirements:** FR77, NFR1, NFR2, NFR12, NFR13

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `goals (id, name, target_amount, currency, target_date, color, icon, notes, state, kind, created_at, updated_at)` and `goal_accounts (goal_id, account_id, allocated_amount)` exist, amounts in minor units, `state` and `kind` checked from `const` arrays, `goal_accounts` deleted with its goal and by the ledger with its account

**Given** a new goal
**When** it is saved
**Then** it has a name, a positive target, at least one active depository or investment account in its currency, as Sure's `FUNDABLE_ACCOUNT_TYPES`, and each link takes the whole balance or a fixed amount; two whole-balance links on one account are refused

**Given** several goals on one account
**When** their progress is computed
**Then** fixed amounts are taken first, a whole-balance link takes what is left, fixed amounts above the balance are scaled down in proportion, and a balance at or below zero backs nothing, as Sure's `backing_share_for`, in a pure function in `domain/goals.ts`

**Given** a goal
**When** it is shown
**Then** it shows saved against target, what remains, the monthly amount needed by its date rounded up to the cent, and a status « Atteint », « Sans échéance », « En bonne voie » or « En retard » from the 90-day pace

**Given** `/goals`
**When** the owner opens it
**Then** goals show as cards with a progress ring, « Nouvel objectif » opens a dialog, and the rail shows « Objectifs »; `/goals/:id` shows a goal with each account's share

**Given** the goal function
**When** its tests run
**Then** every branch is covered

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 21.2: Follow a goal to its end

As the household's administrator,
I want to pause, complete or archive a goal and see where it is heading,
So that my goals reflect my plans as they change.

**Requirements:** FR78

**Acceptance Criteria:**

**Given** a goal
**When** the owner pauses, resumes, completes, archives, restores or reopens it
**Then** the transitions are Sure's: completing freezes the amount saved and its date, archived and completed goals release their accounts, a paused goal keeps them, and restoring is refused when another goal has meanwhile taken a whole account it used

**Given** a goal's page
**When** it opens
**Then** a chart shows its share of the linked balances over 90 days and the line to its target by its date

**Given** the dashboard
**When** goals exist
**Then** a card shows the total saved against the total target of active goals in the reporting currency, how many are behind, and up to five goals, as Sure's « Plan » card

**Given** the export
**When** goals exist
**Then** `all.ndjson` carries them and their links

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 21.3: Keep a reserve

As the household's administrator,
I want an emergency fund sized in months of expenses,
So that it follows my spending without me updating it.

**Requirements:** FR79

**Acceptance Criteria:**

**Given** a new goal
**When** the owner chooses « Réserve »
**Then** it has no date, cannot be completed, and its target is a fixed amount or a number of months of expenses, the median of the monthly expenses of AD-9 times that number, computed when read

**Given** a reserve
**When** its balance covers its target
**Then** its status is « Constituée », otherwise « Entamée », and it sorts first when entamée, as Sure's `depleted`

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

## Epic 22: Investment holdings and prices

A PEA or a brokerage account shows what it holds, at what average cost, and what it is worth today. Archant tracks investment accounts by balance snapshots only (Spec 7.2), and `project-overview.md` listed « investment portfolio tracking at parity with Sure » as a non-goal; the owner withdrew it on 2026-10-03 by choosing this epic.

Sure records trades as a third kind of entry (`Trade`: quantity, price, fee), computes one holding per security and day forward from them (`Holding::ForwardCalculator`), with a weighted average cost that leaves fees out (`CostBasisTracker`), prices each day from a provider and carries the last price over gaps (`Security::Price::Importer`), and makes an investment account's balance cash plus holdings, a snapshot setting the total and moving the cash (`balance/base_calculator.rb`). Its trade form takes buys, sells, dividends and interest; a transaction on an investment account converts to a trade.

Sure's default price provider, Twelve Data, needs a key, and its free plan leaves out Euronext Paris. Yahoo Finance, which Sure also supports, needs none, covers ten years, and on 2026-10-03 found `CW8.PA` from the ISIN `LU1681043599` with euro closes. Archant takes Yahoo through a new connector port, off until the owner turns it on, since it sends the household's securities to a third party. AD-22 records the model. Departures:

- Securities carry an ISIN, which Sure has no column for: a French household knows its funds by ISIN.
- Quantities and prices are integers at a fixed scale, never floats or decimals, with products computed exactly (AD-6, AD-22).
- A buy is negative cash (AD-5), the opposite of Sure.
- A trade's currency is its account's (AD-6); a listing in another currency is refused until conversion exists.
- Investment accounts are never linked to a bank (`LINKABLE_TYPES`), so holdings are computed forward only, never backward.
- Prices are fetched on the first visit of the day and by a button, never by a cron (NFR9).
- A security with no provider, such as a fonds euros or a unit of account that Yahoo does not list, is priced from its trades and from prices the owner types, where Sure leaves an offline security unpriced.
- An account with no trade keeps working as today: its holdings are worth zero and its snapshots are its cash.

Stories go in order, 22.1 to 22.5.

### Story 22.1: Securities and their prices

As the household's administrator,
I want Archant to know the securities I hold and fetch their prices when I allow it,
So that my portfolio is valued without typing prices.

**Requirements:** FR80, NFR3, NFR5, NFR11, NFR14, NFR20

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `securities (id, isin, ticker, mic, name, currency, provider, offline, created_at)` and `security_prices (security_id, date, price, currency, provisional, source)` exist, a price an integer at AD-22's scale, unique on `(security_id, date)`

**Given** the connector port
**When** this story ships
**Then** `connectors/prices/` declares `searchSecurities` and `dailyPrices`, and `connectors/prices/yahoo.ts` implements them with `fetch` and Zod, mapping Euronext venues as Sure's `yahoo_finance.rb` does; recorded responses serve its tests, and no test reaches Yahoo

**Given** « Réglages › Placements » at `/settings/investments`
**When** the owner turns price fetching on
**Then** the page says which host is called and that it learns the securities held; off by default, search offers manual entry only and no request leaves the server

**Given** price fetching on
**When** the first signed-in request of the day arrives, or the owner presses « Mettre à jour les cours »
**Then** each held security's prices are fetched since its last stored day, beside the request; a gap carries the last price, the last seven days are provisional and fetched again, and a security that fails five times in a row is marked offline, as Sure

**Given** a provider failure
**When** it happens
**Then** it is logged without the security's identifiers tied to amounts, and the page shows the last update

**Given** `docs/security-model.md`
**When** this story ships
**Then** it names the new host, what it learns and how to keep it off

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 22.2: Record trades

As the household's administrator,
I want to record buys and sells on an investment account,
So that Archant knows what I hold.

**Requirements:** FR81, NFR1, NFR8

**Acceptance Criteria:**

**Given** the schema
**When** this story ships
**Then** `entries.kind` admits `trade`, and `trades (entry_id, security_id, quantity, price, fee)` holds the rest, quantity signed, positive for a buy; `services/ledger/trades.ts` writes them with an `origin`

**Given** an investment account
**When** the owner adds « Achat » or « Vente » with a security, a quantity, a price and fees
**Then** the entry's amount is `−(quantity × price + fee)` rounded to the minor unit, negative for a buy (AD-5); the security comes from the search of Story 22.1 or is created offline by ISIN, name and currency; a currency other than the account's is refused

**Given** a sale
**When** it exceeds the quantity held on its date
**Then** it is refused with `QUANTITY_UNAVAILABLE`

**Given** a trade
**When** it is edited or deleted
**Then** the account's balances are recomputed from its date, as for a transaction

**Given** the export
**When** trades exist
**Then** `trades.csv` and `all.ndjson` carry them, as Sure's exporter, and `Security` lines carry the ISIN

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 22.3: Holdings and an investment account's value

As the household's administrator,
I want an investment account's value to be its cash plus what its securities are worth,
So that my net worth follows the markets.

**Requirements:** FR82, NFR1, NFR10, NFR11

**Acceptance Criteria:**

**Given** `domain/holdings/forward.ts`
**When** it runs on an account's trades and prices
**Then** it returns one holding per security and day from the first trade to today, the quantity from trades, the price from the provider, else the latest trade or typed price, carried over gaps, and a weighted average cost per share without fees, as Sure's `ForwardCalculator` and `CostBasisTracker`; every branch is covered

**Given** the schema
**When** this story ships
**Then** `holdings (account_id, security_id, date, quantity, price, amount, cost_basis)` is derived and written by the ledger only, and `balances` gains `cash`, with `balance = cash + holdings value`

**Given** an investment account
**When** a trade, a price import or a snapshot changes it
**Then** its holdings and balances are recomputed from the earliest date touched; a snapshot sets the total and the cash becomes the total less the holdings value, as Sure's `base_calculator.rb`

**Given** an investment account with no trade
**When** this story ships
**Then** its balances are unchanged: cash equals the balance, holdings are worth zero

**Given** 100,000 transactions and ten years of daily prices for twenty securities
**When** the volume project runs
**Then** a recomputation after a day's prices stays under one second

**Given** the finished story
**When** `pnpm test` runs
**Then** every acceptance criterion above has a Vitest test

### Story 22.4: See my holdings

As the household's administrator,
I want to see each security I hold with its value, its average cost and its gain,
So that I follow my portfolio in Archant.

**Requirements:** FR82, FR64, NFR12, NFR13

**Acceptance Criteria:**

**Given** an investment account's page
**When** it has trades
**Then** a « Positions » tab lists each security with its name and ticker, its weight, its « PRU », its value and quantity, and its « +/- value latente » in amount and percent, then a « Liquidités » row, as Sure's holdings table

**Given** a position
**When** the owner opens it
**Then** a sheet shows its last price and date, its trades, « Saisir un cours » for an offline security, and a cost basis the owner can set and lock, as Sure's holding drawer

**Given** a read token
**When** the assistant calls `get_holdings` with an account
**Then** it returns each position with quantities, prices and amounts as decimal strings, through the service the page calls

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest

### Story 22.5: Dividends, interest, and lines that are trades

As the household's administrator,
I want to record dividends and interest, and turn an imported line into a trade,
So that my account's history reads as my broker's.

**Requirements:** FR83

**Acceptance Criteria:**

**Given** an investment account
**When** the owner adds « Dividende » or « Intérêts »
**Then** a trade of quantity zero carries the amount, positive, on a held security or on the account's cash, as Sure's `CreateForm`, and counts as income in reports

**Given** a transaction on an investment account that is not a transfer side
**When** the owner converts it to a trade
**Then** a trade takes its date and amount, and the transaction stays as the trade's origin, excluded, locked and left out of every balance and report as a split parent is (AD-20), as Sure's convert to trade excludes it; its deduplication keys stay on it, so a re-import finds it and writes nothing

**Given** a contribution from a current account
**When** it is matched as a transfer
**Then** its inflow side stays a transaction, counted in cash (AD-11)

**Given** the finished story
**When** `pnpm test` and `pnpm test:e2e` run
**Then** every acceptance criterion above has an automated test: Playwright for what the interface shows, Vitest for the rest
