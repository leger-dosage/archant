---
title: 'Story 15.3: Welcome a contributor and a self-hoster'
type: 'chore'
created: '2026-09-30'
status: 'in-review'
baseline_commit: '2624c93548700f61281774e6b7aad3ec39ae035c'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-15-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A stranger landing on GitHub finds only `AGENTS.md`, written for agents (OSS-6); release notes list planning pull requests and hide breaking changes (OSS-7); the README hides the product's limits and clones over SSH (OSS-8); a self-hoster has no troubleshooting or security model page, and the « AD-n » references cited in 58 files and in lint messages point to a spine buried in `_bmad-output/` (OSS-9, STR-4, SEC-8). Community profile: 62 %.

**Approach:** Add the community files GitHub's profile expects, categorised release notes with a versioning policy, two self-hoster pages, move the architecture spine to `docs/architecture.md` behind a Vitest guard, rewrite the README's first screen, and set the repository description and topics through the GitHub API.

## Boundaries & Constraints

**Always:**
- Root: `CONTRIBUTING.md` for people (setup by link to the README, the seven gate commands, one pull request per change, no real bank data in issues or screenshots, translations welcome through i18next with strings in `packages/app/src/locales/fr.json`, a new locale discussed in an issue first, `AGENTS.md` and `docs/architecture.md` for depth, the `planning` and `breaking-change` labels); `CODE_OF_CONDUCT.md`, Contributor Covenant 2.1 verbatim, its enforcement contact « the maintainer, [@glarivie](https://github.com/glarivie), on GitHub », as the owner chose on 2026-09-30 knowing GitHub offers no private message; `SUPPORT.md` (read `docs/troubleshooting.md`, then open a bug form; security goes through `SECURITY.md`; Discussions are off).
- `.github/ISSUE_TEMPLATE/bug.yml`: required version (« Version x.y.z » at the bottom of « Réglages », the image tag or `git rev-parse HEAD`), a deployment-target dropdown (published image, image built from a checkout, checkout run with `pnpm`, other), steps, expected, and a `render: text` logs field whose description forbids amounts, labels, IBANs, tokens and cookies, plus a required checkbox confirming it. `feature.yml` asks the problem and how Sure handles it, since Archant follows Sure. `config.yml`: `blank_issues_enabled: false`, contact links to the private advisory form and `docs/troubleshooting.md`.
- `.github/pull_request_template.md`: why, how it was tested, the reason for any new dependency, a gate checklist, made-up data only.
- `.github/release.yml`: `changelog.exclude.labels: [planning]`; categories in order « Before upgrading » (`breaking-change`), « Features » (`enhancement`), « Fixes » (`bug`), « Dependencies » (`dependencies`), « Other changes » (`*`).
- `docs/deployment.md`, a « Versions » subsection under « Upgrading »: semantic versioning, in 0.x a minor release may break; a deprecation is announced one minor release ahead; breaking changes appear under « Before upgrading » in the release notes. The existing loopback notes stay.
- `docs/troubleshooting.md`, one section per symptom, each quoting the exact log line or French message and the fix: pull refused with 401 or `denied` (stale `docker login` credentials → `docker logout ghcr.io`, a mistyped image or tag); `ORIGIN_MISMATCH` and « Archant est configuré pour une autre adresse » (`ARCHANT_URL`, which Compose passes as `BETTER_AUTH_URL`, must equal the address bar, then restart), and `BANK_REDIRECT_NOT_ALLOWED`; a lost setup token (`docker compose restart archant`, then `docker compose logs archant | grep 'Setup is open'`, last line); an expired consent (« Consentement expiré », « Reconnecter » in the banner or « Renouveler le consentement » on the connection page, 90 days at most); a disk full at the pre-migration copy (the fatal « could not be copied before migrating » line, the restart loop under `restart: unless-stopped`, free space for five copies).
- `docs/security-model.md`: AES-256-GCM with `ENCRYPTION_KEY` for Enable Banking session ids and the private key saved from the interface; `BETTER_AUTH_SECRET` for session cookies and the TOTP secret and backup codes; passwords hashed by Better Auth; what the server sends to Enable Banking (the endpoints of `connectors/enable-banking/client.ts`) and that the browser loads bank logos from Enable Banking's host; no telemetry, Better Auth's own switched off; logs hold ids, counts, durations and error codes, never an amount, a label or a payload, the setup token being the one secret printed; when `TRUSTED_PROXIES` names the Docker gateway, every process on the host can forge `X-Forwarded-For`, so the host is trusted.
- `git mv` the spine to `docs/architecture.md`, frontmatter paths rewritten from `docs/`; `.memlog.md` and `reviews/` stay. Update the references in `epics.md`, `DESIGN.md`, `EXPERIENCE.md`; past story specs keep their text. Link it from `AGENTS.md` (which says the spine is edited there) and `docs/index.md`, with `troubleshooting.md` and `security-model.md`.
- A Vitest spec, written first and seen failing: every `\bAD-(\d+)\b` under `packages/` (skipping `node_modules`, `dist`, `coverage`, `test-results`, `playwright-report`), in `.oxlintrc.json`, `AGENTS.md` and `docs/` has a `### AD-n` heading in `docs/architecture.md`; it fails if it finds no reference at all.
- README first screen: badges (CI on `main`, licence, latest release), French-only interface and EUR reporting currency, two screenshots (dashboard, transactions) of made-up data in `docs/images/`, HTTPS clone, the feature list linking `docs/sure-parity.md`, a line saying `_bmad-output/` holds the planning and per-story records, and « Contributing » pointing to `CONTRIBUTING.md`.
- `docs/hosting.md`: drop the stale « while the package is private » sentence (an anonymous pull of `0.2.1` answers 200 on 2026-09-30); link `security-model.md` where it sets `TRUSTED_PROXIES`.
- Through `gh api`, as approved on 2026-09-30: description « Self-hosted personal finance for one household: your bank synced through Enable Banking (PSD2), your data in your own SQLite. », topics `self-hosted`, `personal-finance`, `psd2`, `open-banking`, `sqlite`, `hono`, `react`, `typescript`. As the owner approved on 2026-09-30, also create the labels `planning` and `breaking-change`. Read everything back and paste it.
- `AGENTS.md`: planning and tracking pull requests carry `planning`; a pull request that breaks an upgrade carries `breaking-change` and says what to do in its description.

**Ask First:** any repository write beyond description, topics and the two labels; changing `SECURITY.md`.

**Never:** no CodeQL, CI job or workflow change; no `img-src` directive (15.7); no language switch; no `CHANGELOG.md`; no rewording of the spine's decisions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unknown decision | a comment cites `AD-99` | spec fails, names file and `AD-99` | — |
| Spine missing | `docs/architecture.md` absent | spec fails | — |
| Planning pull request | labelled `planning` | absent from generated notes | — |
| Breaking pull request | labelled `breaking-change` | listed under « Before upgrading » | — |

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/architecture/architecture-archant-2026-09-21/ARCHITECTURE-SPINE.md` -- AD-1 to AD-18 as `### AD-n — title`; 189 references, all resolved today.
- `packages/api/src/architecture-references.spec.ts` (new) -- the guard; reads files with `node:fs`, root is `../../..` from the spec.
- `README.md` -- SSH clone at « Getting started », « Contributing » points to `AGENTS.md`.
- `docs/deployment.md` -- « Upgrading » L101, loopback notes L132-134, « Verifying an image » L138; L147 already says the image pulls anonymously.
- `docs/hosting.md:43` stale sentence; `:64-73` `TRUSTED_PROXIES`.
- `packages/api/src/index.ts:58-92` backup and fatal lines, `:114-118` setup token; `routes/middleware/same-origin.ts:31-36`; `lib/errors.ts`; `services/crypto.ts`; `lib/logger.ts`; `services/auth.ts:84-131`; `connectors/enable-banking/client.ts:41-60, 335-555`; `domain/bank-connection-alert.ts`; `packages/app/src/locales/fr.json` (keys under `banks`, `errors`, `setup`); `components/SettingsNav.tsx:40-72` version.
- `.oxfmtrc.json` ignores `_bmad-output` but not `docs/`: `pnpm format` reformats the moved spine; accept its tables and lists as rewritten.
- Screenshots: `pnpm test:e2e`'s server setup (port 8788, fresh SQLite) or `pnpm api start:dev` with a throwaway `DATABASE_URL`, accounts and transactions created through the API with made-up data, light theme, 1440×900.

## Tasks & Acceptance

**Execution:**
- [x] `packages/api/src/architecture-references.spec.ts` -- write, run, see it fail on the missing file.
- [x] `docs/architecture.md` -- `git mv`, fix frontmatter, update planning references; spec green.
- [x] `docs/troubleshooting.md`, `docs/security-model.md`, `docs/index.md`, `docs/hosting.md`, `docs/deployment.md` -- as in Boundaries.
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SUPPORT.md`, `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md`, `.github/release.yml` -- as in Boundaries.
- [x] `docs/images/*.png`, `README.md`, `AGENTS.md` -- as in Boundaries.
- [ ] GitHub -- description, topics, labels; read back; after merge, `gh api repos/leger-dosage/archant/community/profile --jq .health_percentage` and paste it.

**Acceptance Criteria:**
- Given the merged story, when the community profile is read, then `health_percentage` is 100.
- Given the pull request, when CI runs, then all seven required checks pass and `pnpm lint:format` covers the new Markdown and YAML files.
- Given the bug form on github.com, when a stranger opens a new issue, then the form shows, the blank issue does not, and the logs field warns against bank data.

## Design Notes

The epic places `img-src` for bank logos in the Content-Security-Policy work; today no `img-src` exists, so the security model states the current fact and 15.7 changes it. Sure has no code of conduct, support page, pull request template or `release.yml`; GitHub's community profile settles those, as the epic allows. The spine keeps its BMAD frontmatter so `bmad-architecture` can still update it; its run history stays in `_bmad-output/`.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm format && pnpm lint:code && pnpm lint:format && pnpm typecheck && pnpm test && pnpm test:e2e` -- green, no tracked change.
- `git grep -n "ARCHITECTURE-SPINE" -- AGENTS.md docs packages .oxlintrc.json` -- nothing.

## Implementation Notes

- The guard failed first on the missing `docs/architecture.md` (both tests), then passed after the move. A temporary `docs/zz-tmp.md` citing `AD-99` failed it with `{ file: 'docs/zz-tmp.md', id: 'AD-99' }`.
- `pnpm format` rewrote only the spine's frontmatter quotes and table alignment; a word diff shows no changed word.
- `reviews/` keep their `../ARCHITECTURE-SPINE.md` paths: they record a review of the file where it stood.
- `docs/deployment.md` « Docker — the reference target » cloned over SSH too; it now clones over HTTPS, like the README.
- The screenshots come from a throwaway script, not committed: a fresh server on port 8791 with a temporary SQLite file, an administrator « Camille » created through `/api/setup`, six accounts and seven months of made-up transactions created through the API, card payments and savings moves paired as transfers, light theme at 1440×900, the dashboard on its « 6 M » range.
- GitHub read-back on 2026-09-30, after the writes:
  - `gh api repos/leger-dosage/archant --jq '{description, topics}'` → `{"description":"Self-hosted personal finance for one household: your bank synced through Enable Banking (PSD2), your data in your own SQLite.","topics":["hono","open-banking","personal-finance","psd2","react","self-hosted","sqlite","typescript"]}`
  - `gh label list --search planning` → `planning`, `C5DEF5`, « Planning or tracking change, left out of the release notes »
  - `gh label list --search breaking` → `breaking-change`, `B60205`, « An upgrade needs an action; listed under Before upgrading »
  - `has_discussions` is `false`, as `SUPPORT.md` says.
- Review: patches 1, 2, 4, 5, 6 and 17 of the triage log applied; the full gate then passed on the final tree (unit 143, 1,983 and 311 tests; end-to-end 312 in 4.0 min) with no tracked change. The story stays `in-review` until the profile read-back below, as 15.2 did for its attestation.
- Left for after merge: `gh api repos/leger-dosage/archant/community/profile --jq .health_percentage`.

## Spec Change Log

## Review Triage Log

| # | Layer | Finding | Verdict | Evidence | Route |
|---|---|---|---|---|---|
| 1 | blind, edge | `AGENTS.md` says `bmad-architecture` updates the spine in place | medium | its `customize.toml` keeps `spine_output_path` under `_bmad-output/` and `lint_spine.py` names `ARCHITECTURE-SPINE.md` | patch: the sentence says a run writes under `_bmad-output/` and lands its result in `docs/architecture.md` |
| 2 | blind | Security model says the server calls one host, ignoring Turso | medium | `.env.example` and `docs/deployment.md` document a `libsql://` `DATABASE_URL` | patch: one paragraph |
| 3 | blind | « Two values » under `ENCRYPTION_KEY` hides the two-factor secrets | false | the sentence is scoped to `ENCRYPTION_KEY`; the next paragraph covers `BETTER_AUTH_SECRET` | rejected |
| 4 | blind | Losing `ENCRYPTION_KEY` is not described | low | `.env.example` states the cost; one sentence | patch |
| 5 | blind | `SYNC_SECRET` absent from the security model | medium | `POST /api/sync` is reachable without a session | patch: a section; the route returns ids and outcomes only (`syncAll`) |
| 6 | blind | « Versions » omits that `ARCHANT_VERSION` defaults to `latest` | low | `docker-compose.yml` `${ARCHANT_VERSION:-latest}`; one sentence | patch |
| 7 | blind | A plain question has no issue form | low | `SUPPORT.md` routes questions to the two forms; the fix adds a template | rejected |
| 8 | blind | Bug form lacks architecture and proxy fields | low | new fields, not a correction | rejected |
| 9 | blind, edge | Guard reads PNGs, skips README, `.github/`, root files, gitignored files, symlinks, `AD-07` | low | no citation exists in those files; the spec fixes the scanned set; `node_modules` symlinks are skipped by name | rejected |
| 10 | blind | Missing spine gives `ENOENT` in the second test | false | the first test fails with an assertion; the matrix row asks only that the spec fails | rejected |
| 11 | blind | `reviews/` link to the old path | low | the spec keeps them as the record of a review at that place | rejected |
| 12 | blind | Spine frontmatter `scope`, `binds`, `updated` are stale | low | pre-existing; the story moves the file, it does not revise it | rejected |
| 13 | blind | Long table lines after `pnpm format` | low | formatter output, the repository's rule | rejected |
| 14 | blind | Spec `in-review` while sprint status says `in-progress` | false | step 5 moves the sprint status on | rejected |
| 15 | blind | `CONTRIBUTING.md` lacks licence, fork flow, single-test command | low | additions beyond the spec's list | rejected |
| 16 | blind | Pull request template has no documentation checkbox | low | addition beyond the spec | rejected |
| 17 | blind | Lost setup token covers Docker only | low | one sentence, as the page does for `BETTER_AUTH_URL` | patch |
| 18 | edge | A pull request labelled both `planning` and `breaking-change` vanishes | low | exclusion wins in GitHub's notes; unlikely and the fix adds a rule | rejected |
| 19 | verification-gap | none | — | — | — |
