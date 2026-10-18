# Integrations

Adapters for external services live here (object storage, TTS providers,
push notification services). Each integration:

- implements a small internal interface defined next to its module,
- reads its credentials only from backend environment variables,
- never exposes credentials or signed URLs in logs or API responses.

Nothing is implemented yet (Phase 2): the planned first adapter is the
provider-neutral object-storage client (see docs/adr/ADR-002).
