---
title: "Story 27.23: A tab left open across an upgrade reloads"
type: 'bugfix'
created: '2026-10-12'
status: 'done'
baseline_commit: '47c8c575619900cad9bed2e31ca00a8268d5af3c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-27-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A tab opened before an image upgrade still runs the old bundle. When it asks for a lazy file the new image no longer has (a route, a chart, a dialog or their CSS), the server answers `404` and the page drops to `RootError` « Une erreur est survenue ». TanStack's `lazyRouteComponent` already reloads once for a missing route component, but a `React.lazy` chunk (`LazyBalanceChart`, `CashFlowChart`, `LazyCreateAccountDialog`, `LazyLoanChart`, `GoalChart`) or a missing CSS file never reloads. Sure reloads the page when its assets change, through Turbo's `data-turbo-track="reload"`.

**Approach:** Before `await import("./app")` in `main.tsx`, a `vite:preloadError` listener reloads the page, the way Vite's documentation recommends. A time-stamped `sessionStorage` mark lets a failure within ten seconds of that reload through to `RootError`, so a file that is really missing never loops.

## Boundaries & Constraints

**Always:**
- The mark is `archant.reloadedAt` in `sessionStorage`, holding `Date.now()`. The listener reloads when the mark is absent or older than 10 000 ms, and writes it before calling `location.reload()`. A tab that lives across two upgrades days apart reloads both times.
- A `sessionStorage` that throws (storage disabled) means no reload: the error reaches `RootError`, never a loop.
- The listener never calls `preventDefault()`: the import must still reject, so a second failure reaches the route's error path.
- `app.ts` keeps `/assets/*` `immutable` with a `404` for a missing file, and every other path `no-cache`: that is what makes the reload fetch the new `index.html`.

**Never:** no error boundary around a single chart or dialog; no version polling or comparison with `GET /api/version`; no change to the server, `RootError` or TanStack's own reload; no new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Stale chunk, new build reachable | `/accounts`'s chunk answers `404` once | page reloads once, « Comptes » shows | none |
| Chunk really missing | `/accounts`'s chunk always `404` | reloads, then `RootError` « Une erreur est survenue », and stops reloading | mark under 10 s |
| Second upgrade later in the same tab | mark older than 10 s | reloads again | none |
| Storage disabled | `sessionStorage.setItem` throws | no reload, `RootError` | caught |

</frozen-after-approval>

## Code Map

- `packages/app/src/main.tsx` -- entry; the listener goes after `z.config` and before `await import("./app")`, so the `app` chunk itself is covered.
- `packages/app/vite.config.ts` -- `autoCodeSplitting: true`; the build wraps every `import()`, routes and `React.lazy` alike, in Vite's preload helper (checked: `d(()=>import(...), __vite__mapDeps(...))` in `dist/assets/app-*.js`), which dispatches `vite:preloadError` on a failed script or CSS. Nothing to change.
- `node_modules/@tanstack/react-router/src/lazyRouteComponent.tsx` -- TanStack's own once-per-message reload under `tanstack_router_reload:<message>`; leave it. When both fire on a route chunk, the two reloads coincide; a persistent failure may cost one extra reload before `RootError`.
- `packages/api/src/app.ts:311-331` -- `serveInterface`; reuse, no change.
- `packages/app/src/components/RootError.tsx`, `packages/app/src/routes/__root.tsx:10-14` -- the only `errorComponent`; heading `startError.title`.
- `packages/app/e2e/serving.spec.ts` -- Story 3.3's serving tests; same style (`page.route` on `**/assets/...`, heading « Comptes » on `/accounts`).
- `_bmad-output/implementation-artifacts/deferred-work.md:121-123` -- the spec-15-5 entry this story plans; add `resolved: Story 27.23.`

## Tasks & Acceptance

**Execution:**
- [x] `packages/app/e2e/stale-chunk.spec.ts` -- first, one test per matrix row, on an account's page: `page.route("**/assets/BalanceChart-*.js")`, the `React.lazy` chunk of `LazyBalanceChart` loaded once the app has mounted, fulfilled `404` on its first request (later requests `route.fallback()`), or always; for the third row an `addInitScript` sets `archant.reloadedAt` to a minute ago, for the fourth it makes `window.sessionStorage` throw a `SecurityError` on access; read `performance.getEntriesByType("navigation")[0].type` for `"reload"`, count document responses with `page.on("response")`. Watch them fail.
- [x] `packages/app/src/main.tsx` -- the listener, with a why-comment naming the upgrade and the 10-second mark.
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- mark the entry resolved.

**Acceptance Criteria:**
- Given a lazy chunk that no longer exists, when the interface fails to load it, then `main.tsx`'s `vite:preloadError` listener reloads the page once, and a second failure within ten seconds reaches `RootError`.
- Given the finished story, when `pnpm test:e2e` runs, then Playwright removes a chunk's route, opens the page that needs it and sees the reload.

## Implementation Notes

The tests target `BalanceChart-*.js` rather than `/accounts`'s route chunks: the `app` chunk imports the route's file statically and TanStack's `lazyRouteComponent` reloads for the split component, so a route chunk could not tell the listener from a reload in `import("./app").catch`; a `React.lazy` chunk loaded after mount, the case the story exists for, only the listener reloads. Without the listener rows one to three fail; row four passes either way, since it guards against a reload rather than for one.

## Spec Change Log

- Review pass 1 (verification-gap layer): tests on `/accounts`'s route chunks passed through TanStack's own reload or a reload in `import("./app").catch`, so they could not prove the listener. The tests now remove `BalanceChart-*.js` on an account's page; the frozen matrix's first two rows name `/accounts`'s chunk and « Comptes », which the human may update to « an account's balance chart ». Known-bad state avoided: green tests with the listener removed. KEEP: exact document counts, `window.sessionStorage` throwing for the storage row.
- Review pass 1 (edge-case layer): the listener also reloads when the mark lies in the future (`elapsed >= 0`), where the frozen rule reads « absent or older than 10 000 ms »; a clock moved back would otherwise block every reload until it caught up. The human may fold this into the rule.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---------|---------|----------|-------|
| No test removes a `React.lazy` chunk; route-chunk tests pass with TanStack's reload or an `import("./app").catch` | medium | pre-verified by the verification-gap layer: only `_authed.accounts.index-*.js` was intercepted | patch: tests retargeted to `BalanceChart-*.js` |
| Request order decides which `/accounts` file is the route | low | `seen[0]` heuristic in the first version | patch: gone with the retarget |
| A mark in the future blocks every reload | low | `Date.now() - reloadedAt` negative stays under 10 000 | patch: `elapsed >= 0` |
| Storage stub on `Storage.prototype.setItem` also breaks `localStorage` and TanStack's guard | low | the error could come from TanStack's `setItem` | patch: `window.sessionStorage` getter throws |
| Verification says « both tests » | low | four tests | patch |
| App chunk or a statically imported route chunk always missing leaves a blank page, not `RootError` | low | pre-existing: `await import("./app")` rejecting before React mounts was already blank; a stale tab has those files loaded, only a broken image meets it | rejected, low and unlikely, fix adds a fallback screen |
| Offline or server restarting: reload lands on the browser's error page | low | true, but the old behaviour lost the page too; `navigator.onLine` is unreliable behind Tailscale | rejected, low, fix adds a branch |
| Reload loop every 10 s | false | a reload happens only on a new failure, which a missing chart only meets on a user action after the window; no automatic loop | rejected |
| `RootError` may flash before the reload | low | cosmetic; avoiding it needs a never-settling promise | rejected |
| No test of a CSS chunk | low | same `vite:preloadError` path as a script | rejected |
| Fixed 2-second waits | low | `version.spec.ts` uses the same; exact counts now | rejected |
| Statuses disagree mid-run | false | spec and sprint status are synced at completion | rejected |
| Comment narrates in past tense | low | reworded to the current state | patch |
| A reload whose page takes over 10 s to request the chunk reloads again | low | true by the frozen 10-second rule; each round costs over ten seconds and stops once the page loads faster; any time bound has the same edge | rejected, frozen rule |
| Only `setItem` throwing is untested | low | the same `try` covers it; the test makes every access throw | rejected |
| Fixed waits carry no reason | low | `version.spec.ts` comments its wait | patch: comment added |

## Design Notes

With TanStack's guard out of the picture, the tests assert exact document counts: two for a chunk missing once, two for a chunk always missing, still two after a two-second wait beside `RootError`, two for a mark a minute old, one without storage.

## Verification

**Commands:**
- `pnpm --filter @archant/app exec playwright test e2e/stale-chunk.spec.ts --project chromium` -- expected: the four tests pass.
- `pnpm lint:code && pnpm typecheck && pnpm test:e2e` -- expected: green.
