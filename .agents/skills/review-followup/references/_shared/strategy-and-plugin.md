# Strategy and Plugin

Strategy, Plugin, and Adapter solve different problems.

## Strategy

Use Strategy when one responsibility has multiple real algorithms/policies selected by context or configuration.

```text
Same responsibility
├── Strategy A
├── Strategy B
└── Strategy C
```

Examples: search mode, ranking algorithm, document understanding mode, segmentation policy.

Do not introduce `FooStrategy` with only `DefaultFooStrategy` unless a second variation is concrete and near-term or the boundary materially improves testing.

## Plugin

Use Plugin when the system supports independently addable/removable/composable capabilities.

```text
Stable Core
   ↓ extension point
Plugin Registry / Pipeline
├── Plugin A
├── Plugin B
└── Plugin C
```

A plugin should have explicit lifecycle, compatibility/ordering semantics, failure isolation expectations, and a clear contract.

Do not plugin-ize stable core business rules merely for extensibility aesthetics.

## Adapter

Adapter translates an external implementation into an internal port. It is not synonymous with Strategy or Plugin.

## Decision Test

- “How should this one responsibility be performed?” → Strategy.
- “What optional extension capability is installed/enabled?” → Plugin.
- “How does this external technology satisfy our internal contract?” → Adapter.
