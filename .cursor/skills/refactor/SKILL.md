---
name: refactor
description: Execute an explicitly approved refactor plan or scope using small behavior-preserving transformations with continuous verification and a final scope-level convergence check. By default complete the approved scope in one pass; do not invent a new architecture while implementing.
---

# Refactor

Implement an approved refactor safely and efficiently.

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

Load the approved Refactor Plan or equivalently precise user-authorized scope and target-project rules first.

## Preconditions

- Scope and intended target are explicit.
- Observable contracts and verification strategy are known.
- The user has authorized implementation of this scope.

If these are missing, do not substitute your own broad redesign.

## Default Execution Model

Default to executing the **whole approved scope** in one coherent implementation pass.

A plan may contain multiple Work Items. Treat them as an ordered checklist inside the same task, not as separate lifecycle gates.

Only stop between Work Items when:

- the user explicitly requested staged execution;
- a stop condition is triggered;
- a work item reveals a new independent contract/migration/risk boundary;
- safe progress requires changing the approved plan or observable behavior.

Do not pause merely because one internal Work Item finished.

## Workflow

1. **Baseline** — run relevant pre-change checks or establish existing failures.
2. **Protect behavior** — add focused characterization/regression coverage first when risk is high and protection is missing.
3. **Execute Work Items in order** — rename/extract/move/simplify before introducing new abstractions; use Strategy/Plugin/Port only when the approved design and real variation justify them.
4. **Verify during execution** — run focused tests/typecheck/lint at meaningful risk boundaries, not mechanically after every trivial edit.
5. **Do not hide failures** — do not weaken tests, widen catch blocks, suppress types/lint, or change error semantics merely to make checks pass.
6. **Synchronize code-level knowledge when directly affected** — update structured comments that are made stale by changed responsibility, capability, boundary, invariant, lifecycle, or tradeoff. Do not run a repository-wide comment campaign unless explicitly requested; `$code-comments` exists for dedicated comment work.
7. **Synchronize engineering docs when directly affected** — update README/AGENTS/ADR/index documents required to keep changed structure/contracts/navigation accurate. Do not run a broad documentation rewrite unless explicitly requested; `$engineering-documentation` exists for dedicated documentation work.
8. **Scope-level regression** — after the approved scope is complete, run the package/app/integration/E2E gates required by the plan and blast radius.
9. **Hotspot convergence check** — revisit the audit/plan Hotspot Watchlist and any new hotspots created by the refactor. Do not declare a structural refactor complete merely because tests pass while obvious mixed-responsibility hotspots remain.
10. **Convergence check** — confirm the target state is reached, preserved contracts remain intact, unrelated behavior did not drift, hotspot dispositions are resolved, and directly affected code comments/engineering docs are synchronized or explicitly deferred.

## Hotspot Convergence Check

Large or long files are **review triggers, not automatic defects**. LOC must never be the sole reason to split a file, but major hotspots must be consciously re-evaluated before completion.

For every major pre-existing hotspot and any significant new hotspot, ask:

- Does it still have multiple independent reasons to change?
- Does it mix orchestration, domain/policy decisions, validation, IO/infrastructure, persistence, or presentation?
- Are abstraction levels mixed enough that the primary control flow is difficult to follow?
- Is there a natural responsibility/module boundary suitable for Extract Function, Move Function, or Extract Module?
- Did the refactor merely move complexity into another giant coordinator/helper/manager?
- Would further splitting harm a cohesive state machine, algorithm, transaction, lifecycle, ordering constraint, or other invariant?

Allowed outcomes:

- **RESOLVED** — responsibilities were separated and the resulting modules are more cohesive/navigation-friendly;
- **COHESIVE / PRESERVED** — hotspot remains intentionally because one invariant/control flow should stay together; record the rationale;
- **DEFERRED / BLOCKED** — safe structural improvement needs missing contract/behavior evidence or would exceed the approved scope; record the reason and remaining risk.

A hotspot may remain large. What is not acceptable is leaving it unexamined or claiming structural completion solely from green verification.

Do not chase arbitrary file-size targets. Avoid replacing one large file with many pass-through wrappers, `Manager`/`Helper`/`Processor` shells, or abstractions that only relocate complexity.

## Boundaries

- No opportunistic feature work.
- No speculative architecture expansion outside the approved scope.
- No arbitrary line-count-driven fragmentation.
- Do not turn every finding into a separate execution unit.
- If safe progress requires behavior/schema/protocol changes not in the plan, stop and report the conflict.

## Completion Output

Report:

- completed Work Items;
- actual structural changes;
- preserved contracts;
- verification evidence;
- hotspot convergence outcomes and rationale for any intentionally retained hotspots;
- code-comment/documentation synchronization performed or deferred;
- any divergence from plan;
- intentionally deferred issues.

A failed required check means the scope is not complete.

Do not automatically invoke or require `code-review`. The user decides whether independent review is needed and how often.
