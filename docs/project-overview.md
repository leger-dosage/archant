# Project overview

## What Archant is

A personal finance application for one household, self-hosted, with automatic synchronisation of French bank accounts through Enable Banking.

## Where it comes from

[Sure](https://github.com/we-promise/sure) is a Rails application, forked from Maybe, built to be operated as a multi-tenant hosted product. It carries what that implies: PostgreSQL with enums, JSONB columns and advisory locks, Redis, a Sidekiq worker process, 53 background job classes, an administration console, invite codes and API keys.

For one household that is the wrong shape. Archant keeps the domain modelling, which is the valuable part, and drops the operational weight.

## Scope

Features are cherry-picked from Sure one at a time, and each one is scoped through BMAD before implementation. The 26 epics of `_bmad-output/planning-artifacts/epics.md` have shipped:

- Accounts by hand, with daily balance history and balance snapshots, for depository, credit card, loan, investment, property and vehicle accounts
- Loans with their terms, an amortisation schedule, an overview of what is repaid, and where the recorded balance is heading against the contract
- Investments: securities, trades, dividends and interest, and holdings with their average cost and gain, valued from daily prices the owner allows Archant to fetch
- Transaction import from CSV, QIF and OFX files, with preview, deduplication and revert
- First-launch setup, sign-in with optional two-factor, and a single container for deployment
- Members invited by a link, as administrators or read-only viewers, whose writes the server refuses
- Categories, merchants, tags and bulk edit
- Split transactions and receipts attached to a transaction
- Internal transfers, matched by hand or automatically
- A dashboard with net worth over time and monthly income and expenses by category
- A rules engine on Sure's rule model
- Monthly budgets by category, with copy, money moved between categories and carry-over
- Savings goals and reserves funded by account balances
- Bills: recurring payments detected or declared by hand, with schedules and due dates settled by the payments that match them
- An export of every figure in Sure's export format
- An AI assistant over MCP that reads the household's finances and, with the owner's consent, corrects and classifies them
- Enable Banking synchronisation: consent, account linking, a first sync reaching up to two years back, scheduled sync, pending transactions, renewal, disconnection and duplicate merging

One running instance is one household. Amounts are in euros, but every amount carries its currency code.

[sure-parity.md](sure-parity.md) compares each area with Sure: what is at parity, what differs on purpose and why, what comes later, and what has no recorded decision yet. What comes back later is listed in `_bmad-output/planning-artifacts/feature-inventory.md`.

Explicit non-goals: multi-tenancy beyond one household, a hosted offering, server-side rendering, SEO.

## Known hard parts

These are the places where the work is, and they are not the user interface.

1. **Consent expiry.** A bank consent lasts at most what the bank allows, and Archant asks for 90 days at most. Renewal is a first-class flow, warned 14 days ahead, not an error case.
2. **Pending transactions.** A pending entry becomes final, may change amount, and must not produce a duplicate. The booked line updates the pending entry in place; a pending line the bank stops listing is deleted after two syncs.
3. **Deduplication.** Two sources for the same transaction, a file import and a bank sync, must converge on one row. Keys written at import time do most of it; a tie is flagged for the user to merge or dismiss.
4. **Money.** Integer minor units and an explicit currency, everywhere. Totals use one reporting currency and leave other currencies out, with a notice, until historical exchange rates exist.
