# Testing

Tests use Vitest 5 (`vitest.config.ts`) with three projects. `npm test` runs all of them.

| Project | Command | Files | Needs Postgres | Mode |
| --- | --- | --- | --- | --- |
| `unit` | `npm run test:unit` | `tests/unit/**/*.test.ts` | no | n/a |
| `integration-shared` | `npm run test:int:shared` | `tests/integration/**/*.test.ts` except `*.dedicated.test.ts` | yes, `whitelabel_test_shared` | `DEPLOYMENT_MODE=shared` |
| `integration-dedicated` | `npm run test:int:dedicated` | `tests/integration/**/*.dedicated.test.ts` | yes, `whitelabel_test_dedicated` | `DEPLOYMENT_MODE=dedicated`, `DEDICATED_TENANT_SLUG=acme` |

Run one file with `npx vitest run --project integration-shared tests/integration/catalog/catalog.test.ts`.

## Naming convention

- `*.test.ts` under `tests/unit` is a unit test. Under `tests/integration` it runs in **shared** mode.
- `*.dedicated.test.ts` under `tests/integration` runs in **dedicated** mode only. Name a mode-specific
  suite `<topic>.dedicated.test.ts` next to its shared counterpart (for example `catalog.test.ts` and
  `catalog.dedicated.test.ts`).
- Helpers live in `tests/helpers` (`db.ts`, `http.ts`, `actors.ts`, `fakes/`), setup in `tests/setup`.

## Integration databases

Start Postgres with `docker compose up -d postgres`; its init script creates `whitelabel_test_shared` and
`whitelabel_test_dedicated` (see [local-development.md](./local-development.md)). Each integration project
has its own database, set in `vitest.config.ts` (the `.env` file is not used).

- **Migration:** the project's `globalSetup` (`tests/setup/migrate.ts`) runs `prisma migrate deploy` against
  that project's database before its tests start, so the schema is always current.
- **Reset:** a `beforeEach` in `tests/setup/integration.ts` truncates every public table except
  `_prisma_migrations` (`resetDb()` in `tests/helpers/db.ts`), so each test starts empty and seeds what it
  needs. `resetDb` refuses to run unless the database name contains `test`.
- Files run serially (`fileParallelism: false`); they share one database.
- Tests call the real route handlers (`GET`/`POST` exports of `src/app/api/v1/**/route.ts`) with
  `Request` objects, so the full `route()` pipeline runs without an HTTP server.
- **Timeouts:** `testTimeout` and `hookTimeout` are 20 s in the integration projects (Argon2 hashing and
  database work); the unit project uses the Vitest default.
- **`npm run db:reset:test`** drops and re-migrates both test databases. Prisma 7 blocks
  `prisma migrate reset` when it detects an AI agent, so a human must run it in their own terminal. It is
  rarely needed (only after rewriting migrations).

## Security suites

These guard the properties the product depends on; keep them green and extend them when adding endpoints.

| File (under `tests/integration/security`) | Guards |
| --- | --- |
| `isolation.test.ts` | Tenant isolation matrix: two tenants with colliding emails and data, and every endpoint (including by-id lookups and session revocation) stays inside the caller's tenant; a completeness test fails if a tenant-required route has no row |
| `leakage.test.ts` | Success and error responses of every endpoint expose no `passwordHash`, `tenantId`, token hashes, IPs or lockout fields; errors are never publicly cacheable; a forced 500 and a degraded health check do not echo internals |
| `auth-guard.test.ts` | Protected routes reject missing or garbage credentials, revoked or expired sessions, disabled users, an `X-Client-Id` for another tenant, a foreign `sid` and an unknown tenant; `lastUsedAt` throttling; rate limits skip IP rules without a trusted proxy and return 429 with `Retry-After` with one |
| `tokens.test.ts` | Access-token expiry (`TOKEN_EXPIRED`), random refresh tokens, wrong-secret and `alg: none` tokens |
| `suspension.test.ts` | A suspended tenant gets 403 `TENANT_SUSPENDED` at every entry point without affecting others, and recovers when reactivated |
| `security.dedicated.test.ts` | Dedicated mode rejects other tenants' tokens (401) and a mismatched `X-Client-Id` (400) |

Refresh rotation, the 10 s reuse grace (lost-response retries, superseded tokens, a randomised invariant test) and theft detection are covered by `tests/unit/modules/auth/refresh.test.ts` and `tests/integration/auth/sessions.test.ts`; the login/password-reset race by `tests/unit/modules/auth/login.test.ts` and `tests/integration/auth/password-reset.test.ts`. Related suites: `tenant/resolution*.test.ts` (the resolver table in [architecture.md](./architecture.md)),
`database/schema.test.ts` (composite foreign keys and tenant-scoped uniqueness), `database/prune.test.ts` (`npm run db:prune` keeps live rows, removes dead ones), and the OpenAPI contract
tests below.

## Contract tests

`tests/unit/openapi/contract.test.ts` checks every route is documented in the registry with the right auth,
tenant and rate-limit metadata; `dto-contract.test.ts` validates real DTOs against their response schemas;
`tests/integration/openapi/openapi.test.ts` checks `/openapi.json` serves the committed file.
`tests/unit/githooks.test.ts` tests the commit-msg, pre-commit and pre-push hooks.

## What CI runs

`.github/workflows/ci.yml` (job `ci`, every pull request and push to `main`, `postgres:17` service):
`npm ci`, lint, typecheck, `prisma validate`, create and migrate the test databases, `prisma migrate diff`
drift check (needs `SHADOW_DATABASE_URL`), `test:unit`, `test:int:shared`, `test:int:dedicated`,
`openapi:generate` followed by `git diff --exit-code openapi/`, `openapi:lint`, `build`, and (on pull
requests) the commit message check. Locally, the pre-push hook runs lint, typecheck and `test:unit`; run
the integration suites yourself before opening a PR.
