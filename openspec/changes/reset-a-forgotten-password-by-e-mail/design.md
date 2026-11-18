## Approach

Use Better Auth for the reset flow and retain the terminal reset command. Send links only when the mail server is configured and use the configured public origin. Invalidate outstanding links and sessions on success, as [Sure's password reset controller](https://github.com/we-promise/sure/blob/655f65f8cbbe57c3dd9107e3ae07fa9b359e500f/app/controllers/password_resets_controller.rb#L51) does. Apply rate limits to anonymous requests and keep tokens out of logs. Coordinate with OpenID Connect when present so this route cannot create a local credential.

## Source

Story 36.1 in `docs/archive/bmad/planning-artifacts/epics.md` records the original acceptance criteria and the Sure references.
