---
name: solution-review
description: Optional independent review of an engineering solution artifact before implementation: PRD/spec, feature or bugfix plan, architecture/design proposal, migration plan, or refactor plan. Checks problem fidelity, completeness, boundaries, feasibility, overengineering, risk, and verification. Review only; do not implement the solution.
---

# Solution Review

Review the proposed solution, not the implementation.

This Skill is **optional**. Run it only when the user explicitly requests an independent review, or when project policy explicitly requires one. Its existence does not make solution review a mandatory lifecycle gate.

Read:

- `./references/_shared/engineering-principles.md`
- `./references/_shared/module-first-architecture.md`
- `./references/_shared/layered-architecture.md`
- `./references/_shared/ports-and-adapters.md`
- `./references/_shared/strategy-and-plugin.md`
- `./references/_shared/verification.md`
- `./references/_shared/artifact-protocol.md`

For refactor plans also read `./references/_shared/refactoring.md` and `./references/_shared/clean-code.md`.

Load the target project's requirements, contracts, architecture decisions, and relevant code evidence. Do not judge from generic best practices alone.

## Review Lenses

1. **Problem / requirement fidelity** — does the artifact solve the stated problem without silently changing goals?
2. **Scope & ownership** — responsibilities, non-goals, module/package boundaries, source of truth.
3. **Correctness & completeness** — states, errors, edge cases, persistence/data lifecycle, concurrency/ordering, compatibility/migration when relevant.
4. **Architecture** — dependency direction, abstraction ownership, external boundaries, composition.
5. **Pattern fit** — Strategy/Plugin/Adapter used only where real variation/extensibility/integration justifies them.
6. **Feasibility & sequencing** — implementation order, rollout/rollback, operational constraints.
7. **Verification** — acceptance criteria and regression evidence can actually prove the important behavior.
8. **Documentation impact** — required contracts, ADRs, READMEs, agent rules, migration notes.
9. **Overengineering / underdesign** — challenge unnecessary abstraction and missing boundaries equally.

## Refactor-plan Additions

Check behavior preservation, characterization coverage, scope granularity, transformation sequence, rollback/stop conditions, and whether the target fixes root causes rather than only line counts.

Do not require one finding per work item or one execution unit per finding. A scope-level plan with multiple related Work Items is preferred when responsibilities and risks are shared.

## Findings

Every finding must contain severity/priority, evidence, impact, and actionable recommendation. Distinguish blockers from optional improvements. `0 findings` is valid.

Recommended verdicts:

- **PASS** — implementable as written; no material blockers.
- **WATCH** — implementable but notable non-blocking risks/tradeoffs remain.
- **REQUEST_CHANGES** — material correctness/scope/architecture/verification gap should be fixed first.

Persist the review using project conventions or the fallback artifact protocol when the user/project wants review history. Do not modify the reviewed artifact unless the user explicitly asks for followup behavior.

Do not automatically trigger followup or a second review. The user decides what to do with the report.
