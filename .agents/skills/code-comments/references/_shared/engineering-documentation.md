# Engineering Documentation

Engineering documentation is the **repository-level knowledge and navigation layer** for humans and AI. It explains the current system across repository, app/package, module, contract, and architecture-decision boundaries.

## Document Roles

- **README** — what this repository/package/module is, why it exists, responsibilities/non-responsibilities, public entry points, architecture/data flow, usage, verification, and navigation.
- **AGENTS.md or equivalent** — durable rules for modifying the subtree: required reading, dependency constraints, invariants, forbidden changes, verification commands, and local workflow rules.
- **ADR** — durable architectural decisions: Context, Decision, Alternatives, Consequences.
- **Architecture / documentation index** — repository → app/package → module → contracts/specs/ADRs/important operational docs.
- **Module / design docs** — deeper explanations only where the code and README cannot carry the needed system-level context cleanly.

## Progressive Disclosure

Prefer layered navigation instead of one giant document:

```text
Repository
  ↓
App / Package
  ↓
Module
  ↓
Contract / ADR / focused design document
```

A maintainer or AI agent should be able to start broad and progressively reach the nearest relevant source of truth.

## Describe Reality

Documentation must describe the actual current implementation and accepted contracts, not an aspirational architecture that code does not implement.

When documentation and code disagree, determine the authoritative source first. Do not silently rewrite requirements/history merely to match current code, and do not silently change code to match stale prose.

## Avoid Parallel Sources of Truth

Before creating a new document, inspect existing README, AGENTS, requirements/specs, ADRs, architecture docs, and indexes. Extend the established system instead of creating a second competing documentation tree.

## Documentation Quality

Useful engineering docs make these easy to discover when relevant:

- purpose and capability;
- responsibilities and non-responsibilities;
- public/internal boundaries and ownership;
- dependency direction;
- data/state/side-effect flow;
- extension points and external integrations;
- important contracts and invariants;
- verification commands and environment gates;
- navigation to deeper sources of truth.

Do not fill docs with implementation trivia that becomes stale quickly. Link to code/contracts instead when those are the better source.

## Synchronization

When structure, ownership, public contracts, important lifecycle/data flow, verification commands, or architectural decisions change, update the relevant documentation in the same change or explicitly record documentation debt.

Verify links, commands, examples, and indexes where practical.
