# Epic 25 Context: Choose how far back a bank's history goes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

When the owner links a bank's accounts, they choose the date the first sync reads from, as Sure does on its account setup screen, instead of a fixed three months. The owner found on 2026-10-03 that a BoursoBank history stopped three months back because the first window is a constant 90 days. Sure was read on `origin/main` at `14638a701` (2 October 2026): `sync_start_date` on `EnableBankingItem`, offered by `enable_banking_items/setup_accounts.html.erb` from two years back to today, three months by default, and read by `EnableBankingItem::Importer#determine_sync_start_date` on an account's first sync only.

## Stories

- Story 25.1: Choose the start date of the first sync

## Requirements & Constraints

- The user chooses the first sync's start date when linking a bank's accounts: up to two years back, today at the latest, three months back by default.
- The date is a request, not a promise: PSD2 guarantees 90 days, and a bank may return less than asked. Whatever the bank returns is kept, and no error is shown for a shorter history.
- An account that synced before keeps its window, its last sync minus seven days: changing the date never re-reads older history. Older history for existing accounts comes from a file import, which recognises lines a sync already brought.
- Every visible string goes through i18next in French. Keyboard-only use. A date outside the range answers `VALIDATION_ERROR` with its field.
- Every acceptance criterion has an automated test: Playwright for what the interface shows, Vitest for the rest.

## Technical Decisions

- The date belongs to the connection: `bank_connections.sync_start_date`, nullable, `YYYY-MM-DD`, as Sure's `enable_banking_items.sync_start_date`.
- The first window stays per bank account (Spec 10.3): an account never synced reads from the connection's date, or three months back when none is set, as Sure's importer, and never after its oldest pending entry. An account linked later on the same connection reads from the same date.
- A provider refusing the period with `WRONG_TRANSACTIONS_PERIOD` is asked again for 89, then 60, then 30 days, as today.
- Provider responses are parsed by Zod; no test reaches the network. Logs never hold an amount tied to an identity, an IBAN or a token.
- Roles (AD-21): linking uses a mutating method, so `viewerReadOnly` refuses it for a viewer.

## UX & Interaction Patterns

- The connection's accounts page is Sure's `setup_accounts`: each bank account skipped, created or linked, saved with « Valider ». The date field sits on that page on every visit while a bank account is left to link, as in Sure, with Sure's French label « Commencez à synchroniser les transactions à partir de » and its hint.
- Dates are typed as `15/09/2026` or picked from a French calendar whose weeks start on Monday.
