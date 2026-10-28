# Layered Architecture

Layering exists to control dependency direction and responsibility, not to maximize folders.

## Conceptual Layers

```text
Interface / Transport
        ↓
Application / Use Cases
        ↓
Domain / Core Policy
        ↑
       Ports
        ↑
Infrastructure / Adapters

Composition Root selects and wires implementations.
```

## Rules

- Domain/core policy should not know concrete databases, UI frameworks, HTTP clients, LLM SDKs, search engines, or filesystem implementations.
- Application coordinates use cases, transactions/workflows, authorization policy, and ports; avoid turning it into a giant procedural service layer.
- Infrastructure implements external concerns and persistence mechanics; it should not become the owner of domain decisions.
- Interface/transport validates and translates boundary input/output; it should not absorb business rules.
- Composition is where concrete implementations are selected and wired.

Layer violations require evidence. Do not move code merely because a folder name looks imperfect.
