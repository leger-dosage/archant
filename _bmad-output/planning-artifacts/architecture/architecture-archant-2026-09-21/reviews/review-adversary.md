---
reviewed: ../ARCHITECTURE-SPINE.md
lens: adversary (compliant-but-incompatible pairs)
date: '2026-09-21'
against: ../../../epics.md
---

# Adversarial review — Architecture Spine, Archant

## Verdict

The spine fixes the right seams (single ledger writer, one connector port, one cash-flow predicate), but it leaves the lifecycle of an entry after its first insert unowned: pending-to-booked replacement, merge of possible duplicates, import revert, transfer writes and the switch between forward and backward balance computation. Two developers can each obey every AD and still corrupt balances or recreate duplicates. Four findings are money-path defects that must be closed before Story 2.1; the rest can be closed before the epic that first touches them.

## Method

For each finding: two units (epics or stories) built by different developers, what each builds while obeying every AD literally, where they collide, and the rule that closes the hole. Severity reflects the damage if the pair ships: critical means wrong money or silent data loss, high means a visible inconsistency or a broken feature, medium means rework, low means friction.

## Findings

### F1 — Pending-to-booked replacement has no place in AD-4 and is blocked by AD-7 (critical)

Pair: Story 10.3 (sync ingest) and Story 10.4 (pending transactions).

- 10.3 implements AD-7 literally. An incoming booked transaction whose Enable Banking id differs from the pending one's id (common: many banks issue a new id at booking) finds no exact key. The fuzzy step only considers entries "carrying no key from this source"; the pending entry carries an `enable-banking` key, so it is not a candidate. A new entry is created. The pending one stays. Duplicate.
- 10.4 implements "same amount within 5 days" as a separate step. AD-4 lists five pipeline steps and none of them is pending replacement, so the 10.4 developer places it wherever they like: before key matching (then AD-7 has already been bypassed for that line), or after insert (then it must delete the freshly inserted entry). Both obey AD-2 as long as they sit in `ledger.ts`.
- AD-10 speaks of the "replacing entry", which implies delete-and-insert. A new entry id breaks every row that points at the old one: `transfers`, taggings, `recurring_transactions`, and the keys other sources attached through AD-7. A CSV line attached to a pending entry loses its key when the pending entry is deleted, so the next import of that CSV recreates it.
- FR51 says "even if the amount or label changed"; 10.4 says "same amount"; AD-7 uses 3 days, 10.4 uses 5. Three windows for one concept.
- "Absent from two consecutive syncs" requires a per-entry miss counter or a last-seen sync id. No column exists, and entries do not record which connection wrote them (`imports ||--o{ entries` only; AD-4's `connectionId` has nowhere to land).

Proposed rule (new AD-17, "Entry identity is stable"): an entry's id never changes after insert. The ledger exposes one primitive, `ledger.absorb(survivorId, absorbedStatementLine | absorbedEntryId)`, that updates the survivor in place (date, amount, label, `pending`, unlocked fields only), moves every key, tagging, transfer and recurring link to the survivor, and deletes the absorbed row. Pending-to-booked replacement and the "merge possible duplicate" action of 10.3 both use it. Add step 1b to AD-4: "pending reconciliation", run before AD-7 fuzzy matching, which pairs an incoming booked line with a pending entry of the same account and connection by id first, then by amount within a tolerance and date within 5 days, and absorbs it. Add `entries.last_seen_sync_id` (or `pending_miss_count`) and `entries.connection_id`. Fix one date window per concept in AD-7 and reference it from 10.4.

### F2 — The sign and meaning of a balance are undefined at the port and in storage (critical)

Pair: Story 2.2 (OFX ledger balance) and Story 1.4 / 7.1 (snapshots on a liability), then Story 10.2 (bank balance as current anchor).

- AD-5 defines the sign of entry amounts, not of `ParsedStatement.balance`. `FileSource.parse(bytes, options)` receives no account, so the OFX developer cannot know the file belongs to a liability. They emit the bank's raw `LEDGERBAL` (for example `-50000` for a card). The ledger developer stores `balance.amount` as a valuation. The card now owes `-500 €`, net worth rises by the debt instead of falling. Story 2.2's "shows the corresponding positive outstanding debt" is met by neither side, and both obey every AD.
- AD-8 does not say what `entries.amount` means for a valuation: the balance itself (Sure) or a delta. A reports developer summing `entries.amount` for a month without filtering `kind = 'transaction'` obeys AD-9 (the predicate talks about transactions, not entries) and counts every snapshot as income.
- Enable Banking returns several balance types (`CLBD` closing booked, `ITAV` interim available, `XPCD` expected, ...). AD-8 says pending transactions count in balances. If the Story 10.2 developer picks a booked balance and the balance calculator adds pending entries on top, every pending card payment is counted twice until booking.

Proposed rule (tighten AD-3, AD-5, AD-8):
- `ParsedStatement.balance.amount` uses the same convention as transaction amounts: the signed running sum from the account's point of view, negative when the account is overdrawn or owes. One ledger function, `toStoredBalance(account, signedBalance)`, converts it to the AD-5 stored form (liability: what is owed, positive). No connector negates a balance.
- A valuation's `entries.amount` is the end-of-day balance in AD-5 stored form, never a delta. Any query over `entries.amount` that means a flow joins `transactions`.
- The bank connector returns the balance type that includes pending transactions when the provider offers one (`ITBD`/`XPCD` family), else a booked balance and the connector drops pending transactions from the balance computation for that account. Record the chosen type in the connector, not in the ledger.
- `FileSource.parse` receives `{ currency, classification }` of the target account in its options.

### F3 — Transfers have two writers and no delete policy (high)

Pair: Story 5.1 (manual match, undo, reject) and Story 5.2 / AD-4 step 4 (automatic matching inside `ledger.ingest`), plus Story 1.2 (delete a transaction) and Story 1.6 (delete an account).

- AD-2 lists `entries`, `transactions`, `entry_keys`, `balances`. `transfers` and `rejected_transfers` are not in the list. The 5.2 developer writes transfers from `ledger.ts` (AD-4 puts matching inside ingest). The 5.1 developer writes them from `services/transfers.ts`, which AD-2 allows. Two writers, two validation paths: the manual one may skip "same currency" or "each transaction in at most one transfer".
- Story 1.2 deletes a transaction; Story 1.6 deletes an account with all its entries. Neither AD says what happens to a transfer whose other side lives in another account. One developer declares `ON DELETE CASCADE` on `transfers.outflow_transaction_id`, another `RESTRICT`, a third deletes explicitly. The edit case is worse: editing one side's amount so the pair is no longer opposite leaves a transfer that AD-11 would never have created, and AD-9 still hides both sides from cash flow.
- Auto-matching "only when a transaction has exactly one candidate" is evaluated from the incoming side. During one sync, accounts are ingested one after the other: if account C's inflow is ingested before account B's, C matches A's outflow even though A had two candidates. The result depends on account iteration order.

Proposed rule (extend AD-2 and AD-11): add `transfers` and `rejected_transfers` to the ledger's exclusive tables. Manual match and undo are ledger functions. Auto-match requires mutual uniqueness: the incoming transaction has exactly one candidate, and that candidate has exactly one candidate. Deleting either side, or editing its amount, account or currency, deletes the transfer in the same database transaction. Foreign keys to `transactions.entry_id` are declared `ON DELETE RESTRICT` so any bypass of the ledger fails loudly instead of cascading silently.

### F4 — AD-9 does not say which side of a transfer counts, nor how income is told from expense (high)

Pair: Story 6.2 (monthly cash flow by category) and Story 7.1 / 7.2 (loan payment and investment contribution count as expenses), plus Story 5.1 (direction filter).

- AD-9: "Transfers of kind `loan_payment` and `investment_contribution` count as expenses." Both sides are "part of a transfer". The 6.2 developer applies the predicate per transaction: the `-800` outflow from checking counts, and so does the `+800` inflow on the loan account. Summed by sign, the inflow is income; summed as a net expense, it cancels the outflow. Either way, 7.1's "counts as an expense in the monthly cash flow" fails, and the loan account is not excluded from reports.
- AD-9 decides inclusion, not direction. The 6.2 developer classifies income and expense by amount sign; the category drill-down developer (6.2, third criterion, which opens the transactions list filtered on category and month) uses the category's `income`/`expense` kind from FR27. A `+25` refund in "Groceries" is income on the dashboard and a reduction of groceries in the drill-down. The dashboard and the list disagree, which is exactly what AD-9 claims to prevent.
- Story 5.1 says transfers only appear under the "transfer" direction filter; Story 7.1 says a loan payment is an expense. The list filter and the dashboard give two answers for one row.

Proposed rule (tighten AD-9): `domain/cash-flow.ts` exports two functions, `countsInCashFlow(tx)` and `direction(tx): 'income' | 'expense' | 'transfer'`. Only the outflow side of a `loan_payment` or `investment_contribution` counts, as an expense; the inflow side never counts. Direction is the amount sign for counted transactions; the category kind is a display grouping, and a category total is the net signed sum of its transactions. The list's direction filter calls the same `direction` function, so a loan payment is listed under "expense".

### F5 — Forward versus backward computation flips on link, expiry and disconnect (high)

Pair: Story 10.2 (link a bank account to an existing file-fed account) and Story 10.5 (disconnect, expired consent), with Story 1.3 / 1.4 (forward history).

- AD-8 ties direction to "an active bank connection". Linking a file-fed account switches it to backward computation from the current anchor: its opening anchor is ignored and its whole past history is recomputed from today's bank balance. An expired consent: is the connection still "active"? One developer says yes (sync is only paused), another says no, and the history of every linked account silently changes shape when consent lapses.
- On disconnect (FR54: "accounts stay, with their history"), the account goes back to forward computation from an opening anchor that may be months stale or, for an account created by linking, set to an arbitrary value by the 10.2 developer (AD-8 requires one per account but says nothing about its amount when the bank creates the account). The history the user saw yesterday is not the history they see today. FR54 is broken while every AD is respected.
- AD-8 does not say what happens to the current anchor on disconnect.

Proposed rule (tighten AD-8): direction depends on `accounts.bank_connection_id IS NOT NULL`, not on consent status. When an account becomes linked, the ledger writes the backward-computed balance at the earliest entry date into its opening anchor. On disconnect, the ledger converts the last current anchor into a `reconciliation` valuation on its date, in the same transaction that clears `bank_connection_id`, so forward computation reproduces the same history.

### F6 — Import revert deletes data another source relies on (high)

Pair: Story 2.5 (revert an import) and Story 10.3 (sync attaches its key to a file-created entry through AD-7), plus Story 2.2 (OFX snapshot replaces the one on that date).

- 2.5 deletes "exactly the transactions it created, including ones edited since". The entry was later confirmed by the bank: Enable Banking attached `ext:<id>` to it. Revert deletes the entry and, by cascade, the bank's key. The next sync only goes back 7 days, so the transaction never returns and the backward-computed balance of the linked account is now off by its amount.
- The same revert deletes an entry that is one side of a transfer (F3) or referenced by a recurring item.
- 2.2 "replaces any snapshot on that date", which may be a snapshot the user recorded by hand. 2.5 then "deletes a snapshot it created". Revert removes the user's snapshot for good.
- The reverse also leaks: an import that only attached keys to existing entries (AD-7 fuzzy match) created nothing, so revert leaves the keys, and re-importing that file after revert reports everything as "already present" despite the user's intent to start over.

Proposed rule (new clause in AD-7): `entry_keys` gains `import_id` (nullable) and `connection_id` (nullable). Revert deletes the import's keys, then deletes an entry only if it has no key left from another source, and never deletes a valuation it did not create. An OFX balance never replaces a `reconciliation` created by the user; if one exists on that date, the import keeps the user's value and reports the gap.

### F7 — The sync route is behind the session middleware, and the sync button has no route (high)

Pair: Story 3.1 (session middleware, AD-13) and Story 10.3 (`POST /api/sync` with the secret, and a button in the interface).

- AD-13 lists the middleware's exceptions: `/api/health`, `/api/auth/*`, `/api/setup`. `/api/sync` is not among them, yet "is guarded by a constant-time comparison with `SYNC_SECRET`, not by a session". The 3.1 developer implements the list literally; the cron's call answers `401` before the secret is ever checked. This is a contradiction inside AD-13.
- FR50 wants the same sync from a button. The browser cannot hold `SYNC_SECRET`. One developer makes `/api/sync` accept either a session or the secret, another adds `/api/connections/:id/sync`. Both obey the spine.
- Nothing prevents the cron and the button from running two syncs at once. Both read "last successful sync", both fetch the same window, both ingest. SQLite serialises writes, so the second ingest either sees `ext:` keys and skips (fine) or hits `SQLITE_BUSY` on a deferred transaction upgrading to a write lock and rolls the account back with a recorded error.

Proposed rule (tighten AD-13, new clause in AD-4): add `/api/sync` to the middleware exceptions; it accepts the secret only. The button calls `POST /api/connections/:id/sync`, session-guarded, which calls the same `services/sync.ts` function. A sync takes a lease row (`bank_connections.sync_started_at`, released at the end, expired after 10 minutes); a second request for the same connection answers `409 SYNC_IN_PROGRESS`. Every ledger write transaction starts with `BEGIN IMMEDIATE`.

### F8 — Who locks a field is decided by the caller, not by the ledger (medium)

Pair: Story 4.5 / 8.3 (bulk edit and "apply rule to existing transactions", both triggered from the interface) and Story 8.4 (provider never overwrites a category set by a rule).

- AD-10: "Any change through the interface adds the field to `locked_fields`." Story 8.3 is started from the interface, so its developer locks every category the rule sets. Rules then never touch those transactions again, and a later corrected rule cannot fix them. Category merge and deletion (4.1) also move transactions "through the interface": locked or not depends on the developer.
- 8.4 must not overwrite a category "set by a rule". `locked_fields` only records user changes, so the provider developer cannot tell a rule's category from an imported one.

Proposed rule (tighten AD-10): every ledger function that changes a transaction takes an explicit `origin: 'user' | 'rule' | 'provider' | 'sync' | 'maintenance'`. Only `user` adds to `locked_fields`. Category and merchant merges are `maintenance` and preserve the lock state. Add `transactions.category_origin` (`user`, `rule`, `provider`, `null`) so 8.4 can skip rule-set categories.

### F9 — Rule action "mark as transfer" contradicts AD-11 and runs before matching (medium)

Pair: Story 8.2 (action "mark as transfer") and AD-11 / Story 5.2.

AD-11 forbids a transfer as a flag on one side; a rule acts on one transaction. The 8.2 developer either sets a flag (violates the intent of AD-11), or creates a pair by searching a counterpart at step 3 of AD-4, before the step-4 matcher, with a window of their choosing. Both are defensible readings.

Proposed rule (extend AD-11 and the Deferred note on rules): the rule action is "expect transfer". It sets `transactions.transfer_expected`, which makes the step-4 matcher accept a unique candidate on this transaction even if the other side has several, and makes AD-9 treat the transaction as `internal_move` until matched. No other code creates a transfer.

### F10 — Rows in `balances` stop at the day of the last write (medium)

Pair: Story 1.3 (recompute "from the earliest affected date to today") and Story 6.1 (daily net worth), Story 1.1 (current balance on the accounts page).

- Tomorrow, an account with no new activity has no `balances` row for tomorrow. The accounts page developer reads the row `WHERE date = today` and shows nothing. The dashboard developer carries the last row forward. Two answers for "current balance".
- French deferred-debit cards book at month end, in the future. AD-8 does not say whether a future-dated entry lands in `balances` before "today", after it, or relative to a current anchor dated today.

Proposed rule (tighten AD-8): `balances` holds one row per day up to `max(today, latest entry date)` at write time; every reader goes through one helper, `balanceOn(accountId, date)`, which returns the last row on or before `date`. Future-dated entries are included in rows after today; the current anchor is dated on the bank's reference date, and entries after it are applied forward from it.

### F11 — The fuzzy match of AD-7 depends on iteration order within one statement (medium)

Pair: Story 2.3 (CSV import) and Story 10.3 (sync on an account fed by files).

Two identical `-3,50` coffees on consecutive days exist from a CSV. The sync brings both. For the first incoming line there are two candidates, so a new entry is created and flagged; the same for the second. Result: four entries. Had the lines been matched jointly, each would have found its own counterpart at date distance 0. Reordering the statement changes the outcome, so two connectors emitting lines in different orders build different ledgers.

Proposed rule (tighten AD-7): fuzzy matching is done per statement as an assignment, not line by line. Sort incoming lines and candidates by `(amount, date)`, pair each incoming line with the candidate at the smallest date distance within 3 days, ties broken by candidate creation time; flag `possible_duplicate` only when a tie remains. Use the entry's amount as stored at ingest (kept in `entry_keys` or a `original_amount` column), not the amount the user may have edited since.

### F12 — Currency of an incoming line is ambiguous for card payments abroad (medium)

Pair: Story 10.3 (Enable Banking connector) and AD-6 in the ledger.

Enable Banking returns the booked amount in the account's currency and, for a purchase in dollars, the original instructed amount. The connector developer who fills `currency` with the original currency obeys AD-3; the ledger refuses the line per AD-6; NFR8 rolls back the whole account; every following sync fails on the same line.

Proposed rule (tighten AD-3): `NormalizedTransaction.amount` and `currency` are always the amount booked on the account, in the account's currency. An original foreign amount goes into an optional `originalAmount: Money | null`, stored but never summed.

### F13 — Preview and confirm have no defined handover (medium)

Pair: Story 2.1 (preview then confirm) and Story 2.3 (CSV mapping changed on the preview screen).

AD-4 offers `dryRun`, which implies confirm re-runs the ingest. Where the file bytes live between the two calls is unspecified: one developer asks the browser to upload twice, another stores the bytes in a table, a third in a temporary directory that the container's volume does not persist. A sync between preview and confirm makes confirm write a different set than the one shown.

Proposed rule (extend AD-4): the preview stores the file bytes and parse options in `imports` with status `previewed` and returns its id; confirm takes that id, re-runs `ingest` without `dryRun`, and answers `409 IMPORT_PREVIEW_STALE` if the counts differ from the preview. Previewed imports older than 24 hours are purged at start.

### F14 — Two date extractions from the same OFX timestamp (low)

Pair: Story 2.1 (OFX parser, `DTPOSTED`) and Story 2.2 (`DTASOF` for the snapshot).

`20260930220000[-5:EST]` is 30 September in the bank's zone, 1 October in UTC and in `Europe/Paris`. Each parser developer picks a conversion; the snapshot lands one day off from the transactions it closes, and the reconciliation then disagrees with the computed balance by that day's activity.

Proposed rule (extend the Dates convention): a calendar date taken from a provider is its literal date part, never converted through a time zone. One helper, `domain/provider-date.ts`, does the extraction for every connector.

### F15 — Reporting currency has no home (low)

AD-6 and Story 6.1 speak of a reporting currency, EUR, but no setting or variable holds it. The dashboard developer hardcodes `'EUR'`, which NFR2 forbids, or invents a setting. Proposed rule: `settings.reporting_currency`, default `EUR`, read through one helper in `services/reports.ts`.

## Rules that are unenforceable or contradict another

| Rule | Problem | Fix |
| --- | --- | --- |
| AD-13, middleware exceptions | `/api/sync` is session-guarded by the exception list and secret-guarded by the next sentence. | F7. |
| AD-13, setup "inside a transaction that finds zero users" | Public sign-up is disabled, so Better Auth's `signUpEmail` refuses the setup call; and Better Auth writes through its own adapter, so the zero-user check and the insert are not in one database transaction. Two concurrent setup requests can both pass the check. | Create the user through Better Auth's internal adapter from `services/setup.ts`, and make the guard a unique row (`settings` key `setup_completed_at`, inserted first in the same Drizzle transaction) rather than a count. |
| AD-6, exponent "from `Intl`" | `Intl` gives display digits, which vary with the ICU version shipped by Node and by each browser. `@archant/data` is isomorphic, so the API and the interface can disagree on a currency's exponent. | A static ISO 4217 minor-unit table in `money.ts`. |
| AD-14, pino `redact` with `*.amount` | pino's `*` matches one level only; `err.response.data.amount` or `statement.transactions[0].label` is logged in clear. The rule looks enforced and is not. | Never log provider payloads or statement objects at all; log only ids and counts, and add a test that serialises a representative error and greps for amounts and IBAN patterns. |
| AD-14, "session ids are encrypted" | Read literally, it covers Better Auth's sessions, whose storage NFR6 says to leave at defaults. | Say "Enable Banking session ids". |
| AD-1, "a route calls exactly one service function" | Import confirm must run recurring detection after commit (AD-4); if the route calls it, that is two calls; if the service does, a post-commit failure turns a committed import into a `500`. | Post-commit work is called by the service, wrapped so its failure is logged and never fails the request. |
| AD-2 versus Story 1.6 | Deleting an account deletes its entries. If it relies on `ON DELETE CASCADE`, the database writes `entries` outside the ledger; if the ledger does it, AD-2 holds but `accounts` has no owner. | Declare in AD-2 that account deletion is a ledger function, and make every foreign key onto `entries` and `transactions` `RESTRICT` (see F3). |
| AD-9 versus Story 5.1 | Direction filter "transfers only under transfer" contradicts loan payments counting as expenses. | F4. |

## Order of work

Close F1, F2, F3 and F4 before Story 2.1: they change the columns of `entries`, `entry_keys` and `transfers`, and the shape of `ParsedStatement`. F7 and the setup clause before Story 3.1. F5, F6, F10, F11, F12 before Epic 10. F8 and F9 when the rules model is designed.
