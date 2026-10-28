# Git Commit Protocol

These are defaults for the `git-commit` Skill when the target project has no more specific convention. Follow explicit user instructions and project rules first.

## Message Format

```text
<type>(optional-scope): <Chinese subject>

<optional concise body explaining constraints and rationale>

<optional Lore decision trailers>
```

Default types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.

Use a concise imperative subject with no trailing period. Convey intent where useful without making the actual change unclear. Respect the project's allowed types, scopes, subject limits, breaking-change notation, and required trailers. In the absence of a line-length rule, keep body lines within 100 characters.

A subject alone is sufficient when there is no material decision context. A detailed message is useful when future modifiers need constraints, alternatives, risk, directives, or verification evidence. Do not repeat a diff summary merely to fill a template.

## Lore Decision Trailers

Lore records useful decisions through git-native trailers. Load the target project's own protocol when one exists; otherwise choose only the applicable fields below:

```text
Constraint: <external constraint that shaped the decision>
Rejected: <alternative considered> | <reason for rejection>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <forward-looking warning for future modifiers>
Tested: <what was actually verified>
Not-tested: <known verification gaps>
```

Do not mechanically include every trailer. Record only supported facts: rejected alternatives must have been considered, and verification claims must match actual checks. Domain-specific trailers are appropriate when the project defines them.

Separate the subject, optional body, and trailer block with blank lines. Validate the entire message, including trailers, against the project's rules.

## Commit Boundaries

- Commit only when requested; support message-only requests without staging or committing.
- Preserve unrelated work and explicit staging choices. Do not include credentials or likely secrets.
- Run required hooks and checks; do not bypass them to obtain a commit.
- Do not add AI/tool attribution. Inspect the resulting message for injected footers.
- Rewrite only the new unpushed task commit to restore its validated message, preserving content, parents, identity, index, and working tree. Older or published history requires explicit authorization.
- Push, force-push, and changes to attribution settings require their own user authorization; a local commit request alone does not authorize them.
