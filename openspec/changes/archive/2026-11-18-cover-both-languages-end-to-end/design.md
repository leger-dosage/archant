## Approach

Extend `packages/app/e2e/language.spec.ts`, which already checks language detection and preferences in English. Use its `en-US` browser context alongside the French suite. Keep the shared administrator preference unset and check the actual labels and outcomes of the covered flows.

## Source

Story 37.3 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
