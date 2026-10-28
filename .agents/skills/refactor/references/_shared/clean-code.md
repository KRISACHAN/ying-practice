# Clean Code

Use Clean Code ideas as maintainability heuristics, not numeric dogma.

## Prefer

- Names that express intent and domain meaning.
- Functions and modules with one clear purpose and a consistent abstraction level.
- High cohesion and explicit dependencies.
- Small, understandable control flow; use guard clauses when they clarify the happy path.
- Explicit side effects, state transitions, and error semantics.
- Domain operations over scattered procedural knowledge.
- Removing duplicated knowledge, not merely duplicated syntax.
- APIs whose valid use is easy and invalid use is difficult.
- Tests that describe behavior and contracts rather than implementation trivia.

## Watch For

- Boolean/flag parameters that select unrelated modes.
- Deep nesting and broad try/catch blocks hiding ownership.
- Generic `utils`, `helpers`, `manager`, or `service` modules accumulating unrelated responsibilities.
- Functions that require comments to explain what every line does.
- Premature generic abstractions with only one real consumer or implementation.
- Excessive pass-through layers that add indirection without policy or boundary value.

## Do Not Enforce Blind Line Limits

File/function size is a signal. Evaluate reasons to change, cohesion, testability, dependency surface, and navigability. Splitting one monolith into many tightly coupled fragments is not an improvement.
