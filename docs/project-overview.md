# Project overview

## What Archant is

A personal finance application for one household, self-hosted, with automatic synchronisation of French bank accounts through Enable Banking.

## Where it comes from

[Sure](https://github.com/we-promise/sure) is a Rails application, forked from Maybe, built to be operated as a multi-tenant hosted product. It carries what that implies: PostgreSQL with enums, JSONB columns and advisory locks, Redis, a Sidekiq worker process, 53 background job classes, an administration console, invite codes and API keys.

For one household that is the wrong shape. Archant keeps the domain modelling, which is the valuable part, and drops the operational weight.

## Scope

Features are cherry-picked from Sure one at a time, and each one is scoped through BMAD before implementation. Nothing below is committed until its spec exists.

Early scope, in build order, is kept in `_bmad-output/planning-artifacts/feature-inventory.md`:

- Accounts and balances, with history
- Transaction import from CSV, QIF and OFX files
- Categories, internal transfers, and a rules engine for automatic categorisation
- Dashboard and charts
- Enable Banking synchronisation, behind a connector interface that other providers can implement

One running instance is one household. Amounts are in euros, but every amount carries its currency code.

Explicit non-goals: multi-tenancy beyond one household, a hosted offering, investment portfolio tracking at parity with Sure, server-side rendering, SEO.

## Known hard parts

These are the places where the work is, and they are not the user interface.

1. **Consent expiry.** A PSD2 consent lasts 90 to 180 days. Re-authentication is a first-class flow, not an error case.
2. **Pending transactions.** A pending entry becomes final, changes amount, and must not produce a duplicate. Sure documents this at length for each provider; the same care applies here.
3. **Deduplication.** Two sources for the same transaction, a file import and an API sync, must converge on one row.
4. **Money.** Integer minor units and an explicit currency, everywhere, with historical rates for reporting.
