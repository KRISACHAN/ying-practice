---
name: code-review
description: Optional independent review of implemented code for correctness, solution/spec compliance, Clean Code and refactoring quality, architecture boundaries, Strategy/Plugin/Adapter fit, security/performance risks, verification gaps, structured code-comment quality, and engineering-documentation drift. Review only; do not fix findings.
---

# Code Review

Review what was actually implemented.

This Skill is **optional**. Run it only when the user explicitly requests review, or when project policy explicitly requires one. The Skill does not decide when or how often review must happen.

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
- `./references/_shared/verification.md`
- `./references/_shared/artifact-protocol.md`

Load project-specific standards, nearest module/package docs, related solution/spec/plan, and relevant diff/commit/PR/path evidence.

## Review Lenses

1. **Correctness & data safety** — behavior, states, errors, transactions, persistence, ordering, concurrency, compatibility.
2. **Solution/spec compliance** — implementation matches approved requirements/plan and does not add hidden scope.
3. **Architecture** — module ownership, dependency direction, public boundaries, composition, infrastructure leakage, architecture drift.
4. **Clean Code / Refactoring** — naming, cohesion, abstraction levels, duplication of knowledge, long/complex flows, broad responsibilities, testability.
5. **Pattern fit** — Strategy/Plugin/Port/Adapter are justified; flag speculative or missing abstractions with evidence.
6. **Security & performance** — only evidence-backed risks relevant to the scope.
7. **Verification gap** — ask not only “is the code wrong?” but also “if this important behavior broke, would a current test/gate fail?”
8. **Structured code comments** — important modules/APIs/functions preserve enough Purpose / Capability / Responsibility / Boundary / Contract / Lifecycle / Tradeoff context for humans and AI without narrating syntax or inventing unsupported semantics.
9. **Engineering documentation** — README/AGENTS/ADR/index/module docs match the implemented structure, contracts, data flow, and verification reality.

## Scope

Honor explicit user scope first. If no scope is supplied, use the project's normal review convention; if none exists, prefer staged diff, then unstaged diff, and stop if there is nothing concrete to review.

Prefer reviewing a meaningful completed scope (package/app/module/change) rather than forcing a review after every small internal work item.

## Findings

- Findings require evidence and impact; cite path/line/symbol when possible.
- Separate blockers from improvements.
- Do not manufacture findings to reach a quota. `0 findings` is valid.
- Do not fix code in this skill.
- Do not demand comments merely because a function/file exists; comment findings must identify missing semantic context that materially harms understanding or safety.
- Do not demand new docs when an existing source of truth already covers the needed information accurately.

Recommended verdicts: **PASS / WATCH / REQUEST_CHANGES**.

Persist the report when the user/project wants review history; include standards consulted, verification evidence observed, and gaps not independently verified.

Do not automatically trigger followup or re-review. The user decides whether findings need action and whether another review is worth the cost.
