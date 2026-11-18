## Approach

Configure Better Auth's generator for new enrolments and keep its existing verifier compatible with codes already issued. Disable the regeneration endpoint and remove the interface control. Keep password verification on disable, which Sure now also requires in [`MfaController#disable`](https://github.com/we-promise/sure/blob/655f65f8cbbe57c3dd9107e3ae07fa9b359e500f/app/controllers/mfa_controller.rb#L142).

## Source

Story 36.5 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
