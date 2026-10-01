# Contributing to Archant

Thank you for helping. Archant is a small project run by one maintainer for one household's finances, so a focused change with a clear reason goes a long way.

## Before you start

- A bug: check [docs/troubleshooting.md](docs/troubleshooting.md), then open a [bug report](https://github.com/leger-dosage/archant/issues/new?template=bug.yml).
- A feature: open a [feature request](https://github.com/leger-dosage/archant/issues/new?template=feature.yml) before writing code. Archant re-implements features of [Sure](https://github.com/we-promise/sure) one at a time, and [docs/sure-parity.md](docs/sure-parity.md) says which ones it has and why; the request asks how Sure handles it.
- A vulnerability: never in an issue. Report it privately, as [SECURITY.md](SECURITY.md) says.

Never put real bank data in an issue, a pull request, a test or a screenshot: no real amount, label, IBAN, account number, token or cookie. Make the data up.

## Set up

Follow [Getting started](README.md#getting-started) in the README: Node.js and pnpm, `pnpm install --frozen-lockfile`, a `.env` with `BETTER_AUTH_SECRET`, then `pnpm api start:dev` and `pnpm app start:dev`.

## Make the change

One pull request per change: a fix, a feature, a refactor, never two of them together. Small pull requests get reviewed sooner.

[AGENTS.md](AGENTS.md) holds the conventions in depth: file names, comments, money as integer minor units, the API's error format, security rules, tests. [docs/architecture.md](docs/architecture.md) holds the architecture decisions, the « AD-n » that code comments and lint messages cite. Read both before a change bigger than a fix.

A new dependency needs a reason in the pull request description: dependencies stay few and popular.

## Translations

The interface is in French, through [i18next](https://www.i18next.com/). Every visible string lives in [`packages/app/src/locales/fr.json`](packages/app/src/locales/fr.json); fixes to its wording are welcome. A new language is a bigger change, with a locale file to keep complete and a way to pick it: open an issue to discuss it first. Code, comments, documents and API error messages stay in English.

## Check it

GitHub Actions checks every pull request with the same commands, `pnpm format` aside, plus a container build and a workflow lint, and a pull request merges only when every check passes. Run them locally first:

```bash
pnpm install --frozen-lockfile
pnpm format
pnpm lint:code
pnpm lint:format
pnpm typecheck
pnpm test
pnpm test:e2e
```

`pnpm lint:code` runs oxlint, then [knip](https://knip.dev/), which fails on a file, an export or a dependency nothing uses, except the exports of the modules a package publishes in its `package.json` `exports`: delete it rather than ignore it.

`pnpm test` ends with a second Vitest pass in the API, `volume`: it seeds 100,000 transactions and checks the performance target and the query plans, alone and without coverage so that the other tests' load does not skew the timings. Run it on its own with `pnpm --filter @archant/api exec vitest run --project volume`.

`pnpm test:e2e` needs Chromium once per machine: `pnpm --filter @archant/app exec playwright install chromium`. After the sequence, `git status` must show no change you did not mean to commit.

## Open the pull request

The pull request template asks why the change is needed, how you tested it, and the reason for any new dependency. Write the commit messages and the description in English.

Two labels shape the release notes:

- `planning`: planning and tracking pull requests, which change documents under `_bmad-output/` rather than the product. They are left out of the release notes.
- `breaking-change`: a pull request after which an upgrade needs an action from the self-hoster, such as a renamed variable. Its description says what to do, and the release notes list it under « Before upgrading ».

The maintainer adds the other labels.

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
