---
name: engineering-documentation
description: Create or synchronize repository/package/app/module engineering documentation such as README, AGENTS instructions, ADRs, architecture indexes, and focused module docs. Describe the current system, boundaries, data flow, contracts, verification, and navigation for humans and AI. Do not change runtime behavior or source-code comments.
---

# Engineering Documentation

Maintain a navigable repository-level knowledge system for humans and AI.

Read:

- `./references/_shared/engineering-documentation.md`
- `./references/_shared/engineering-principles.md`
- `./references/_shared/module-first-architecture.md`
- `./references/_shared/layered-architecture.md`

Load the target project's existing documentation conventions before creating or restructuring documents.

## Scope

This Skill maintains engineering documents such as:

- repository/package/app/module README files;
- AGENTS.md or equivalent AI modification instructions;
- ADRs;
- architecture/navigation indexes;
- focused module/design/contract documentation when the project uses them.

It does not add or rewrite source-code comments. Use `$code-comments` for that.

## Workflow

1. **Map existing sources of truth** — inspect README, AGENTS, requirements/specs, ADRs, architecture docs, indexes, and relevant code. Avoid parallel documentation systems.
2. **Understand current reality** — documentation must describe accepted contracts and the current implementation, not an aspirational architecture.
3. **Clarify document roles** — keep repository overview, local modification rules, durable decisions, and deep design detail in the appropriate document type.
4. **Build progressive navigation** — make it possible to navigate Repository → App/Package → Module → Contract/ADR/focused docs without a single giant document.
5. **Synchronize important knowledge** — purpose, capabilities, responsibilities/non-responsibilities, public/internal boundaries, dependencies, data/state/side-effect flow, extension points, contracts/invariants, verification commands, and environment gates where relevant.
6. **Keep AGENTS actionable** — only add durable modification rules, dependency constraints, required reading, invariants, and verification requirements that materially guide AI work.
7. **Use ADRs for durable decisions** — record Context / Decision / Alternatives / Consequences when a decision is important enough to outlive the implementation discussion.
8. **Verify navigation** — check links, commands, examples, indexes, and referenced paths where practical.

## Boundaries

- Do not change runtime behavior.
- Do not edit source-code comments as part of this Skill.
- Do not silently rewrite requirements/history to match current code.
- Do not create a second documentation hierarchy when an established one already exists.
- Do not fill docs with low-value implementation trivia that is better represented by code or contracts.

## Output

Summarize:

- documents created/updated;
- navigation or ownership improvements;
- stale/conflicting documentation corrected;
- verification performed;
- documentation debt intentionally left open.
