---
name: review-followup
description: Optionally validate and resolve findings from a solution-review or code-review report. Classifies each selected finding as Valid, Partially Valid, Invalid, or Obsolete before changing anything; then applies minimal fixes and appropriate verification. Does not blindly obey review findings and does not require automatic re-review.
---

# Review Followup

Treat a review report as claims to verify, not absolute authority.

This Skill is **optional**. Run it only when the user chooses to act on review findings. The user may choose all findings, selected findings, or none.

Read:

- `./references/_shared/engineering-principles.md`
- `./references/_shared/verification.md`
- `./references/_shared/artifact-protocol.md`

Also load the reference files used by the originating review type and the current target-project standards.

## Workflow

1. **Load the report and current state** — identify review type, reviewed baseline, selected findings, and whether code/artifact has changed since.
2. **Verify each selected finding independently** against source artifacts, code, tests, contracts, and project rules.
3. **Classify** each selected finding:
   - `Valid` — evidence and impact are correct.
   - `Partially Valid` — core concern is real but scope/severity/remedy is overstated or incomplete.
   - `Invalid` — evidence/assumption is wrong or conflicts with authoritative project contract.
   - `Obsolete` — later changes already resolved or invalidated it.
4. **Resolve valid concerns minimally**:
   - solution finding → edit the solution/spec/plan, preserving unrelated content;
   - code finding → edit code/tests/docs as required, respecting the approved solution.
5. **Verify** relevant behavior. For code fixes, run focused checks and regression appropriate to blast radius. For solution fixes, re-check internal consistency and referenced contracts.
6. **Record outcome** when useful — evidence, actual fix or rejection rationale, verification results, and remaining concerns.

## Boundaries

- Do not implement unrelated improvements while resolving findings.
- Do not weaken tests/contracts to satisfy a reviewer.
- Do not mark a finding resolved without evidence.
- Do not assume every finding must be handled.
- Do not automatically invoke a fresh review after followup.

Whether to run `solution-review` / `code-review` again is entirely up to the user or an explicit project policy. Re-review is useful when the followup materially changes architecture, contracts, data semantics, or risk; it is unnecessary ceremony for many small corrections.

Output a followup artifact only when the project/user wants review history; otherwise provide a concise structured summary.
