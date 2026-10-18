# Security Policy

## Reporting

Report vulnerabilities privately to the repository owner (Okoh Destiny)
via a private channel. Do not open a public issue with exploit details.

## Handling secrets

- No credentials in Git — `.env.example` carries placeholders only.
- Database and storage credentials are backend-only environment variables
  (never in the mobile app bundle).
- See `docs/security.md` for the full security checklist and design.

## Scope (Phase 2)

No authentication exists yet — all API endpoints are public by design until
Phase 3. Do not expose this service publicly before then.
