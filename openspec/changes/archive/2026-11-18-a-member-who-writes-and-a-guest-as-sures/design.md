## Approach

Migrate the role constraints in `packages/data/schema/auth.ts` and `packages/data/schema/invitations.ts` together. Review the protected routes in `packages/api/src/app.ts` before opening household writes to members. Explicitly guard administration writes that currently rely on `viewerReadOnly`, including those in `bank-connections.ts`, `members.ts`, `assistants.ts` and `prices.ts`. Use the same permissions to show or hide interface controls. Cancel outstanding invitations and revoke assistant access in `services/members.ts` on both administrator demotion paths. Keep the personal Better Auth routes available.

## Source

Story 36.2 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
