# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists (glossary — created lazily by `/domain-modeling`).
- **`docs/adr/`** — repo-scoped architectural decisions. Workspace-wide decisions
  also live one level up in `../decisions/` (the Executive Assistant ADR log) —
  check both when a structural call comes up.
- `karaoke_project_handoff.md` and `karaoke_claude_design_brief.md` at the repo root.

If any of these don't exist, **proceed silently**. `/domain-modeling` creates them lazily when terms or decisions actually get resolved.

## Layout

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root; app code in `karaoke-app/`.

## Use the glossary's vocabulary

When output names a domain concept (issue title, refactor proposal, test name), use the term as defined in `CONTEXT.md` once it exists.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding.
