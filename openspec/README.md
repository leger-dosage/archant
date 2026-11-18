# OpenSpec in Archant

[Reference specifications](specs/) describe current behaviour. A folder in [changes/](changes/) gathers a proposal, any design decisions, a checklist and the specification delta for one change. The delta says which requirements are added, changed or removed.

## Work on a change

Install the repository dependencies with `pnpm install --frozen-lockfile`. Use the OpenSpec version from the lockfile through `pnpm exec openspec`.

1. Find an existing proposal with `pnpm exec openspec list`. For a new proposal, use `$openspec-propose` in Codex or `/opsx:propose` in Claude Code.
2. Read the existing specification and any prerequisites. Update the proposal and delta when the implementation would change the agreed behaviour.
3. Implement with `$openspec-apply-change` or `/opsx:apply`. Check off the tasks as each passes.
4. Archive the completed change with `$openspec-archive-change` or `/opsx:archive` and sync its delta.
5. Run the [repository checks](../CONTRIBUTING.md#check-it), including `pnpm lint:spec`. Commit the reference specification and archived change with the implementation.

The agent integrations are checked in. Refresh them with `pnpm exec openspec init --tools codex,claude --profile core` when updating the OpenSpec tooling. OpenSpec documents its [project layout and workflow](https://github.com/Fission-AI/OpenSpec/blob/main/docs/README.md).

## Pending changes

Use `pnpm exec openspec list` for current status. The table maps story numbers from the [previous tracker](../docs/archive/bmad/implementation-artifacts/sprint-status.yaml) to their proposed changes. Check the prerequisite named in each proposal before starting. For work beyond these proposals, see the [feature inventory](../docs/archive/bmad/planning-artifacts/feature-inventory.md) and [deferred findings](../docs/archive/bmad/implementation-artifacts/deferred-work.md).

| Story | Change                                                                                                                                          | Prerequisite                                                         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 34.10 | [Sure's layout under Archant's visual style](changes/sures-layout-under-archants-visual-style/proposal.md)                                      |                                                                      |
| 35.1  | [Start the month on the household's chosen day](changes/start-the-month-on-the-households-chosen-day/proposal.md)                               | [36.6](changes/archive/2026-11-18-household-preferences/proposal.md) |
| 35.2  | [Budget every category as Sure](changes/budget-every-category-as-sure/proposal.md)                                                              |                                                                      |
| 35.3  | [Sure's budget tools' inputs](changes/sures-budget-tools-inputs/proposal.md)                                                                    |                                                                      |
| 35.5  | [Bills reserved inside each envelope](changes/bills-reserved-inside-each-envelope/proposal.md)                                                  |                                                                      |
| 35.6  | [Pledge a deposit toward a goal](changes/pledge-a-deposit-toward-a-goal/proposal.md)                                                            | [35.9]                                                               |
| 35.7  | [Spend a goal](changes/spend-a-goal/proposal.md)                                                                                                |                                                                      |
| 35.8  | [Count contributions on an investment-backed goal](changes/count-contributions-on-an-investment-backed-goal/proposal.md)                        |                                                                      |
| 35.10 | [Budgets and goals on a Plan page](changes/budgets-and-goals-on-a-plan-page/proposal.md)                                                        |                                                                      |
| 35.11 | [Filter, search and summarise goals](changes/filter-search-and-summarise-goals/proposal.md)                                                     | [35.9]                                                               |
| 35.12 | [Refresh a months-of-expenses reserve monthly](changes/refresh-a-months-of-expenses-reserve-monthly/proposal.md)                                |                                                                      |
| 35.14 | [Explain a goal's state on its page](changes/explain-a-goals-state-on-its-page/proposal.md)                                                     | [35.9]                                                               |
| 36.1  | [Reset a forgotten password by e-mail](changes/reset-a-forgotten-password-by-e-mail/proposal.md)                                                |                                                                      |
| 36.2  | [A member who writes, and a guest as Sure's](changes/a-member-who-writes-and-a-guest-as-sures/proposal.md)                                      |                                                                      |
| 36.3  | [Guests open on the assistant](changes/guests-open-on-the-assistant/proposal.md)                                                                | [36.2](changes/a-member-who-writes-and-a-guest-as-sures/proposal.md) |
| 36.4  | [Share each account with chosen members, and personal budgets](changes/share-each-account-with-chosen-members-and-personal-budgets/proposal.md) | [36.2](changes/a-member-who-writes-and-a-guest-as-sures/proposal.md) |
| 36.7  | [Sign in with a passkey](changes/sign-in-with-a-passkey/proposal.md)                                                                            |                                                                      |
| 36.8  | [Sign in through OpenID Connect](changes/sign-in-through-openid-connect/proposal.md)                                                            | [36.2](changes/a-member-who-writes-and-a-guest-as-sures/proposal.md) |

[35.9]: changes/archive/2026-11-18-a-goals-pace-and-history-as-sure/proposal.md

## Completed changes

- 36.6 [Household preferences](changes/archive/2026-11-18-household-preferences/proposal.md).
- 37.3 [Cover both languages end to end](changes/archive/2026-11-18-cover-both-languages-end-to-end/proposal.md).

- Story 35.13. [Sure's `create_goal` contract](changes/archive/2026-11-18-sures-create-goal-contract/proposal.md).
- Story 36.5: [Two-factor backup codes as Sure's](changes/archive/2026-11-18-two-factor-backup-codes-as-sures/proposal.md).
