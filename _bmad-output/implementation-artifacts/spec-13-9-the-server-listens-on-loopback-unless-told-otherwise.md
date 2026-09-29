---
title: 'Story 13.9: The server listens on loopback unless told otherwise'
type: 'feature'
created: '2026-09-29'
status: 'done'
baseline_commit: '60a4d7c593692b545d9449cdd0520222c6e1c0ad'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `packages/api/src/index.ts` calls `serve()` with a port and no hostname, so Node listens on `::`, every interface. Started with `pnpm api start:dev` or `pnpm api start` on a laptop, the sign-in and `/setup` pages answer anyone on the same Wi-Fi.

**Approach:** A new `HOST` variable, default `127.0.0.1`, passed to `serve()` as `hostname`. The `Dockerfile` sets `HOST=0.0.0.0`, because Docker's published port reaches the container through its network interface, never its loopback; `docker-compose.yml` publishing on `127.0.0.1` keeps the container private.

## Boundaries & Constraints

**Always:**
- `HOST` is validated in `validateEnv` as an IPv4 or IPv6 address, `z.union([z.ipv4(), z.ipv6()])` as `TRUSTED_PROXIES` does, default `127.0.0.1`. A hostname such as `localhost` is refused at startup: Node would bind only its first resolved address, `::1` on macOS, and a typo would look like a bind failure.
- The listening log line carries `host` beside `port`; the bind-failure fatal line carries `host` too.
- `loopbackListener` keeps probing both loopbacks before migrating: Vite proxies to `localhost`, which Node tries as `::1` first, so a stranger on `::1` would still catch its requests while this server holds `127.0.0.1`.
- The Vite proxy keeps `http://localhost:${PORT}`: Node 24 falls back from `::1` to `127.0.0.1` (checked on 2026-09-29 against a server bound to `127.0.0.1` only).

**Never:** no `HOST` in `docker-compose.yml`'s `environment` (the container must bind `0.0.0.0`; exposure is decided by the published port), no hostname resolution, no second listener for `::1`, no change to `PORT`, to the Vite config or to `tailscale serve` in `docs/hosting.md`, no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Default | no `HOST` | accepts on `127.0.0.1:PORT`, refuses on `::1:PORT`; log `host: "127.0.0.1"` | N/A |
| Override | `HOST=::1` | accepts on `::1`, refuses on `127.0.0.1` | N/A |
| Container | image, `HOST=0.0.0.0` | answers on `127.0.0.1:8787` of the host through the published port | N/A |
| Not an address | `HOST=localhost` | no start | `Invalid environment variables: HOST` |
| Not on this machine | `HOST=192.0.2.1` | no start | fatal line with `host`, `code: EADDRNOTAVAIL`, exit 1 |

</frozen-after-approval>

## Code Map

- `packages/api/src/env.ts` -- add `HOST` next to `PORT`, with a why-comment.
- `packages/api/src/index.ts:142-156` -- `serve({ fetch, port, hostname: env.HOST })`, `host` in the listening and fatal lines; update the comment above `loopbackListener` (`:46-51`) for the reason kept above.
- `packages/api/src/lib/port.ts` -- `loopbackListener` unchanged; its doc comment's wildcard case now applies only to `HOST=0.0.0.0`.
- `packages/api/src/index.spec.ts` -- spawns the real entrypoint; reuse `freePort`, `listening`, `outcome`, the `directory` fixture. Add a small TCP connect helper, as `accepts` in `lib/port.ts`.
- `packages/api/src/env.spec.ts` -- existing `validateEnv` cases to extend.
- `packages/app/e2e/start-api.ts:52-80` -- spreads `process.env`; pin `HOST: ""` so a shell that exports `HOST` (tcsh does) cannot move the test server, as `DATABASE_AUTH_TOKEN: ""` already does.
- `Dockerfile:46` -- `ENV HOST=0.0.0.0` beside `ENV PORT=8787`.
- `.github/workflows/ci.yml:99-100` -- job `image`, model: « The image carries the version it was built with ».
- `.env.example:16-19` -- « Server » block.
- `docs/deployment.md:73` (« The image sets the rest ») and `:278` (« A plain Node host »).
- `AGENTS.md` « Deployment » -- one sentence on `HOST`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/env.spec.ts` -- default `127.0.0.1`; `0.0.0.0`, `::` and `::1` accepted; `localhost` and `example.org` refused naming `HOST` -- test first.
- [x] `packages/api/src/index.spec.ts` -- matrix rows Default, Override and Not on this machine -- test first.
- [x] `packages/api/src/env.ts`, `packages/api/src/index.ts`, `packages/api/src/lib/port.ts` -- the variable, the bind, the logs, the comments.
- [x] `packages/app/e2e/start-api.ts` -- `HOST: ""` with its reason.
- [x] `Dockerfile` -- `ENV HOST=0.0.0.0` with its reason.
- [x] `.github/workflows/ci.yml` -- step asserting `docker compose exec -T archant printenv HOST` is `0.0.0.0`; the existing health and interface steps prove it answers.
- [x] `.env.example` -- `HOST=` with its default and what `0.0.0.0` exposes: every network the machine joins, sign-in and `/setup` included.
- [x] `docs/deployment.md` -- `HOST=0.0.0.0` among what the image sets, and why that is safe; « A plain Node host » keeps the default and puts the reverse proxy on the same machine.
- [x] `AGENTS.md` -- the default and the image's override.

**Acceptance Criteria:**
- Given `pnpm test:e2e`, when it runs, then it passes unchanged apart from `start-api.ts`: the browser and Playwright's readiness probe reach `localhost:8788` on `127.0.0.1`.
- Given `pnpm app start:dev` beside `pnpm api start:dev`, when the interface loads, then `/api` answers through the Vite proxy.

## Implementation Notes

- `index.spec.ts` proves the override with `HOST=::1` rather than `0.0.0.0`, so no test depends on a network interface; the CI `image` job proves `0.0.0.0`.
- The bind-failure case uses `192.0.2.1`, a documentation address never assigned to a machine.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| A shell that exports `HOST` as the machine name (tcsh) stops `start:dev`, `start` and `reset-password`: `--env-file` never overrides an exported variable | low | Real for tcsh, loud and named at startup; the name `HOST` is the story's. Patch: `.env.example` says to unset it. |
| `.env.example` claims the container ignores `HOST=`; an empty value through `docker run --env-file` or a platform brings back loopback and the published port stops answering | low | Real; the same file already breaks a container through `DATABASE_URL`. Patch: wording. |
| A container with `HOST` overridden to `::1` or another address fails its `HEALTHCHECK` | low | Same misconfiguration as the row above, which the wording now rules out. Patch with it. |
| No upgrade note for a plain Node host reached from another machine, which loses access | low | Real behaviour change. Patch: one sentence in « Upgrading ». |
| `accepts` duplicated in `index.spec.ts` with another timeout | low | Direct fix. Patch: export it from `lib/port.ts`. |
| `Invalid environment variables: HOST` does not say an IP is expected | low | Every variable fails this way; `.env.example` explains. Rejected. |
| « That exposes nothing more » ignores other containers on the Docker network | low | `archant_default` holds this one container, and the server already bound `::` before. Rejected. |
| The CI step checks `printenv HOST`, not the bound address | false | The health and interface `curl` steps from the host fail unless the server answers on the container's interface. Rejected. |
| A specific non-loopback `HOST` breaks the Vite proxy | low | Development only, and a LAN bind is what the story discourages. Rejected. |
| `loopbackListener` still probes loopback when `HOST` is a non-loopback address, refusing on an unrelated loopback service | low | Exotic setup; the fix adds a branch. Rejected. |
| `portTaken` does not log `host` | low | Its message is about the port, which is what conflicts. Rejected. |
| The `::1` test fails on a runner without IPv6 loopback | false | The existing port-conflict test already listens on `::1` in CI. Rejected. |
| `JSON.parse` in the `EADDRNOTAVAIL` test throws on a non-JSON line | low | stdout carries only pino lines; the test still fails, less clearly. Rejected. |
| `0.0.0.0` is not started for real in `pnpm test` | false | The CI `image` job starts it, as the spec assigns. Rejected. |
| A zoned IPv6 address such as `fe80::1%en0` is refused | low | No household binds a link-local address. Rejected. |

## Design Notes

The « Variables » table of `docs/deployment.md` lists what Compose passes to the container. `HOST` is not one of them and must not be, so it goes in the paragraph right under the table, which lists what the image sets, rather than in a row a self-hoster would be tempted to fill.

## Verification

**Commands:**
- `pnpm lint:code && pnpm typecheck && pnpm test` -- expected: green, new tests included.
- `pnpm test:e2e` -- expected: green.
- `pnpm format && pnpm lint:format` -- expected: green, no tracked file changed by the second run.

**Manual checks:**
- `pnpm api start:dev` and `pnpm app start:dev`: sign in at `http://localhost:5173`; `curl http://<the machine's LAN address>:8787/api/health` is refused.
