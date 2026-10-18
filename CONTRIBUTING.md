# Contributing to MDEXS Flow

## Workflow

1. Branch from `main`: `feat/<issue>-<slug>` or `fix/<slug>`.
2. Small, focused commits; keep commits honest (no generated output,
   no secrets).
3. Run the checks before pushing:

   ```bash
   pnpm check           # lint + typecheck + tests (all workspaces + API)
   pnpm api:lint && pnpm api:test   # Python-only fast path
   ```

4. Open a PR; CI must pass. No merge without review for product code.

## Conventions

- **Python (services/api):** ruff for lint + format (line length 100),
  pytest tests colocated in `tests/`. Modules follow
  router / schema / service separation; DB access only through
  `app/database/session.py`. Pydantic schemas validate all input.
- **TypeScript:** strict mode everywhere; no `any` in contracts; mobile
  code imports via `@/` path alias. Types shared with the API belong in
  `packages/contracts`, never duplicated ad hoc.
- **Docs:** update `docs/` in the same PR when behavior or decisions change;
  new decisions get an ADR in `docs/adr/`.

## Testing

- API: every endpoint change adds/updates a pytest; tests must pass without
  any credentials (no DATABASE_URL) — mock or fake the pieces you need.
- Contracts: add a guard test alongside any new shared type.
- Mobile: unit tests arrive with the first logic worth testing (Phase 4+);
  typecheck must stay clean in the meantime.

## Do not commit

`.env`, venvs, `node_modules`, build output (`dist/`, `.expo/`), local
databases, secrets, or any copyrighted media/metadata.
