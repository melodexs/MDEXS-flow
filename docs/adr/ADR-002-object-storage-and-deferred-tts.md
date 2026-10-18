# ADR-002: Provider-neutral object storage and deferred media/TTS strategy

Status: accepted (provisional) — 2026-10-18

## Context

Media files (music, PDFs, audiobooks, artwork, voice packs) live in object
storage, not the database. The provider (S3 / Cloudflare R2 / Backblaze B2)
is not yet chosen. Offline TTS voice packs and OCR are also unchosen and are
two of the largest technical risks in the product.

## Decisions

- The backend defines a **storage interface** (issue signed read URLs,
  issue scoped write URLs, stream upload) with provider-specific adapters
  implemented later. No provider name, SDK, endpoint format, or credential
  appears in application code or config before the choice.
- `.env.example` uses provider-neutral names (`OBJECT_STORAGE_ENDPOINT`,
  `OBJECT_STORAGE_BUCKET`, key id/secret) that all three candidate providers
  support via S3-compatible APIs.
- **Offline TTS and OCR are deferred** (Phase 12): their strategy depends on
  an unresolved product decision (system voices vs bundled engine packs,
  scanned-PDF support). Phase 2 only reserves the design space.

## Consequences

- Phase 8 (downloads) codes against the interface; the provider adapter is a
  small, isolated addition.
- Switching providers later is a configuration + adapter change, not a
  redesign.
- TTS feasibility spikes must happen before Phase 12 is estimated.
