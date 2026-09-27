---
title: 'Story 13.7: Hosting at home behind Tailscale'
type: 'chore'
created: '2026-09-27'
status: 'done'
baseline_commit: 'fcd1558d036e868ba7b7b4b798ce833b09a43b27'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-13-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `docs/deployment.md` describes the container, a generic reverse proxy and sandbox banking, but nothing takes the owner from a machine at home to Archant reachable only on their tailnet and connected to a real bank. Its « Other targets » still calls Cloudflare Workers possible in principle, which the hosting research of 2026-09-26 refuted.

**Approach:** A new `docs/hosting.md` walks the home setup end to end and points to `docs/deployment.md` for everything already documented there. `docs/deployment.md` gains the production registration with the `ts.net` redirect and the real reason Cloudflare Workers with D1 does not fit.

## Boundaries & Constraints

**Always:**
- `docs/hosting.md` covers, in the order a self-hoster follows them: hardware (always-on, SSD, full-disk encryption; not a Raspberry Pi on an SD card), Docker, joining the tailnet, MagicDNS and HTTPS certificates enabled in the admin console, `tailscale serve --bg 8787` giving `https://<machine>.<tailnet>.ts.net`, `ARCHANT_URL` set to that address in `.env`, the port left on `127.0.0.1` with no `compose.override.yml`, `TRUSTED_PROXIES` set to the Docker gateway as « Behind a reverse proxy » says, the setup token, `SYNC_SECRET` and the daily `POST /api/sync` from the host's cron on `http://127.0.0.1:8787`, then « Connecting a bank ».
- It says the machine's full name lands in the public certificate transparency log once HTTPS is on, so the name must not reveal anything, and that the tailnet shrinks the attack surface without replacing the password and two-factor sign-in.
- A « VPS instead » section: the same steps on a VPS joined to the tailnet, with every inbound port closed except SSH, for when home is not an option.
- Backups: link the `VACUUM INTO` recipe in [Backups](deployment.md#backups), suggest copying the file to another device from time to time, and state that nothing else is backed up: a dead or stolen machine loses everything since the last manual copy.
- What to keep off the machine: `ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` in a password manager, apart from the backups. Losing `ENCRYPTION_KEY` means reconnecting every bank; losing `BETTER_AUTH_SECRET` signs out every session and voids two-factor, recovered with `reset-password`.
- « Connecting a bank » keeps its heading and `#connecting-a-bank` anchor. Production registration: restricted mode through « Activate by linking accounts », a `ts.net` row in the redirect URL table, and one sentence saying the bank sends the owner's browser back to that address, which resolves only on the tailnet, while every call to Enable Banking leaves the server outbound.
- Decision (owner, 2026-09-27): the guide does not claim that Enable Banking accepts a `ts.net` redirect URL. It says no one has confirmed it yet, tells the reader to register it on a sandbox application first, and says plainly that a refusal leaves no documented path.
- « Other targets » replaces the Cloudflare bullet with the limits: 10 ms of CPU and 50 subrequests per request on the free plan, each D1 query counting as one, no interactive transaction where the API opens 46, and every query refused for the rest of the day past 100,000 rows written.
- Every command and value matches the code: the setup token is a `warn` line in `docker compose logs archant`; `/api/sync` is exempt from `csrf()` (`packages/api/src/app.ts:226`).

**Never:** no change to application code, `docker-compose.yml` or CI; no scheduled or off-site backup tool; no Tailscale Funnel; no new dependency, including a Markdown link checker.

</frozen-after-approval>

## Code Map

- `docs/deployment.md:39` -- already names Tailscale beside the loopback port; `docs/hosting.md` links here, it does not repeat it.
- `docs/deployment.md:73-83` -- « Behind a reverse proxy »: the `docker network inspect` command for the gateway. `tailscale serve` on the host reaches the container through that gateway, so `TRUSTED_PROXIES` applies as for any proxy (`packages/api/src/lib/client-address.ts` `forwardedFor`, `clientKey`); without it every device shares one sign-in bucket.
- `docs/deployment.md:126-153` -- « Backups »: the recipe to link, unchanged.
- `docs/deployment.md:159-180` -- « Sandbox or production » and « 1. Register the application »: add the production walk-through and the `ts.net` table row.
- `docs/deployment.md:226-233` -- « Scheduled synchronisation »: the cron line to adapt to loopback.
- `docs/deployment.md:245-263` -- `reset-password` and two-factor, linked from the secrets section.
- `docs/deployment.md:265-272` -- « Other targets »: the Cloudflare bullet to replace.
- `docs/index.md` -- table of documents; add `hosting.md`.
- `README.md:93` -- points to `docs/deployment.md`; add `docs/hosting.md`.
- `AGENTS.md` « Deployment » -- lists what `docs/deployment.md` covers; add one sentence for `docs/hosting.md`.
- `_bmad-output/planning-artifacts/epics.md` Epic 13 intro -- source of the Cloudflare limits and the hosting ranking.

## Tasks & Acceptance

**Execution:**
- [x] `docs/hosting.md` -- write the guide per Boundaries -- the owner's path, in one page.
- [x] `docs/deployment.md` -- production registration, `ts.net` redirect row, Cloudflare limits; link `hosting.md` from the intro -- the reference stays the single place for each recipe.
- [x] `docs/index.md`, `README.md`, `AGENTS.md` -- link or mention `docs/hosting.md` -- so it can be found.

**Acceptance Criteria:**
- Given `docs/hosting.md`, when read top to bottom, then every step from bare machine to first bank sync is present, each existing recipe is linked rather than copied, and the certificate transparency warning, the VPS fallback, the backup truth and the two secrets with their loss costs are there.
- Given « Other targets », when it lists Cloudflare, then it names the free-plan limits and no longer calls it possible.
- Given the finished story, when `pnpm format` then `pnpm lint:format` run, then both pass and `grep -n '^## Connecting a bank$' docs/deployment.md` finds the heading.
- Given every Markdown link added or changed, when checked by hand against the target file and heading, then each resolves.

## Implementation Notes

- The sync header lives in `~/.archant-sync-header`, read with `curl --header @file`, so the secret shows neither in the crontab nor in the process list.
- Two additions beyond the list: disable the machine's Tailscale key expiry, and the passphrase prompt a full-disk encryption leaves after a power cut.
- Review added a `docker login ghcr.io` note while the image package is private, a run-once warning on the `.env` block, and a Linux with Docker Engine assumption.
- Internal links and anchors were checked with a one-off script against the headings of each target file.

## Spec Change Log

## Review Triage Log

| Finding | Verdict | Evidence / route |
|---|---|---|
| Anonymous pull of the private GHCR package fails at step 5 | medium | `docker manifest inspect` answers `unauthorized`; deferred-work 13.5 entry. Patch: `docker login ghcr.io` note. Making the package public stays the owner's call. |
| Pin `ARCHANT_VERSION` in the first `.env` | low | A literal version in the guide goes stale at the next release; the guide already points to Upgrading. Rejected. |
| "A leaked backup alone opens nothing" | medium | Only bank session ids and the Enable Banking key are encrypted; transactions are in clear. Patch. |
| No scheduled backup recipe | false | The owner deferred scheduled backups on 2026-09-27; the intent excludes it. Rejected. |
| "That copy is the only one" reads as an instruction | low | Direct rewording. Patch. |
| Gateway can change after `down` | low | `down` removes the network, `up` may pick another subnet. One-sentence patch. |
| `X-Forwarded-For` and `ts.net` left unconfirmed | false | Owner decision B, recorded in the frozen block. Rejected. |
| Renaming the machine changes the address | low | One-sentence patch. |
| No tailnet ACLs | low | One household's tailnet; adds scope. Rejected. |
| No host maintenance section | low | Outside the story's criteria. Rejected. |
| Step 7 relative `.env`, silent cron failures, cron time zone | low | Step 7 follows step 5 in the same directory; the rest adds guards. Rejected. |
| No remedy for the passphrase prompt after a power cut | low | The guide states the cost; remedies add scope. Rejected. |
| VPS leaves SSH open | low | SSH is the documented way in; Tailscale SSH adds scope. Rejected. |
| Cloudflare rewrite out of scope | false | The story's fifth criterion requires it. Rejected. |
| Re-running the `.env` block replaces the secrets | medium | `cat > .env` overwrites; losing both keys voids banks and sessions. Patch: run once. |
| `mkdir` failure skips `cd` | low | Rare, needs a guard. Rejected. |
| IPv6 entry at `IPAM.Config` index 0 | low | Compose's default network is IPv4 only unless enabled. Rejected. |
| Empty gateway appended | low | Default bridge networks have a gateway. Rejected. |
| Docker Desktop on a Mac sees another peer | maybe-false | Would need a Mac run. Patch anyway: the guide states Linux with Docker Engine and drops FileVault. |
| Duplicate `TRUSTED_PROXIES` lines | low | Needs a guard. Rejected. |
| Empty `SYNC_SECRET` in the header file | low | Step 5 writes it. Rejected. |
| Pre-existing header file keeps loose permissions | low | Needs a guard. Rejected. |
| Crontab edited as another user | low | Needs a guard. Rejected. |
| Pinned `ENABLE_BANKING_*` switch procedure | low | « Or pin them in the environment » already covers it. Rejected. |
| Recipes copied, not linked | low | The commands are adapted to loopback and `ts.net`, each section links its reference. Rejected. |

## Design Notes

The cron calls `http://127.0.0.1:8787` rather than the `ts.net` address: it keeps working when Tailscale is down or logged out, and the bearer secret never leaves the machine. The secret stays out of the crontab line itself, read from a file only the owner can read.

`pnpm lint:format` is `oxfmt --check .`: it formats Markdown but resolves no link. The story's last criterion is kept as a manual check rather than adding a link checker, which would be a new dependency for one story.

`tailscale serve` is documented to write the `X-Forwarded-*` headers, but no one has checked it here. Setting `TRUSTED_PROXIES` is harmless if it does not: `forwardedFor` then sees only the gateway, the same shared bucket as without the variable.

## Verification

**Commands:**
- `pnpm format && pnpm lint:format` -- expected: green, no tracked file changed by the second run.
- `grep -n '^## Connecting a bank$' docs/deployment.md` -- expected: one line.

**Manual checks:**
- Every relative link and anchor in `docs/hosting.md` and the changed parts of `docs/deployment.md` opens the intended heading on GitHub's rendering.
