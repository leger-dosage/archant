---
title: 'Story 15.2: A pinned, updated and attested supply chain'
type: 'chore'
created: '2026-09-30'
status: 'in-progress'
baseline_commit: '68426a9d5f614201b9dde60b1e6f72d68ca050db'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The job that pushes the image with `packages: write` runs actions pinned by movable tags (SEC-2); `node:24-alpine` and pnpm are unpinned (SEC-3); nothing proposes updates (DEP-6); the Node version is declared nowhere (DEP-7); three packages are exact without a reason (DEP-8); a published image carries no SBOM, provenance or attestation, and releases are mutable (OSS-5).

**Approach:** Pin every action, image and the package manager by hash, let Dependabot keep them current, attest the release image and make releases immutable, then prove it with a dry run and a verification against a real published image.

## Boundaries & Constraints

**Always:**
- `.github/dependabot.yml`, weekly for `npm`, `github-actions` and `docker`, directory `/` each, as Sure's `.github/dependabot.yml` (weekly, `open-pull-requests-limit: 10`). npm: one group for `minor` and `patch` updates; majors stay one pull request per dependency. npm ignores `ofx-js`: `patchedDependencies` in `pnpm-workspace.yaml` names `ofx-js@1.1.1`, so any bump breaks the install until the patch is rewritten.
- Every `uses:` in `ci.yml` and `release.yml` is `owner/repo@<40-hex SHA> # vX.Y.Z`, the SHA of the tag's commit (dereference annotated tags). `rhysd/actionlint` becomes `docker://rhysd/actionlint:1.7.11@sha256:<index digest>`.
- Both `FROM` lines of the `Dockerfile` read `node:24-alpine@sha256:<multi-platform index digest>`, the same digest. `packageManager` is `pnpm@10.34.5+sha512.<hash>`.
- Root `package.json` gains `engines.node: ">=24"`; `.node-version` holds `24`; `.npmrc` gains `engine-strict=true` so an older Node fails at install, not at the first type-stripped import. CI's `actions/setup-node` reads `node-version-file: .node-version`.
- Caret ranges for every dependency except `ofx-js` (exact): `papaparse`, `qrcode.react`, `recharts`, and in the catalog `better-auth`, `react`, `react-dom`, `typescript` (today `~7.0.2`). No recorded reason exists for the exact ones; the lockfile and CI still gate every change.
- The `actionlint` job gains a step that fails on a `uses:` without a SHA and a `FROM` without a digest. No job is added or renamed, so ruleset « main: pull request and CI » stays as is.
- `release.yml` final `docker/build-push-action` step: `sbom: true`, `provenance: mode=max`; then, on `push` only, `actions/attest-build-provenance` with `subject-name: ghcr.io/leger-dosage/archant`, the build step's `digest` output and `push-to-registry: true`. `publish` gains `id-token: write` and `attestations: write`, nothing wider.
- Immutable releases on through `PUT repos/leger-dosage/archant/immutable-releases`, as the owner approved on 2026-09-30, read back and pasted in Implementation Notes.
- The attestation is proven on a real image, as the owner chose on 2026-09-30: after merge, the owner pushes `v0.2.1`, a release with no behaviour change, and the story stays `in-review` until the `gh attestation verify` output is pasted here.
- `docs/deployment.md`, under « Upgrading », a « Verifying an image » subsection with the `gh attestation verify` command. `AGENTS.md` states the pinning rule, the caret rule with the `ofx-js` exception, and the attestation.

**Ask First:** any other repository setting; adding a job to `ci.yml`; signing tags or commits; a Renovate configuration.

**Never:** no change to job names, no CodeQL workflow, no `CONTRIBUTING.md` or README change (15.3), no automated ruleset-versus-jobs comparison (deferred-work entry, left to 15.7), no dependency upgrade beyond what the range change and the pins require.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unpinned action | a pull request adds `uses: foo/bar@v1` | `actionlint` job red, names the line | — |
| Unpinned base | `FROM node:24-alpine` without digest | `actionlint` job red | — |
| Old Node | `pnpm install` under Node 22 | refused with pnpm's engine error | — |
| Dry run | `release.yml` run by hand | gate and both builds pass, nothing pushed, no attestation | — |
| Tag push | `vX.Y.Z` | image with SBOM and provenance, attestation in the registry and on GitHub, immutable release | — |
| `ofx-js` bump | Dependabot run | no pull request for `ofx-js` | — |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` -- actions to pin: `actions/checkout@v5`, `pnpm/action-setup@v4`, `actions/setup-node@v5` (L36-38, L52-54, L79), `actions/upload-artifact@v5` (L65), `docker://rhysd/actionlint:1.7.11` (L209). Pin-check step goes in `actionlint` after checkout.
- `.github/workflows/release.yml` -- `actions/checkout@v5`, `docker/setup-qemu-action@v3`, `docker/setup-buildx-action@v3`, `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6` (twice). The arm64 probe build (`load: true`) keeps no SBOM or provenance; only the final multi-platform build gets them. Final build needs an `id:` for its `digest` output.
- `Dockerfile` -- `FROM` L9 (`--platform=$BUILDPLATFORM` stays before the image) and L25. `corepack enable` then verifies pnpm's hash.
- `package.json` -- `packageManager`, `engines`, `typescript: ~7.0.2`. `packages/api/package.json` (`papaparse`), `packages/app/package.json` (`qrcode.react`, `recharts`), `pnpm-workspace.yaml` catalog. Run `pnpm install` so `pnpm-lock.yaml` records the new specifiers; resolved versions must not change.
- `.npmrc` -- already sets `manage-package-manager-versions=true`; add `engine-strict=true`.
- `docs/deployment.md` « Upgrading » (L101) -- new subsection. The ghcr package is already public; `gh attestation verify` still needs a signed-in `gh`, so say so.
- `AGENTS.md` « Security » and « Deployment » paragraphs.
- Resolving pins: `gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, then `.../git/tags/<sha>` when the object is a tag; `docker buildx imagetools inspect node:24-alpine` for the index digest; pnpm's hash from `npm view pnpm@10.34.5 dist.integrity` converted to hex, or from `corepack use pnpm@10.34.5`.

## Tasks & Acceptance

**Execution:**
- [ ] `.github/workflows/ci.yml` -- first the pin-check step, run locally against the current files to see it fail; then pin every action and `setup-node` from `.node-version`.
- [ ] `.github/workflows/release.yml` -- pin, SBOM, provenance, attestation, permissions.
- [ ] `Dockerfile`, `package.json`, `.node-version`, `.npmrc`, package manifests, catalog, `pnpm-lock.yaml` -- pins, engines and carets.
- [ ] `.github/dependabot.yml` -- as in Boundaries, with a why-comment on the `ofx-js` ignore.
- [ ] `docs/deployment.md`, `AGENTS.md` -- as in Boundaries.
- [ ] Open the pull request, then `gh workflow run release.yml --ref <branch>`; paste the run id and result.
- [ ] `gh api -X PUT repos/leger-dosage/archant/immutable-releases`, read back.
- [ ] After merge and the owner's `v0.2.1` tag: `gh attestation verify`, `docker buildx imagetools inspect ghcr.io/leger-dosage/archant:0.2.1 --format '{{json .SBOM}}'`, and `gh release view v0.2.1 --json isImmutable`; paste the outputs.

**Acceptance Criteria:**
- Given the pull request, when CI runs, then all seven required checks pass, the `image` job building from the pinned base.
- Given the merged Dependabot configuration, when its first runs finish, then `gh run list --repo leger-dosage/archant --event dynamic` shows a successful « Dependabot Updates » run for `npm`, `github_actions` and `docker`; the output is pasted.
- Given the `v0.2.1` image, when `gh attestation verify oci://ghcr.io/leger-dosage/archant:0.2.1 --repo leger-dosage/archant` runs, then it succeeds and the output is pasted.

## Design Notes

Sure configures `bundler` and `github-actions` only, ungrouped. The npm grouping and the `docker` ecosystem come from the epic: Archant has one Dockerfile base and a pnpm workspace where a weekly flood of patch bumps would each run the full e2e suite.

Dependabot may not update a `docker://` reference inside a workflow. If its first run skips `rhysd/actionlint`, record it here and in `deferred-work.md`; the pin stays.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked change.
- `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.11 -color` -- no finding.
- `docker compose build --build-arg APP_VERSION=0.0.0` -- builds from the digest.

## Implementation Notes

## Spec Change Log

## Review Triage Log
