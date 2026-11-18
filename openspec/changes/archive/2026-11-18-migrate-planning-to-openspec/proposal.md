# Migrate planning to OpenSpec

## Why

The project needs a reference for current behaviour and a checklist per proposed change. The earlier sprint tracker mixes pending work with the history of shipped stories.

## What changes

- Adopt OpenSpec for proposals, specification deltas and implementation checklists.
- Write reference specifications for shipped capabilities and convert pending stories into OpenSpec changes.
- Preserve earlier planning and implementation records and remove the old workflow tooling.
- Validate OpenSpec documents in continuous integration.

## Capabilities

This is a change to development tooling. The reference specifications document the application as it exists at migration.

## Impact

Contributors use `openspec/` for proposals and reference specifications. Earlier decisions and test fixtures remain in `docs/archive/bmad/`.
