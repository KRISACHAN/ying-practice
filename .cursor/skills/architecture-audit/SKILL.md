---
name: architecture-audit
description: Read-only codebase reconnaissance and architecture diagnosis for a repository, package, app, or module. Produces a functional/architecture map plus evidence-backed hotspots, code smells, dependency, code-comment, and documentation problems. Use before major refactors or when understanding a brownfield scope. Do not refactor code.
---

# Architecture Audit

Understand the current system before judging or changing it.

Read:

- `./references/_shared/engineering-principles.md`
- `./references/_shared/clean-code.md`
- `./references/_shared/refactoring.md`
- `./references/_shared/module-first-architecture.md`
- `./references/_shared/layered-architecture.md`
- `./references/_shared/ports-and-adapters.md`
- `./references/_shared/strategy-and-plugin.md`
- `./references/_shared/code-comments.md`
- `./references/_shared/engineering-documentation.md`
- `./references/_shared/artifact-protocol.md`

Then load the target project's own rules and nearest README/architecture docs.

## Mode

Code is read-only. Writing an audit artifact is allowed; changing production/test behavior is not.

## Workflow

1. **Define scope** — repository / package / app / module; record baseline ref/working-tree state.
2. **Functional map** — purpose, responsibilities, non-responsibilities, entry points, public contracts, callers/consumers.
3. **Architecture map** — modules/layers, dependency direction, data flow, state/persistence, network/filesystem/process boundaries, composition roots, extension points.
4. **Verification map** — tests and checks that protect the scope, plus important unprotected behavior.
5. **Knowledge/navigation map** — assess whether structured code comments expose important local purpose/capability/boundary/invariant context, and whether README/AGENTS/ADR/spec/index documents provide accurate progressive navigation without drift.
6. **Hotspot analysis** — identify structurally significant large files/functions, change concentration, fan-in/fan-out, broad interfaces, mixed responsibilities, duplicated knowledge, difficult-to-test seams. Maintain a **Hotspot Watchlist** for hotspots that the later plan/execution must explicitly resolve or intentionally preserve.
7. **Pattern analysis** — identify useful or misused layering, Port/Adapter, Strategy, Plugin, and unnecessary abstractions.
8. **Diagnose root causes** — for each meaningful issue record evidence → cost → likely root cause → safe direction → risk.
9. **Assess scope fit** — prefer keeping the current package/app/module as one refactor scope. Recommend sub-scopes only when responsibility, contract, rollback/migration risk, verification strategy, or context size forms a real independent boundary.

## Hotspot Watchlist

LOC is a discovery signal, not a verdict. Do not mark a file defective merely because it is long, but do not let a major hotspot disappear from the audit merely because tests pass.

For each structurally significant hotspot, explicitly judge:

- how many independent reasons to change it has;
- whether it mixes orchestration, policy/domain rules, validation, IO/infrastructure, persistence, or presentation;
- whether abstraction levels are mixed enough to obscure the main flow;
- whether cohesion, testability, navigability, fan-in/fan-out, or change blast radius are poor;
- whether there are natural ownership boundaries suitable for Extract Function / Move Function / Extract Module;
- whether keeping it intact is justified because it represents one cohesive state machine, algorithm, transaction, lifecycle, or other invariant that would become harder to understand if fragmented.

Classify each watchlist item with one of these dispositions:

- **STRUCTURAL ACTION LIKELY** — responsibilities or reasons to change are mixed enough that planning should address it;
- **COHESIVE / PRESERVE** — long or complex, but splitting would reduce clarity or break a meaningful invariant; record the reason;
- **NEEDS PLAN DECISION** — evidence is insufficient for the audit to choose safely.

## Required Output Sections

- Scope & baseline
- Functional Map
- Architecture / Dependency Map
- Data & Side-effect Flow
- Public Contracts / Invariants
- Verification Map
- Code Comment / Engineering Documentation Map
- Hotspots / Hotspot Watchlist
- Evidence-backed Findings
- Scope Fit: keep as one scope or split, with reasons
- Recommended Direction (not implementation plan)
- Open Questions / Verification Gaps

Findings must include concrete paths/symbols/lines when available. File size alone is not a defect; judge cohesion, reasons to change, blast radius, testability, and navigability.

Do not turn each finding into a future Refactor Unit. The audit diagnoses problems; the planning skill decides how related findings should be grouped into a concise scope-level plan.

Persist the result using project conventions or the fallback artifact protocol. Stop after the audit; do not start refactoring.
