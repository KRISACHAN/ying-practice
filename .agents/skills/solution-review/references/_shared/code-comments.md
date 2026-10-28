# Structured Code Comments

Code comments are a **code-level knowledge layer** for humans and AI. Their goal is not to maximize or minimize comment count; their goal is to make requirements, capabilities, responsibilities, boundaries, and design intent understandable where code alone is insufficient.

## What Comments Should Communicate

Use comments to preserve relevant semantic context such as:

- **Purpose** — why this module/class/function exists in the system;
- **Capability** — what capability it provides to callers or the surrounding module;
- **Responsibility** — what work it owns;
- **Boundary / Non-responsibility** — what it deliberately does not own;
- **Contract / Invariant** — behavior or conditions that must remain true;
- **Lifecycle / Ordering / Side effects** — important sequencing, state transitions, IO, transactions, concurrency, or mutation;
- **Tradeoff / Why** — why a non-obvious implementation or constraint is intentional;
- **Requirement semantics** — domain/product meaning that cannot be reconstructed safely from syntax alone.

Do not write comments merely to repeat syntax, variable names, or obvious control flow.

## Comment Hierarchy

### Module / File

For important modules or files, provide enough context for a new maintainer or AI agent to understand the local capability before reading the implementation.

Useful fields may include:

```text
Purpose
Capabilities
Responsibilities
Non-responsibilities
Key contracts / invariants
Important dependencies or lifecycle
```

Do not force every field into every file. Use the structure that carries real information.

### Class / Public API / Major Component

Document externally meaningful behavior, ownership, extension points, invariants, errors, side effects, and lifecycle when they are not obvious from the type/signature alone.

### Function / Method

Document business semantics, preconditions, outputs, side effects, failure behavior, ordering constraints, or algorithmic intent when these materially help understanding.

Small self-explanatory functions do not need ceremonial comments.

### Inline

Use inline comments for local reasoning that future readers could otherwise misinterpret: compatibility workarounds, subtle ordering, normalization rules, performance tradeoffs, recovery behavior, or intentionally unusual implementation choices.

## Structured, Not Mechanical

Prefer consistent semantic labels where they improve scanning, but do not require a rigid template everywhere.

Example:

```text
Purpose: ...
Capabilities: ...
Boundary: ...
Invariant: ...
```

A short comment containing only the one important invariant can be better than a large empty template.

The rule is: **structured meaning, adaptive depth**.

## Relationship to Code Quality

Comments do not replace clear code. If a function is confusing because responsibilities or abstraction levels are mixed, record the structural problem and refactor when authorized.

However, do not remove useful requirement/capability context merely because "clean code should explain itself". Code explains mechanics well; comments preserve semantic intent that mechanics may not reveal.

## Synchronization

When requirements, behavior, ownership, contracts, lifecycle, or important tradeoffs change, update the affected comments in the same change or explicitly record the comment debt.

Follow the target project's language and documentation conventions. Do not impose Chinese/English comment language globally when the project already has a coherent convention.
