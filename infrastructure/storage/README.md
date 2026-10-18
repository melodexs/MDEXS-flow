# Object storage (provider-neutral)

The provider (AWS S3 / Cloudflare R2 / Backblaze B2) is **not yet chosen**
(see docs/adr/ADR-002-...). Until then:

- Application code must talk to a storage **interface**, not an SDK.
- Env names are provider-neutral: `OBJECT_STORAGE_ENDPOINT`,
  `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`,
  `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `MEDIA_CDN_BASE_URL`.
- All three candidates expose S3-compatible APIs, so an S3-compatible
  adapter covers all of them; credentials remain backend-only either way.
- Bucket policy requirements (planned):
  - No public listing.
  - Reads only via API-issued, short-lived signed URLs.
  - Uploads only via scoped, short-lived write URLs for submissions.
