# Verification

Verification should be risk-based, fresh, and tied to observable contracts.

## Loop

```text
Baseline → Change → Focused check → Inspect → Broader regression → Convergence check
```

## Evidence Ladder

Use the narrowest meaningful evidence first, then broaden as risk grows:

- format / static analysis / lint
- typecheck / compile
- focused unit tests
- module/package tests
- integration/contract tests
- migration/persistence tests
- API/IPC tests
- end-to-end / smoke / packaging / deployment gates

Do not run expensive checks reflexively when they cannot validate the changed behavior; do not skip broad checks when blast radius warrants them.

## Baseline

Before a risky refactor, establish whether relevant checks pass before edits. Do not attribute pre-existing failures to the change without evidence.

## Convergence

Passing tests is necessary but may not prove the approved plan was implemented. Before claiming completion verify:

- approved scope/units are satisfied;
- preserved behavior/contracts remain intact;
- intended architecture target is materially reached;
- no accidental unrelated behavior change is present;
- required docs/contracts are synchronized;
- relevant checks are fresh and passing.

If a required check cannot run, state the gap and do not claim that behavior is verified.
