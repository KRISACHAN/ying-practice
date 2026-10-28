# Artifact Protocol

Persist important information when it needs to survive across sessions, tools, or stages. Do not turn every internal step into a file.

## Prefer Existing Project Conventions

If the target project already has Requirements, Specs, ADR, Reviews, or Engineering directories, follow them. Do not create a parallel source of truth.

If no convention exists, the default is:

```text
.engineering/
├── audits/
├── plans/
└── reviews/
```

## What Should Usually Persist

High-value durable artifacts include:

- architecture / codebase audit;
- approved scope-level refactor or technical plan;
- important architecture decisions / ADRs;
- implementation or verification summary when later stages need the evidence;
- review reports only when the user/project wants review history.

Do not create a separate artifact for every tiny refactoring step, work item, checkpoint, or verification command unless project policy explicitly requires that level of traceability.

## Required Metadata

Each persistent artifact should make these visible near the top when applicable:

- artifact type and status;
- target scope;
- baseline commit/ref or working-tree state;
- project standards/contracts consulted;
- related upstream artifact(s);
- decision/verdict;
- verification evidence or known gaps.

## Default Handoff

The default refactoring handoff is intentionally short:

```text
Audit → Plan → Implementation + Verification
```

A downstream skill should read the upstream artifact instead of reconstructing it from chat memory.

Review is an optional side path, not a mandatory handoff:

```text
Plan ───────────────→ Solution Review   # optional
Implementation ────→ Code Review       # optional
Review Report ─────→ Review Followup    # optional
```

The user decides whether any of these review artifacts exist and how many review rounds are worth keeping.

## Approval

Do not infer implementation authorization merely because a plan exists. The user/project decides when implementation may begin.

Do not infer that a review is required merely because the review skills exist.

## Append vs Overwrite

When the project keeps review/audit history, preserve prior reports and link followups to the original report. If the project treats an artifact as a mutable working document, follow that convention instead.
