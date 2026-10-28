# Engineering Principles

These principles are the shared default for the Code Engineering skill group.

## Precedence

1. Explicit user requirements and safety constraints.
2. Explicit project contracts, standards, ADRs, specs, and public APIs.
3. Established project architecture when it is coherent and intentional.
4. These default engineering principles.

Do not reshape a mature project merely to match this skill group's preferred style.

## Defaults

- Preserve observable behavior during refactoring unless behavior change is explicitly authorized.
- Prefer module-first organization: group code around business/capability ownership before technical categories.
- Keep responsibilities cohesive and dependencies explicit.
- Keep policy inward and volatile infrastructure outward.
- Make external systems replaceable behind ports/adapters when that boundary is real and useful.
- Use Strategy for real algorithm variation; use Plugin for independently addable/removable extensions.
- Prefer the simplest design that supports current requirements and known variation.
- Do not create interfaces, factories, managers, registries, plugins, strategies, or adapters solely for aesthetics.
- Treat tests, type systems, linters, structural rules, and CI as executable architecture feedback where practical.
- Keep important project knowledge navigable for both humans and AI agents.
- Record why/invariants/tradeoffs where code alone cannot reliably preserve intent.
- Prefer evidence over claims. No fresh verification means no claim of verified completion.

## Quality Goal

Optimize for software that is easier to understand, modify, test, review, and safely delegate to AI—not for minimum line count, maximum abstraction count, or pattern density.
