# Epic 10 Context: Enable Banking synchronisation

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Accounts update themselves every day from the bank, so the user never imports a file again, and they converge with the history already imported from files instead of duplicating it. The user connects a bank through Enable Banking (PSD2 consent), links each bank account to a new or an existing account, and syncs daily from a cron and on demand from the interface. Pending card payments show up at once and turn into their booked version without a duplicate. The user is warned before consent expires, can renew it or disconnect, and never loses history. Enable Banking is the only bank connector and plugs into the connector port and ingestion pipeline built for file imports; the ledger does not change to accommodate it.

## Stories

- Story 10.1: Connect a bank
- Story 10.2: Link bank accounts
- Story 10.3: Sync transactions and balances
- Story 10.4: Pending transactions
- Story 10.5: Consent renewal and disconnection
- Story 10.6: Merge or dismiss a possible duplicate

## Requirements & Constraints

- Connecting: choose a country (France by default) and a bank from the Enable Banking list, get sent to the bank's consent page, return through a callback that checks `state` and stores the session id and its expiry, encrypted at rest. When `ENABLE_BANKING_APPLICATION_ID` or `ENABLE_BANKING_PRIVATE_KEY` is missing, the page names the variables to set and the rest of the app keeps working.
- Linking: each bank account shows name, masked IBAN and currency; the user skips it, creates a new account, or links it to an existing account of a compatible type, for instance one fed by files. A linked account takes the bank balance as its reference and computes history backward from it.
- Sync fetches balances and transactions since the last successful sync minus 7 days of overlap. It runs from `POST /api/sync` (bearer `SYNC_SECRET`, `401` and no work otherwise) and from a button calling `POST /api/bank-connections/:id/sync` with the session. It runs inside the request: no queue, no broker.
- Sync is atomic per account: a failed account rolls back, others still sync, and the connection records its error. Each connection shows its last successful sync and last error.
- File and bank convergence: a synced line with no key match attaches to the existing entry of the same amount at the nearest date within 3 days that carries no Enable Banking key; no candidate creates it; a tie creates it flagged as a possible duplicate the user can merge or dismiss.
- Pending: stored as pending, shown with a marker, counted in balances, left out of cash flow. Its booked version updates it in place, keeping id, links and user-set fields, matched on the same `entry_reference` (amount may differ), else same amount within 5 days. A pending entry absent from two consecutive syncs and not booked is deleted.
- Consent: a banner warns when consent expires within 14 days; renewal keeps linked accounts and history. An expired connection is skipped with status "consent expired", nothing deleted. A banner warns when the last successful sync is older than 48 hours. Disconnect revokes the session at Enable Banking, deletes stored secrets, and keeps the accounts as manual accounts with unchanged history.
- Security: every provider response is parsed by Zod. Tokens and session ids are encrypted, never logged, never returned. Logs and errors never contain an amount tied to an identity, an IBAN or a token.
- Tests use recorded, anonymised fixtures and never reach the network. `domain/**`, `services/ledger.ts` and `connectors/**` are covered to 100% of branches. Every acceptance criterion has an automated test: Playwright for the interface, Vitest for the rest.

## Technical Decisions

- The connector lives in `connectors/enable-banking/`, id `enable-banking` (also `entry_keys.source`), registered in `connectors/registry.ts`. It implements `BankConnector { id; listInstitutions; startAuthorization; completeAuthorization; revokeAuthorization; listAccounts; fetchStatement(accountRef, since); consentExpiresAt }`, returns a `ParsedStatement`, and never touches the database. `listAccounts` returns `identification_hash` as a stable identity that survives renewal.
- Mapping: `externalId` is `entry_reference`, never `transaction_id`; without it only the fingerprint key applies. Sign from `credit_debit_indicator` (`DBIT` negative). `PDNG` is pending, `BOOK` booked, any other status dropped. Date is `booking_date`, else `value_date`, else `transaction_date`, taken as the literal date part through `domain/provider-date.ts`. The current anchor balance is `ITBD`, else `CLBD`. No connector negates a balance; the ledger's `toStoredBalance` converts it.
- `services/sync.ts` serves both sync routes and calls `ledger.ingest(accountId, statement, { connectionId })` per account. Only `services/ledger.ts` writes money tables. Pending reconciliation is step 3 of the pipeline and uses `ledger.absorb`, which keeps the survivor's id and moves keys, taggings, transfers and recurring links; `transactions.pending_missed_syncs` counts misses. Ledger calls from sync use a non-user origin, so they never overwrite `locked_fields`.
- Balances: an account with `bank_account_id` (a row of `bank_accounts`, which belongs to a connection) computes backward from its `current_anchor` valuation, rewritten by each sync. Disconnect turns the last `current_anchor` into a `reconciliation` and clears `bank_account_id` in one ledger transaction.
- Concurrency and quota: a lease on `bank_connections.sync_started_at` expires after 10 minutes; a concurrent sync answers `409 SYNC_IN_PROGRESS`. Two syncs of one connection are at least one hour apart, except right after a consent renewal.
- Auth: `/api/sync` sits outside the session guard and accepts only `Authorization: Bearer <SYNC_SECRET>`, compared in constant time. Mutating routes use `csrf()`.
- Secrets: AES-256-GCM through `services/crypto.ts`, key from `ENCRYPTION_KEY`, stored as `v1:<iv>:<tag>:<ciphertext>`. IBAN stored masked, last four characters only. Pino logs carry ids, counts, durations and error codes only; connectors throw sanitised `AppError`s. The JWT is RS256 signed with `jose`, key loaded through `crypto.createPrivateKey` so PKCS#1 and PKCS#8 both work.
- Recurring detection runs after the sync's ingestion commits, called by the service; its failure is logged and never fails the sync.
- End-to-end tests point `ENABLE_BANKING_API_URL` at a local fake server. Vitest uses msw with recorded fixtures.
- API conventions as elsewhere: `{ data }` / `{ error }` envelope, closed `AppError` union, request schemas in `packages/api/src/schemas/`, one service call per route, timestamps as epoch milliseconds, ids as text UUID v4, enumerations as `text` columns with a check constraint from a `const` array in `@archant/data`.

## UX & Interaction Patterns

- Bank connections live under settings, `/settings/...`, in a Banques section.
- Banners: a full-width warning strip above page content with an icon, one sentence and one action, dismissible for the session only. Three cases: consent expiring within 14 days (Renouveler), consent expired (Reconnecter), last sync older than 48 hours (Voir la connexion). Warning colour is reserved for these and possible duplicates. Wording names the bank and date, for example « Le consentement de BoursoBank expire le 12 octobre. »
- Renewal flow: banner, bank consent, back on the connection page with linked accounts unchanged; « Synchroniser » runs once and the connection shows « Dernière synchronisation : à l'instant ».
- Sync in progress: spinner on the connection's sync button; a second click is refused with « Synchronisation déjà en cours. »
- Pending rows: muted amount through `<Money>` plus an outline « En attente » badge, never colour alone; the row sorts at the top of its day. Possible duplicates show a warning icon and « Doublon possible », with « Fusionner avec… » and « Ce n'est pas un doublon » in the sheet. The transaction sheet names the source « Enable Banking ».
- Every string goes through `locales/fr.json`: vouvoiement, infinitive-verb buttons, no exclamation marks. Errors are toasts translated from `errors.<CODE>`. Keyboard reach, visible focus, `Esc` returns focus, 24 px targets, WCAG 2.2 AA.

## Cross-Story Dependencies

- Builds on Epic 2's connector port, ingestion pipeline, dedup keys and the `possible_duplicate` flag (no merge action exists yet), Epic 3's auth guard, Epic 8's rules (step 5), Epic 5's transfer matching (step 6), and Epic 9's post-commit recurring detection.
- 10.1 creates `bank_connections`, the crypto service, the env variables and the Enable Banking client. 10.2 needs a connection to list accounts and introduces `bank_accounts`, `accounts.bank_account_id` and backward balance computation. 10.3 needs linked accounts and adds both sync routes, the lease and the connection status. 10.4 extends 10.3's sync with pending reconciliation. 10.5 needs 10.1's consent flow for renewal and 10.3's last-sync time for the stale banner. 10.6 reuses 10.4's `ledger.absorb` for the merge and adds the « Doublon possible » marker and the dismiss action.
