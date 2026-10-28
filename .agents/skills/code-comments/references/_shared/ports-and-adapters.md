# Ports and Adapters

Use a port when core/application code needs a stable capability while concrete technology is volatile, external, or worth substituting in tests.

Typical adapter boundaries:

- Database / persistence
- LLM provider or model SDK
- Search engine
- Filesystem / object storage
- Document parser
- Message bus / external API
- Clock, UUID, or other side-effectful system services when testability benefits

## Good Port

A good port is owned by the policy that needs it and speaks domain/application language rather than vendor language.

## Good Adapter

An adapter translates between a concrete technology and the port. Provider-specific errors, payloads, retry mechanics, and SDK details should stay near the adapter unless they are product policy.

## Avoid

- One interface per class by default.
- Adapters that only rename methods without isolating volatility or improving testing.
- Leaking ORM/SDK/provider types through the core contract.
- Treating every internal module call as a Port/Adapter boundary.
