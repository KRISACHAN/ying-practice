---
name: code-comments
description: Add or synchronize structured code comments for a repository, package, app, module, or file so humans and AI can understand requirements, capabilities, responsibilities, boundaries, contracts, lifecycle, and non-obvious design intent. Comments are a code-level knowledge layer, not syntax narration. Do not change runtime behavior or engineering documents.
---

# Code Comments

Make the code itself easier to understand as a local knowledge system.

Read:

- `./references/_shared/code-comments.md`
- `./references/_shared/engineering-principles.md`
- `./references/_shared/clean-code.md`

Load the target project's comment language/style conventions and the requirements/specs/docs needed to understand the code's actual semantics.

## Scope

This Skill edits **source-code comments and API documentation comments only**: file/module headers, JSDoc/TSDoc/docstrings, class/API/function comments, and meaningful inline comments.

It does not maintain README, AGENTS, ADR, architecture indexes, requirements, or other engineering documents. Use `$engineering-documentation` for those.

## Workflow

1. **Understand before commenting** — read enough code and authoritative requirements/docs to identify what the scope actually does. Never invent business meaning from names alone.
2. **Map the local capability** — identify purpose, provided capabilities, responsibilities/non-responsibilities, contracts/invariants, lifecycle/side effects, and important tradeoffs.
3. **Choose comment depth by level**:
   - important module/file → local capability and boundary context;
   - public API/class/major component → contract, ownership, lifecycle, side effects, extension semantics;
   - function/method → business semantics, preconditions, errors, ordering, side effects, algorithmic intent when useful;
   - inline → non-obvious local reasoning or compatibility constraints.
4. **Add structured semantic comments** — use labels such as Purpose / Capabilities / Responsibilities / Boundary / Invariant / Lifecycle / Tradeoff when they improve scanning. Do not mechanically require every field everywhere.
5. **Repair stale comments** — remove or rewrite comments that contradict current code/contracts or merely narrate old implementation details.
6. **Do not hide bad structure with prose** — when comments reveal mixed responsibilities or confusing control flow, report the refactoring opportunity; do not rewrite runtime code unless explicitly authorized by another task.
7. **Verify** — run the narrowest parser/type/lint/format checks needed to ensure comment/doc-comment syntax is valid and no accidental code behavior changed.

## Quality Standard

The goal is **sufficient semantic context**, not minimal comment count and not maximal comment density.

A good result lets a new engineer or AI agent understand:

```text
Why this code exists
What capability it provides
What it owns / does not own
What behavior must remain true
When and how it participates in lifecycle/state/side effects
Why important non-obvious decisions were made
```

Do not add comments solely because a function or file exists. Do not comment every line. Do not use comments as a substitute for clear naming and cohesive code.

## Boundaries

- Do not change runtime behavior.
- Do not invent requirements, invariants, or architectural intent that sources do not support.
- Do not rewrite README/AGENTS/ADR/architecture docs.
- Follow project language/style conventions instead of imposing a universal comment language.

## Output

Summarize:

- scopes/files commented;
- semantic context added or corrected;
- stale/low-value comments removed;
- structural problems discovered but intentionally not changed;
- verification performed.
