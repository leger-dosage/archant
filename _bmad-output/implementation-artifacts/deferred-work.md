- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-create-an-account-and-see-it-listed.md`
  summary: Test `unwrap` in `packages/web/src/lib/api.ts` against a 400 with fields, an unknown code, the proxy's HTML page and a rejected fetch.
  evidence: No spec references `unwrap` or `ApiError`; losing `fields` there would send every validation error to the generic toast without failing a test.
- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-create-an-account-and-see-it-listed.md`
  summary: Update the Quick Setup section of `AGENTS.md`, which still says no package exists and there is nothing to start.
  evidence: Story 1.1 creates the three packages and the four start commands work; the review workflow routes agent-context edits to deferred work.
