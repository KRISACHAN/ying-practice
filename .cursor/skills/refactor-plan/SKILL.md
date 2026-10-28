---
name: refactor-plan
description: Turn an approved architecture audit or explicitly scoped technical-debt problem into a concise behavior-preserving scope-level refactor plan with target structure, work items, preserved contracts, risks, and regression strategy. Planning only; do not implement production-code changes.
---

# Refactor Plan

Convert diagnosis into one executable plan for the approved scope.

Read:

- `./references/_shared/engineering-principles.md`
- `./references/_shared/refactoring.md`
- `./references/_shared/clean-code.md`
- `./references/_shared/module-first-architecture.md`
- `./references/_shared/layered-architecture.md`
- `./references/_shared/ports-and-adapters.md`
- `./references/_shared/strategy-and-plugin.md`
- `./references/_shared/code-comments.md`
- `./references/_shared/engineering-documentation.md`
- `./references/_shared/verification.md`
- `./references/_shared/artifact-protocol.md`

Load the upstream audit when one exists. If the project has its own architecture/spec/requirements, they are authoritative.

## Default Granularity

Default to **one plan per meaningful scope**: package, app, module, or another explicitly approved boundary.

Do not create one Refactor Unit per finding. Multiple findings should normally become internal Work Items in the same scope-level plan.

Split the scope into separate execution plans only when there is a real independent boundary, such as:

- different business responsibility or ownership;
- different public contract or persisted schema;
- independent rollback/migration risk;
- materially different verification strategy;
- the scope is too large for reliable understanding or execution in one pass.

File count, LOC, or finding count alone is not a reason to split.

## Workflow

1. **Restate confirmed problems** — do not silently expand scope beyond the audit/user request.
2. **Freeze observable contracts** — public APIs/types, persisted schema/data semantics, errors, ordering, side effects, UI/API/IPC behavior, concurrency, compatibility.
3. **Describe target state** — responsibilities and dependency direction first; file/folder layout second.
4. **Resolve hotspot disposition** — carry forward every major item from the audit Hotspot Watchlist. Map each one to a Work Item, explicitly preserve it with a cohesion/invariant rationale, or mark it as needing a user/requirement decision. Do not let structural hotspots vanish from the plan simply because behavioral findings are more urgent.
5. **Define Work Items** — group related changes by responsibility/root cause; use named refactorings where useful.
6. **Order the work** — dependencies, safest sequence, characterization coverage, migration or rollback concerns.
7. **Define verification strategy** — baseline, focused checks during execution, scope-level regression at completion, and any characterization tests needed before structure changes.
8. **Define knowledge synchronization** — identify whether the refactor changes code-level semantic context that requires structured comment updates and/or repository-level knowledge that requires README/AGENTS/ADR/index updates. Keep these as distinct concerns.
9. **Define convergence criteria** — include a post-implementation hotspot re-check so tests passing alone cannot close a structural refactor while obvious mixed-responsibility hotspots remain.
10. **Define stop conditions** — unexplained test failure, required behavior change, migration ambiguity, or architecture uncertainty should stop implementation.
11. **Check for overengineering** — every introduced layer/interface/strategy/plugin/adapter must have a concrete responsibility or variation.

## Hotspot Planning Rule

A large or complex file is not automatically a Work Item. Size is a trigger to inspect reasons to change and cohesion.

For each major hotspot, the plan must choose one of these outcomes:

- **Refactor structurally** — when responsibilities, abstraction levels, ownership, or reasons to change are materially mixed;
- **Preserve intentionally** — when the file represents one cohesive state machine, algorithm, transaction, lifecycle, or invariant and splitting would make control flow harder to understand;
- **Defer explicitly** — when safe structural action depends on missing behavior/contract evidence.

If preserving a hotspot, record why. If refactoring it, plan around responsibility boundaries, not a target line count.

## Plan Template

```text
Scope
Confirmed Problems / Evidence
Preserved Contracts
Target State
Hotspot Disposition
Non-goals

Work Items
- WI-01 — ...
- WI-02 — ...
- WI-03 — ...

Execution Order
Verification Strategy
Convergence Criteria
Risks
Stop / Rollback Conditions
Code Comment Impact
Engineering Documentation Impact
Definition of Done
```

Work Item IDs are organizational aids, not mandatory lifecycle gates. They do not imply separate review, separate approval, separate artifact, or separate execution unless the user explicitly requests that granularity.

## Output

Persist one concise Refactor Plan using project conventions or the fallback artifact protocol.

Do not automatically invoke or require `solution-review`. The user decides whether an independent solution review is useful before implementation.
