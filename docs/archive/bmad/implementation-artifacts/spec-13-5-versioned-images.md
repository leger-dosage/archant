---
title: 'Story 13.5: Versioned images'
type: 'feature'
created: '2026-09-27'
status: 'done'
baseline_commit: '825dd174d4a2e05c32d1f4e1277d81fe0e35743a'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Archant has no release. Upgrading means `git pull` and a local build, going back means finding the right commit, and nothing tells the owner which code is running.

**Approach:** A `vX.Y.Z` tag runs the verification gate, publishes a multi-platform image to `ghcr.io/leger-dosage/archant` and a GitHub Release. The image carries its version; `docker-compose.yml` runs the published image by default and still builds from source; « Réglages » shows the running version.

## Boundaries & Constraints

**Always:**
- Workflow `.github/workflows/release.yml`, triggered by `push` on tags `v[0-9]+.[0-9]+.[0-9]+` only, and by `workflow_dispatch` as a dry run.
- Job `gate`: `uses: ./.github/workflows/ci.yml`; `ci.yml` gains `workflow_call:`. Nothing is published unless every CI job passes, `image` and `actionlint` included.
- Job `publish` (`needs: gate`): `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` to `ghcr.io` with `GITHUB_TOKEN`, `docker/metadata-action` with tags `type=semver,pattern={{version}}`, `type=semver,pattern={{major}}.{{minor}}` and `latest`, plus OCI labels (`source`, `version`, `revision`, `licenses` read from the repository); `docker/build-push-action` for `linux/amd64,linux/arm64`, build argument `APP_VERSION=${{ steps.meta.outputs.version }}`, `cache-from`/`cache-to` `type=gha`. `push` is true only on a tag push.
- Job `release` (`needs: publish`, tag push only): `gh release create "$GITHUB_REF_NAME" --generate-notes --verify-tag`. No third-party release action.
- Permissions: `contents: read` at workflow level; `packages: write` on `publish` only; `contents: write` on `release` only.
- Action versions follow `ci.yml`'s idiom: major tags, no SHA pins.
- The version comes from the tag. No commit bumps `package.json`, which stays `0.0.0`.
- `Dockerfile`: the builder stage runs `FROM --platform=$BUILDPLATFORM`, so the interface builds natively and only the runner stage's production install runs under emulation. The runner stage declares `ARG APP_VERSION` and sets `ENV APP_VERSION=$APP_VERSION`.
- `packages/api/src/env.ts`: `APP_VERSION` optional, `X.Y.Z` digits only, no leading `v`; empty or absent means a development build. `.env.example` lists it: set by the image from the release tag, leave it empty.
- `GET /api/version`, signed in, answers `{ "data": { "version": "1.2.3" } }`, or `{ "data": { "version": null } }` for a development build. Chained in `createApi` so `AppType` sees it; behind the existing session guard like every other route.
- `GET /api/health` never carries the version, whatever `APP_VERSION` holds.
- « Réglages »: below the section list in `_authed.settings.tsx`, « Version 1.2.3 » links to `https://github.com/leger-dosage/archant/releases/tag/v1.2.3`, new tab, `rel="noreferrer"`. A development build shows « Version de développement », without a link.
- `docker-compose.yml`: `image: ghcr.io/leger-dosage/archant:${ARCHANT_VERSION:-latest}` beside `build: .`. `up` pulls when no local image exists, `up --build` builds from the checkout and tags the result with the same name.
- CI `image` job: `docker compose build --build-arg APP_VERSION=0.0.0`, then `docker compose up --detach --wait --pull never`, so it only ever runs the pull request's build. A step checks `printenv APP_VERSION` in the container prints `0.0.0`. The existing exact health body check stays.
- CI job `actionlint`: the official `rhysd/actionlint:1.7.11` image, which bundles shellcheck, over the repository.

**Ask First:**
- Anything outward-facing: pushing a tag, changing the GHCR package's visibility, creating a release by hand.

**Never:** no prerelease tags, no image on `main` pushes or nightly, no commit SHA in the interface, no Helm chart, no SBOM or image signing, no Docker Hub, no rewrite of « Upgrading » or « Backups » (Story 13.6), no version in logs beyond what already exists.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Release tag | push `v1.2.3` | gate, then image `1.2.3`, `1.2`, `latest` for amd64 and arm64, then a GitHub Release with generated notes | gate red → no image, no release |
| Other tag | push `v1.2.3-rc.1` or `foo` | workflow does not run | — |
| Dry run | `workflow_dispatch` | gate and both platform builds; nothing pushed, no release | build error fails the run |
| Version route | `APP_VERSION=1.2.3`, signed in | `200 {"data":{"version":"1.2.3"}}` | signed out → `401 UNAUTHORIZED` |
| Development build | `APP_VERSION` empty or absent | `200 {"data":{"version":null}}` | — |
| Invalid version | `APP_VERSION=v1.2` | server refuses to start, naming the variable | — |
| Health | `APP_VERSION=1.2.3` | body exactly `{"data":{"status":"ok"}}` | — |
| Settings | version `1.2.3` | « Version 1.2.3 » linking to the `v1.2.3` release | — |
| Settings | version `null` | « Version de développement », no link | route fails → nothing shown, the rest of the page works |
| Self-hoster | compose file alone, no checkout | `docker compose up` pulls `ghcr.io/leger-dosage/archant:latest` | — |
| Pinned | `ARCHANT_VERSION=1.2.3` | runs `:1.2.3` | — |
| Contributor | checkout, `up --build` | builds from source, development version | — |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` -- add `workflow_call:` to `on`; add the `actionlint` job; `image` job's build and `up` lines (`:92-97`) and a new version step. Its `concurrency.group` uses `github.workflow`, which is the caller's name when called; check a tag run does not cancel itself.
- `.github/workflows/release.yml` -- new.
- `Dockerfile` -- builder `FROM` (`:6`), runner `ARG`/`ENV` beside `ENV PORT` (`:43-47`).
- `docker-compose.yml:7-8` -- `image:` beside `build: .`, with a why-comment; header comment (`:1`) names both ways to start.
- `packages/api/src/env.ts`, `env.spec.ts` -- `APP_VERSION`, transformed to `string | null`.
- `packages/api/src/routes/version.ts`, `version.spec.ts` -- new; `createApi` in `packages/api/src/app.ts:119-136`. `AppDeps` must carry the version (read how `env` reaches other routes before choosing).
- `packages/api/src/routes/health.spec.ts` -- the health body stays free of the version.
- `packages/app/src/routes/_authed.settings.tsx` -- version line under the `nav`; query through the `hc` client and `queryKeys` as the other settings pages do.
- `packages/app/src/lib/release.ts`, `release.spec.ts` -- `releaseUrl(version)`: the release URL, or `null` for a development build. Keeps the null branch tested without a second e2e server.
- `packages/app/src/locales/fr.json` -- `settings.version`, `settings.developmentVersion`.
- `packages/app/e2e/start-api.ts` or `playwright.config.ts` `webServer` -- start the e2e server with `APP_VERSION=1.2.3`.
- `packages/app/e2e/` -- a settings spec asserting the link's text and `href`.
- `.env.example` -- `APP_VERSION` in « Server ».
- `docs/deployment.md` -- « Docker — the reference target »: start without a checkout (download `docker-compose.yml`, `docker compose up --detach --wait`), pin with `ARCHANT_VERSION`, build from a checkout with `--build`; variables table gains `ARCHANT_VERSION`; the image sets `APP_VERSION`.
- `AGENTS.md` « Deployment » -- the release workflow, the image name, `actionlint` in CI.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/env.spec.ts` -- failing specs: `1.2.3` accepted, empty and absent give `null`, `v1.2`, `1.2` and `1.2.3-rc.1` refused.
- [x] `packages/api/src/routes/version.spec.ts`, `health.spec.ts` -- failing specs for the matrix rows « Version route », « Development build », « Health ».
- [x] `packages/app/src/lib/release.spec.ts` -- failing spec for `releaseUrl`.
- [x] `packages/app/e2e/` -- failing Playwright spec: « Réglages » shows « Version 1.2.3 » linking to the `v1.2.3` release.
- [x] `packages/api/src/env.ts`, `routes/version.ts`, `app.ts`, `.env.example` -- the variable and the route.
- [x] `packages/app/src/lib/release.ts`, `routes/_authed.settings.tsx`, `locales/fr.json` -- the version line.
- [x] `Dockerfile`, `docker-compose.yml` -- build platform, version argument, image name.
- [x] `.github/workflows/ci.yml` -- `workflow_call`, `actionlint` job, `image` job builds with `APP_VERSION=0.0.0`, runs with `--pull never`, checks the variable.
- [x] `.github/workflows/release.yml` -- `gate`, `publish`, `release`; `actionlint` passes locally.
- [x] `docs/deployment.md`, `AGENTS.md` -- as in the code map.

**Acceptance Criteria:**
- Given the finished story, when `pnpm test`, `pnpm test:e2e` and CI run, then every matrix row has an automated test, except the release rows, which the `workflow_dispatch` dry run and the first real tag prove.
- Given `release.yml` and `ci.yml`, when `actionlint` runs in CI, then it reports nothing.

## Spec Change Log

- Review, iteration 1. Trigger: the arm64 image is published without ever starting, and the owner's likely home machine (Apple silicon, Raspberry Pi) runs arm64. Amended: `publish` first builds and loads the `linux/arm64` image alone, starts it under QEMU and waits for the exact health body, before the multi-platform build pushes; a dry run builds with `APP_VERSION=0.0.0` so its probe can start. Known-bad state avoided: a `latest` that crashes at start on arm64. KEEP: everything else in the diff, applied as a patch rather than a re-derivation, since the rest of the implementation stands.

## Review Triage Log

| Finding | Verdict | Evidence | Route |
|---|---|---|---|
| arm64 image published without ever starting (blind) | medium | `publish` only builds; CI's `image` job runs amd64. libsql ships a native binary per platform, so an arm64 install can fail only at start. | patch (spec amended above) |
| Dry run passes `APP_VERSION=main` or empty (blind, edge) | low | `metadata-action`'s `version` falls back to the ref name when no semver tag matches; the arm64 probe would refuse to start on it. One expression. | patch |
| « Set 1.2 to follow fixes » is false without `docker compose pull` (edge) | medium | Compose's default pull policy never re-pulls an existing tag, so `up` alone keeps the first image. The new paragraph promises otherwise. | patch |
| A contributor's `up --build` shadows `:latest` on that machine (blind, edge) | low | Same name for both; `docker compose pull` replaces it. One sentence beside the fix above. | patch |
| « Version de développement » line has no test; `start-api.ts` comment claims `release.spec.ts` covers it (verification) | medium | Pre-verified gap: no test renders the `null` branch. `page.route` answering `{ version: null }` covers it. | patch |
| `staleTime: Infinity` comments claim a restart reloads the page (blind, edge) | low | An open tab keeps the old version until reloaded. Direct comment correction. | patch |
| The optional query retries three times and on each remount (blind, edge) | low | Silent by design; `retry: false` is one line and shortens the e2e wait. | patch |
| `APP_VERSION` accepts `01.2.3` (blind) | low | Not semver; the link would name a tag the workflow never makes. Direct regex correction. | patch |
| `ARCHANT_VERSION` interpolation untested (edge) | low | `docker compose config --images` in the `image` job checks the default and a pinned tag. One step. | patch |
| « Upgrading » still says `git pull` and `--build` (blind, edge) | medium | Real for image users, but the epic gives « Upgrading » to Story 13.6, whose criteria name `docker compose pull`. | defer |
| No release notes or visibility step in the docs for the first GHCR push (blind, edge) | low | An owner step, once, listed in Design Notes and the pull request; no self-hoster meets it. | rejected |
| Compose file downloaded from `main` may be ahead of the image (blind) | low | Divergence lasts from a merge to the next tag, and the file mostly adds container settings; attaching it to the release adds a release asset and a checkout. | rejected |
| A patch tag on an older line moves `latest` backwards (blind, edge) | low | Archant tags `main` only and has no release branch; a guard adds a step comparing tags. | rejected |
| A tag such as `v01.2.3` pushes only `latest` (edge) | low | Needs a mistyped tag by the one maintainer; a guard adds a step. | rejected |
| `leger-dosage` hard-coded, forks cannot publish (blind) | low | The intent names `ghcr.io/leger-dosage/archant`; one household, no fork release planned. | rejected |
| Actions pinned by tag, not SHA (blind) | low | The spec follows `ci.yml`'s idiom; changing it is a repository-wide decision. | rejected |
| A mistyped `ARCHANT_VERSION` falls back to a build that fails (edge) | low | The failure is loud and names the missing context; a guard needs a `pull_policy` that breaks contributors. | rejected |
| Contributor and self-hoster pull rows lack an automated test (edge) | low | Pull cannot run before the first release; the development build is covered by `env.spec.ts` and the new `null` e2e test. | rejected |
| Standards review: `AppVersion` calls `useQuery` in the route, where every other query lives in a `hooks/useX.ts` | low | Direct move to `hooks/useVersion.ts`. | patch |
| Standards review: the stale-version comment appears in `query-keys.ts` and beside `staleTime` | low | Kept beside `staleTime` only. | patch |
| Standards review: the `APP_VERSION` build-arg expression is repeated in both builds of `release.yml` | low | Two adjacent lines; a step output adds a step for one expression. | rejected |
| Standards review: `leger-dosage/archant` repeated across files, also in `_authed.settings.banks.tsx` | low | Renaming the repository is not planned; touching the banks page is outside the story. | rejected |
| Standards review: `version` travels in `buildTestApp`'s `network` argument | low | Beside `webDist`, which already sits there; a new argument changes every caller. | rejected |
| Standards review: `AppDeps` redeclares `version` rather than intersecting `VersionDeps` | low | Same as `syncSecret` and `setupToken`; the file's pattern. | rejected |

## Design Notes

One QEMU job builds both platforms, where Sure's `publish.yml` runs native amd64 and arm64 runners and merges the digests. The interface build is plain JavaScript, so `--platform=$BUILDPLATFORM` keeps it native; only `pnpm install --prod` in the runner stage is emulated, which fetches libsql's arm64 binary rather than compiling it. Moving to Sure's layout is a later change if the emulated install turns out too slow.

`APP_VERSION` and `ARCHANT_VERSION` are two names on purpose. `ARCHANT_VERSION` is read by Compose on the host and picks a tag, which may be `latest` or `1.2`. `APP_VERSION` is the exact release baked into the image and read by the server. Story 13.6 names its database copies after `APP_VERSION`.

The version reaches the interface through the API, not a Vite `define`: one source, the server's environment, for the page and for Story 13.6. The route sits behind the session guard, so an anonymous visitor learns nothing about which release to attack; health stays anonymous and versionless for the same reason.

Sure shows the version in the user menu. The epic puts it in « Réglages », and Archant has no user menu; the epic wins.

Owner steps after merge, outward-facing, not done by the implementation:
1. Run the `workflow_dispatch` dry run on `main`.
2. Push `v0.1.0`.
3. In the GitHub package settings of `archant`, set visibility to public. A package pushed from an organisation repository starts private, and `docker compose pull` would then ask a self-hoster to sign in.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test` -- expected: green, no tracked file changed.
- `pnpm test:e2e` -- expected: green.
- `actionlint` -- expected: no finding.
- `docker compose build --build-arg APP_VERSION=0.0.0 && docker compose up --detach --wait --pull never` -- expected: healthy; `docker compose exec -T archant printenv APP_VERSION` prints `0.0.0`.

**Manual checks (if no CLI):**
- In an empty directory holding only `docker-compose.yml`, after `v0.1.0` exists and the package is public: `BETTER_AUTH_SECRET=... docker compose up --detach --wait` pulls and starts; « Réglages » shows « Version 0.1.0 ».
