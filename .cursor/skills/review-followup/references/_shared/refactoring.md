# Refactoring

Refactoring changes internal structure without intentionally changing observable behavior.

## Operating Loop

```text
Understand → Protect behavior → Small transformation → Focused verification → Inspect diff → Repeat
```

## Smell to Transformation

A smell is evidence to investigate, not an automatic verdict. For each candidate establish:

```text
Smell → concrete evidence → maintenance cost → root cause → named transformation → risk → verification
```

Common mappings include:

- Long Function → Extract Function, Replace Temp with Query, Split Phase.
- Large Class / Divergent Change → Extract Class/Module, Move Function, separate responsibilities.
- Shotgun Surgery → Move behavior/knowledge toward a cohesive owner.
- Feature Envy → Move Function or expose a better domain operation.
- Duplicate Knowledge → centralize the rule or contract; do not deduplicate coincidentally similar code blindly.
- Primitive/flag-driven behavior → introduce value object or polymorphism only when it clarifies real variation.
- Complex Conditional → Decompose Conditional, guard clauses, or Strategy/polymorphism when variation is stable and meaningful.

## Safety

- Use existing tests first; add characterization/regression tests when risky behavior lacks protection.
- Preserve public API, persisted data semantics, error contracts, ordering, side effects, concurrency guarantees, and user-visible behavior unless the plan explicitly changes them.
- Do not mix unrelated feature work into a refactor.
- Stop when the targeted cause is materially reduced; do not continue extracting abstractions without current value.
- A rewrite is not automatically a refactor. Large replacements require explicit authorization and a migration/verification plan.
