# Project overview

## What Archant is

A personal finance application for one household, self-hosted, with automatic synchronisation of French bank accounts through Enable Banking.

## Where it comes from

[Sure](https://github.com/we-promise/sure) is a Rails application, forked from Maybe, built to be operated as a multi-tenant hosted product. It carries what that implies: PostgreSQL with enums, JSONB columns and advisory locks, Redis, a Sidekiq worker process, 53 background job classes, an administration console, invite codes and API keys.

For one household that is the wrong shape. Archant keeps the domain modelling, which is the valuable part, and drops the operational weight.

## Scope

Features are cherry-picked from Sure one at a time, and each one is scoped through BMAD before implementation. The ten epics of `_bmad-output/planning-artifacts/epics.md` have shipped:

- Accounts by hand, with daily balance history and balance snapshots, for depository, credit card, loan, investment (valued by snapshots, without holdings), property and vehicle accounts
- Transaction import from CSV, QIF and OFX files, with preview, deduplication and revert
- First-launch setup, sign-in, and a single container for deployment
- Categories, merchants, tags and bulk edit
- Internal transfers, matched by hand or automatically
- A dashboard with net worth over time and monthly income and expenses by category
- A rules engine on Sure's rule model
- Recurring transaction detection and a page listing them
- Enable Banking synchronisation: consent, account linking, scheduled sync, pending transactions, renewal, disconnection and duplicate merging

One running instance is one household. Amounts are in euros, but every amount carries its currency code.

[sure-parity.md](sure-parity.md) compares each area with Sure: what is at parity, what differs on purpose and why, what comes later, and what has no recorded decision yet. What comes back later is listed in `_bmad-output/planning-artifacts/feature-inventory.md`.

Explicit non-goals: multi-tenancy beyond one household, a hosted offering, investment portfolio tracking at parity with Sure, server-side rendering, SEO.

## Known hard parts

These are the places where the work is, and they are not the user interface.

1. **Consent expiry.** A bank consent lasts at most what the bank allows, and Archant asks for 90 days at most. Renewal is a first-class flow, warned 14 days ahead, not an error case.
2. **Pending transactions.** A pending entry becomes final, may change amount, and must not produce a duplicate. The booked line updates the pending entry in place; a pending line the bank stops listing is deleted after two syncs.
3. **Deduplication.** Two sources for the same transaction, a file import and a bank sync, must converge on one row. Keys written at import time do most of it; a tie is flagged for the user to merge or dismiss.
4. **Money.** Integer minor units and an explicit currency, everywhere. Totals use one reporting currency and leave other currencies out, with a notice, until historical exchange rates exist.
