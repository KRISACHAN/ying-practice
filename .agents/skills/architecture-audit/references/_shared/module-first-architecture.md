# Module-first Architecture

Prefer organizing code around stable business/capability ownership before global technical layers.

## Target Shape

```text
app-or-package/
├── composition/
├── modules/
│   ├── capability-a/
│   ├── capability-b/
│   └── capability-c/
└── platform/
```

A module should make these questions easy to answer:

- What does it own?
- What does it explicitly not own?
- What is its public contract?
- What state/persistence/side effects does it control?
- Which modules may call it?
- What tests protect it?

## Internal Layers Are Optional, Not Mandatory Folders

A complex module may separate domain, application/use-cases, ports, adapters/infrastructure, and interface concerns. A simple module should stay simple.

Avoid global `services/`, `repositories/`, `utils/`, or `controllers/` directories becoming dumping grounds. Technical folders are acceptable when they represent a true cross-cutting platform boundary rather than business ownership.

## Cross-module Rules

- Cross modules through deliberate public contracts, not deep imports into internals.
- Keep shared code genuinely shared; do not create a `common` module for unrelated leftovers.
- A package boundary should represent a reusable capability or deployment/runtime boundary, not an arbitrary code-size split.
