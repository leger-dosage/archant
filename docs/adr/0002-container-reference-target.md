# 0002 — The container is the reference target

- Status: Accepted
- Date: 2026-09-18
- Supersedes: part of [0001](0001-technology-stack.md), listed below

## Context

[0001](0001-technology-stack.md) made Cloudflare the primary deployment target and planned one entrypoint per platform under `packages/api/src/entrypoints/`, with D1 as a supported database.

Scoping the first scaffolding showed what that costs before any feature exists: a Workers entrypoint, a `wrangler.toml`, a second database driver, and a test matrix per platform, all to serve one household. Meanwhile 0001's second constraint, easy self-hosting in one container with a file-backed database, is the path most people running Archant will actually take.

## Decision

`@archant/api` is a plain Node project with a single entrypoint, `packages/api/src/index.ts`.

The reference target is one container that serves the built interface and the API on the same origin, against a SQLite file on a volume. It is the only target with files in the repository.

Other platforms are documented in [../deployment.md](../deployment.md) and reached through configuration. Hono still only needs web standards, so a Workers entrypoint remains possible; it is not written, and nothing in the application code prepares for it.

## What this supersedes in 0001

- Constraint 1, "primarily Cloudflare". The constraint that stands is "without forking the application code per platform".
- The Server row's "a six-line entrypoint per target". There is one entrypoint.
- "D1 remains a supported target". Turso is the hosted database; D1 is not tested.
- The consequence "every new deployment target costs one entrypoint and one configuration file". A new target costs documentation, and an entrypoint only if configuration cannot reach it.

Everything else in 0001 stands.

## Consequences

- No `wrangler` dependency and no Cloudflare-specific file in the repository.
- The container has to be exercised in CI once it exists, since it is the target the README puts first.
- Moving to Workers later means writing one entrypoint and one configuration file, which is the cost 0001 accepted for every target and this ADR pays only if needed.
