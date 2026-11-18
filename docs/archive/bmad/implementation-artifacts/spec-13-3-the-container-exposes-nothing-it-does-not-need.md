---
title: 'Story 13.3: The container exposes nothing it does not need'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: '85642a17e06aac8d1de9eec0c7d217b2c71776b8'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `docker-compose.yml` publishes port 8787 on every interface, so anyone on the network reaches the server around a reverse proxy or Tailscale. The container can write anywhere in its filesystem and keeps Docker's default capabilities. Pages carry no Content-Security-Policy, so injected text could run script. A `BETTER_AUTH_URL` in plain `http://` on a public address sends the password and the session cookie in clear, and nothing says so.

**Approach:** Lock down the default Compose service (loopback port, read-only root, no capabilities, `no-new-privileges`), send one CSP through the existing `secureHeaders`, and log a warning at startup for a plain-HTTP public origin. Reaching the machine from the home network becomes a documented `compose.override.yml`.

## Boundaries & Constraints

**Always:**
- `docker-compose.yml`: `ports: ["127.0.0.1:8787:8787"]`, `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: ["no-new-privileges:true"]`; `/data` stays the only writable path (the named volume). A why-comment on each.
- CSP through `secureHeaders({ contentSecurityPolicy })` in `createApp`, on every response: exactly `script-src 'self' 'sha256-rAeCpAn2Kteerk13PeCDOI8kvlaCDjXxkwzZgMe0DQU='`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`. The hash is a named constant beside the policy; a Vitest spec recomputes it from the inline script of `packages/app/index.html` and fails, printing the new hash, when they differ.
- The warning: a pure function in a new `packages/api/src/lib/insecure-origin.ts` decides; `index.ts` logs one `warn` line after `validateEnv`, naming `BETTER_AUTH_URL` (or `ARCHANT_URL` in the container) and saying the password and session cookies travel unencrypted. `https://` never warns. Loopback and private: `localhost` and `*.localhost`; IPv4 `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `100.64.0.0/10` (Tailscale); IPv6 `::1`, `fc00::/7` (Tailscale's ULA included), `fe80::/10`; a single-label host name (`http://nas:8787`); names under `.local`, `.home.arpa`, `.internal`, `.ts.net`. Anything else warns.
- An auto Playwright fixture in `packages/app/e2e/fixtures.ts`, beside `outsideRequestGuard`, fails any test whose page reports a CSP violation, naming it; the whole e2e run then proves the interface works under the policy.
- `docs/deployment.md`: the home-network paragraph gives the `compose.override.yml` with `ports: !override ["8787:8787"]` and says why; « Behind a reverse proxy » drops its loopback override, now the default; the Docker section says in one sentence what the container may write and do.

**Never:** no `default-src` and no `style-src` (sonner, the shadcn chart and radix's scroll lock inject `<style>` at runtime; bank logos come from `enablebanking.com`); no nonce; no CSP in the Vite dev server; no new environment variable, no HSTS, no refusal to start on plain HTTP; no change to the `Dockerfile` beyond what the read-only root proves necessary; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Page | `GET /`, `GET /accounts` with `WEB_DIST` | the five-directive CSP header | — |
| API response | `GET /api/health` | same header | — |
| Theme script | built `index.html`, stored theme `dark` | `html.dark` before React mounts, no violation | — |
| Public plain HTTP | `http://archant.example.org`, `http://203.0.113.10:8787` | one `warn` line at startup | server still starts |
| Loopback, LAN, tailnet | `http://localhost:8787`, `http://192.168.1.20:8787`, `http://100.101.102.103`, `http://[fd7a:115c:a1e0::1]`, `http://nas:8787`, `http://archant.local` | no warning | — |
| HTTPS | `https://archant.example.org` | no warning | — |
| Container writes | `touch` in `/data`, `/tmp`, `/app` | first two succeed, `/app` fails | — |
| Port from outside | container started by default Compose | `docker inspect` shows host IP `127.0.0.1` | — |

</frozen-after-approval>

## Code Map

- `docker-compose.yml:16` -- `ports`; add the hardening keys beside `init: true`.
- `.github/workflows/ci.yml` (`image` job) -- after `up --wait`, one step checks `docker inspect` (`HostConfig.ReadonlyRootfs`, `CapDrop`, `SecurityOpt`, port binding `HostIp`), one step runs the three `touch` through `docker compose exec -T archant`. Existing steps (health, interface, reset command, SIGTERM, restart) must stay green: they prove the server boots and migrates under the lock-down.
- `packages/api/src/app.ts:197` -- `secureHeaders()`; pass the policy. Keep the existing why-comment and extend it.
- `packages/api/src/app.spec.ts:2070` -- « sends security headers »: assert the CSP string on a page and on an `/api` response.
- `packages/api/src/lib/content-security-policy.ts` (new), `.spec.ts` -- the policy object for Hono and the hash constant; the spec reads `packages/app/index.html` through `new URL("../../../app/index.html", import.meta.url)`, extracts the single inline `<script>` without `src`, hashes its exact text with `node:crypto`.
- `packages/api/src/lib/insecure-origin.ts` (new), `.spec.ts` -- one exported predicate over a URL string; reuse `BlockList` and `isIP` from `node:net` as `lib/client-address.ts` does. Table-driven spec from the matrix.
- `packages/api/src/index.ts:18` -- after `createLogger`, the warning.
- `packages/api/src/index.spec.ts` -- spawns the real entrypoint; add a public `http://` case that logs the warning and a loopback case that does not. Reuse `listening()`.
- `packages/app/e2e/fixtures.ts:468` -- the violation guard, auto like `outsideRequestGuard`. Chromium reports a violation as a console error starting « Refused to »; listen on the context's pages.
- `packages/app/e2e/serving.spec.ts` -- one test: the page response carries the CSP, and with `archant.theme` set to `dark` in `localStorage` (via `addInitScript`) the first document has `html.dark`.
- `packages/app/index.html:10` -- the theme script; unchanged. Any edit changes the hash.
- `docs/deployment.md:26`, `:60-69` -- the two passages above.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/lib/insecure-origin.spec.ts`, `insecure-origin.ts` -- matrix rows as failing tests, then the predicate.
- [x] `packages/api/src/index.spec.ts`, `index.ts` -- the two startup cases, then the log line.
- [x] `packages/api/src/lib/content-security-policy.spec.ts`, `content-security-policy.ts`, `app.spec.ts`, `app.ts` -- hash and header tests first, then the policy wiring.
- [x] `packages/app/e2e/fixtures.ts`, `serving.spec.ts` -- the violation guard and the header and theme test.
- [x] `docker-compose.yml`, `.github/workflows/ci.yml` -- the hardening keys and the two CI steps.
- [x] `docs/deployment.md` -- the override for the home network, the proxy section, the hardening sentence.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test`, `pnpm test:e2e` and the CI `image` job run, then every matrix row has an automated test and all pass.
- Given `pnpm lint:format`, when it runs, then `docs/deployment.md` is formatted and its `#connecting-a-bank` anchor still exists.

## Implementation Notes

- The guard listens for the DOM `securitypolicyviolation` event through `context.addInitScript` and `context.exposeBinding`, not the console: Chromium's wording has already moved from « Refused to … » to « Executing inline script violates … ». A deliberately wrong hash made it fail the `setup` project, naming `script-src-elem blocked inline`.
- That guard exposed a violation the console one had missed: Zod 4 probes `Function("")` when it builds an object schema. `packages/app/src/main.tsx` now only calls `z.config({ jitless: true })`, then dynamically imports `app.tsx`, the former `main.tsx` unchanged. A static import would not do: the bundle runs the chunk holding the schemas before the entry's own code.
- The e2e theme test aborts `/assets/*.js`, so React never mounts and only the inline script can set `html.dark`.
- No `Dockerfile` change: the image boots, migrates, answers health, runs the reset command and stops on SIGTERM under the read-only root.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| `touch /app` probe passes without `read_only` (blind, edge, verification) | medium | `/app` is created root-owned by `WORKDIR` before `USER node`; `node` cannot write it either way. Only the `docker inspect` step proved the row. | patch |
| `X-Frame-Options: SAMEORIGIN` contradicts `frame-ancestors 'none'` (blind) | low | Two headers disagree; modern browsers follow the CSP, older ones allow same-origin framing. Direct option change. | patch |
| Hash spec message names only the constant; two specs hard-code the header (blind) | low | Changing the theme script fails three specs, the message guides to one. | patch |
| Hash spec reads raw CRLF on an autocrlf checkout (edge) | low | No `.gitattributes`; the HTML parser normalises CRLF before hashing, the spec does not. One `replace`. | patch |
| e2e guard matches Chromium's console wording (blind) | medium | The wording already differed from the one the spec expected; a rewording would silence the guard. The DOM event is standard. | patch |
| No upgrade note for installs reached from another device (blind, edge) | medium | After the upgrade the port answers on loopback only; nothing in « Upgrading » says so. | patch |
| Tailscale users have no documented path (blind) | false | `tailscale serve` proxies to `127.0.0.1:8787`, which still answers; a tailnet IP is covered by the same override. Story 13.7 writes the guide. | rejected |
| Override plus `TRUSTED_PROXIES` lets a LAN host forge `X-Forwarded-For`, undocumented (blind) | false | « Behind a reverse proxy » now says to keep the loopback port, without the home-network override. | rejected |
| `tmpfs` on `/tmp` has no size bound (blind) | false | Nothing in the server writes to `/tmp`; no request can fill it. | rejected |
| Loopback no-warning test depends on the file's `beforeAll` URL (blind) | low | Readability; the setup is ten lines above in the same file. | rejected |
| `http://0.0.0.0` or `http://[::]` warns (blind, edge) | low | Not an address a browser signs in from; a warning there is harmless. | rejected |
| `localhost` resolving to `::1` first misses the IPv4-only binding (edge) | low | Browsers, curl and Node 20+ fall back to IPv4. | rejected |
| Router suffixes `.lan`, `.fritz.box` warn falsely (edge) | low | A false warning only, and the frozen list names the suffixes. | rejected |
| Standards review: `AGENTS.md` « Deployment » does not describe the lock-down or the theme-script hash | low | The file must describe the current state; a contributor editing the theme script would not know about the hash. | patch |
| Standards review: a fourth copy of the spawn and kill block in `index.spec.ts` | low | Matches the three existing cases in the same file; a helper would refactor code outside the story. | rejected |
| Standards review: `isInsecurePublicOrigin` takes a string, `index.ts` parses the URL again | low | One extra parse at startup. | rejected |

## Design Notes

A hash constant rather than one computed at startup from `WEB_DIST/index.html`: the policy stays readable in one file, the API does not parse HTML, and the spec turns any drift into a failing test naming the new hash. The e2e guard catches the rest, since the e2e server serves the real build.

The CSP goes on JSON responses too: `secureHeaders` runs on `*`, and splitting it by path buys nothing, as a browser ignores `script-src` on JSON.

Sure sets no CSP (its initializer is commented out) and publishes its port on every interface; the epic's security audit asks for more, so this story goes beyond Sure on purpose.

`100.64.0.0/10` is carrier-grade NAT space in general, not only Tailscale. Treating it as private can miss a warning on an ISP's shared network, where a server reachable by URL is unlikely; warning on the owner's own tailnet would be the worse mistake.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- expected: green, no tracked file changed.
- `pnpm test:e2e` -- expected: green, no CSP violation reported.
- `BETTER_AUTH_SECRET=... docker compose up --build --detach --wait`, then the CI `image` steps by hand -- expected: healthy; `curl` on the machine's LAN address refused; `touch /app/x` in the container refused.
