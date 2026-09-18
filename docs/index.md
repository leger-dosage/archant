# Documentation index

Long-lived project knowledge. Planning and implementation artifacts live in `_bmad-output/`, not here.

| Document                                   | What it covers                                             |
| ------------------------------------------ | ---------------------------------------------------------- |
| [project-overview.md](project-overview.md) | What Archant is, which Sure features are in scope, and why |
| [tech-stack.md](tech-stack.md)             | Every dependency, its role, and its current version        |
| [deployment.md](deployment.md)             | Docker, Turso, the other targets, and the scheduled sync   |
| [adr/](adr/)                               | Architecture decision records                              |

## Decision records

An ADR is immutable once accepted. A new decision creates a new ADR that supersedes the old one; it never edits it in place.

| ADR                                                                          | Status                              |
| ---------------------------------------------------------------------------- | ----------------------------------- |
| [0001-technology-stack.md](adr/0001-technology-stack.md)                     | Accepted, partly superseded by 0002 |
| [0002-container-reference-target.md](adr/0002-container-reference-target.md) | Accepted                            |
