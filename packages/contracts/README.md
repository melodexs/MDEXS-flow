# @mdexs-flow/contracts

Shared API contract types and runtime guards consumed by `apps/mobile`
(and later `apps/admin`).

## Contents (Phase 2)

- `src/health.ts` — typed `HealthResponse` contract (`service`, `status`, `environment`, `version`, `database`) + runtime type guard,
  mirroring the FastAPI health schema and its test suite.

## Keeping contracts consistent with the API

The FastAPI service is the **source of truth**. It publishes its schema at
`/openapi.json`. The workflow:

1. Change the Python schema (`services/api/app/modules/*/schemas.py`).
2. Regenerate TypeScript types from OpenAPI (planned: `openapi-typescript`,
   wired into `scripts/` in the next phase) or update `src/` by hand for the
   small set of contracts that exist so far.
3. `services/api/tests/test_health.py` asserts the live response shape;
   `packages/contracts/tests/` asserts the TypeScript side. If either fails
   after a schema change, both sides need updating together.

We deliberately do **not** duplicate the whole Python data model in
TypeScript at this stage; contracts are added per feature, as endpoints land.

## Consuming from apps/mobile

The mobile app depends on this package via the pnpm workspace:

```json
"@mdexs-flow/contracts": "workspace:*"
```

Expo's Metro bundler consumes the raw TypeScript source (`main: ./src/index.ts`),
so no build step is required in the app bundle. `pnpm test` here compiles with
`tsc` first to verify the package is valid TypeScript.

## Commands

- `pnpm typecheck` — strict `tsc --noEmit`
- `pnpm lint` — ESLint (typescript-eslint, strict)
- `pnpm test` — compile + run node test runner
