# Epic 15 Context: A healthy open-source project

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

After v0.2.0 ran against a real bank, the owner chose project health over new features. Five read-only audits of `main` at `82ceb39` (recorded with evidence and ids such as SEC-1 or PERF-1 in `_bmad-output/planning-artifacts/audit-2026-09-30.md`) drive this epic. A stranger must be able to trust, install and contribute to Archant: a private vulnerability channel, a protected default branch, a pinned and attested supply chain, documents written for people. The owner's instance must stay fast and impossible to lock: the global sign-in ceiling that also refuses the right password is fixed, SQLite gets the statistics and indexes a decade of history needs, and the 4,787-line ledger is split into modules a contributor can read. Where Sure settles a question (Dependabot, `SECURITY.md`, `CONTRIBUTING.md`, issue templates), the story follows Sure; where GitHub, OpenSSF Scorecard or OWASP settle it, the story follows them.

## Stories

- Story 15.1: Report a vulnerability privately, protect the default branch
- Story 15.2: A pinned, updated and attested supply chain
- Story 15.3: Welcome a contributor and a self-hoster
- Story 15.4: A sign-in that cannot be held hostage
- Story 15.5: Fast at ten years of history
- Story 15.6: The ledger in modules
- Story 15.7: Fewer home-made parts

## Requirements & Constraints

- Supply chain: actions pinned by commit SHA with the version in a comment, base images by digest, pnpm by hash in `packageManager`; Dependabot keeps npm, Actions and Docker current; every release image carries an SBOM, maximal provenance and a build provenance attestation; releases are immutable.
- Repository security: private vulnerability reporting, secret scanning with push protection, Dependabot security updates and CodeQL default setup are on; rulesets protect `main` (every CI job required, pull request required, no force push or deletion, owner-only bypass) and refuse moving or deleting `v*` tags.
- Performance target, revised: with 100,000 transactions, the first page of the transaction list and an account's page answer in under 150 ms, and a 24,000-line OFX file is confirmed in under 3 seconds on a small server. A Vitest spec checks it with a margin for CI.
- The whole application stays one process with no queue or broker; moving SQL work to a worker thread is deferred until the query fixes are measured.
- Sign-in hardening must keep the per-address limit and Better Auth's own limits intact; only a known device is exempt from the global ceiling, and a forged, expired, missing or other-user cookie still gets `TOO_MANY_REQUESTS`.
- Refactors change no behaviour: the split keeps the same number of tests and assertions, and the ledger keeps 100 % branch coverage.
- Dependencies stay few and popular; each new one is justified in its pull request. Every range is a caret except `ofx-js`, exact because of its local patch.
- Interface text stays French-first through i18next; documents, comments and error messages stay in English.
- Every acceptance criterion has an automated test, or a recorded read-back (`gh api`, `gh attestation verify`) where the criterion is a GitHub setting.
- Out of scope on purpose: worker threads, rule conditions in SQL, a trimmed import preview, keyset pagination, associated data and key rotation for encrypted tokens, one server per Playwright worker, sending the `ofx-js` fix upstream (already opened as bradenmacdonald/ofx-js#14).

## Technical Decisions

- GitHub repository settings, rulesets, description and topics are changed through the GitHub API; the owner approved that exact list on 2026-09-30. Making the `ghcr.io/leger-dosage/archant` package public is the owner's manual step; documents assume an anonymous pull works.
- Known-device exemption follows OWASP's device cookies: a cookie set at each successful sign-in, signed with an HMAC of the server secret and naming the user, checked by the global ceiling; a device that fails too often loses the exemption for the window.
- SQLite runs `PRAGMA analysis_limit=1000` then `ANALYZE` after migrations and after an import of more than 1,000 lines. List totals come from a query whose key omits the page, backed by a covering index on `entries(kind, currency, amount, id)`, with the transfer side found by joins instead of correlated subqueries. The expense filter must use the date index without a temporary B-tree sort. Plans are asserted with `EXPLAIN QUERY PLAN`. Connections get a 64 MB `cache_size` and `synchronous=NORMAL` under WAL, or the spec records why libSQL's pool cannot.
- AD-2, the ledger as the single writer of entries, transactions, keys, balances and transfers, still holds after the split: its lint override and the 100 % branch threshold move to `services/ledger/**`. No module re-exports another; importers import the module they need directly (no barrel files). `ledger` and `rules` stop importing each other through a read-only `services/rule-reader.ts`; madge finds no cycle.
- The architecture spine moves from `_bmad-output/` to `docs/architecture.md`, linked from `AGENTS.md` and `docs/index.md`, so every « AD-n » cited in code and in `.oxlintrc.json` resolves; a Vitest spec enforces it.
- Prefer the library over home-made code: `getIP` from `better-auth/api` for client addresses (same keys for IPv4, IPv6 and trusted proxies), `readline`'s async iterator for the password prompt, one `validated()` route helper, one `FieldMessage` component, month arithmetic in `@archant/data`. No Drizzle module may reach the browser bundle.
- Editing the theme script in `packages/app/index.html` or widening the Content-Security-Policy means updating `packages/api/src/lib/content-security-policy.ts`; `img-src` must allow the bank logos' host.

## Cross-Story Dependencies

- Stories 15.1 to 15.3 come first: small, and what a stranger sees. The ruleset of 15.1 requires every `ci.yml` job, so later stories, and 15.7's knip gate, must keep CI green through pull requests.
- 15.2's `docs/deployment.md` attestation section and 15.3's versioning, deprecation and troubleshooting sections edit the same file.
- 15.3 moves the architecture spine; later stories cite AD numbers from `docs/architecture.md`.
- 15.4 and 15.5 fix what the audits measured and can run in either order.
- 15.6 splits the ledger after 15.5, whose query changes touch `services/ledger.ts`.
- 15.7 comes last, since its clean-ups (routes, components, `client-address.ts`, agent skills copies, `_bmad/config.user.toml`) would collide with the split.
