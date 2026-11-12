# Backend API starter

The backend starter each app's backend is created from (Next.js 16, TypeScript, Prisma 7, PostgreSQL).
Every app built from `whitelabel-app-kit` gets its own backend: a repo cloned from this one that keeps
a `starter` remote and merges starter tags ([docs/creating-a-backend.md](./docs/creating-a-backend.md)).

Its API is the contract the shared Android features (auth, home, catalog, profile, settings) call
directly. The contract is the committed [`openapi/openapi.json`](./openapi/openapi.json), and `/api/v1`
only ever grows: see [docs/contract.md](./docs/contract.md).

The same Docker image runs in two modes, selected by `DEPLOYMENT_MODE`:

- **Dedicated** (the normal production shape): one deployment, with its own database, secret and domain,
  serves a single tenant fixed by `DEDICATED_TENANT_SLUG`.
- **Shared**: one deployment and one database serve many tenants; each request names its tenant with
  the `X-Client-Id` header. Used for local development and for hosting several small apps cheaply.

## Quickstart

Requires Node 24 (see `.nvmrc`) and Docker.

```bash
npm ci
docker compose up -d postgres
cp .env.example .env          # the example secret is for local use only
npm run db:deploy
npm run db:seed
npm run dev                   # serves http://localhost:3000; use `npm run dev -- -p 3100` if 3000 is taken
```

In another terminal:

```bash
curl -H 'X-Client-Id: acme' localhost:3000/api/v1/app/config
curl -X POST -H 'X-Client-Id: acme' -H 'content-type: application/json' \
  -d '{"email":"alice@shared.test","password":"Password123!"}' localhost:3000/api/v1/auth/login
```

Seeded tenants are `acme` and `globex`; each has users `alice@shared.test` and `bob@shared.test`
(password `Password123!`) and 25 catalog items. Details: [docs/local-development.md](./docs/local-development.md).

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/creating-a-backend.md](./docs/creating-a-backend.md) | Creating an app's backend from this starter, lining it up with the Android app, pulling starter updates |
| [docs/contract.md](./docs/contract.md) | What the API contract is, what may change in v1, tags, the `x/` app namespace, flag keys, CI guards |
| [docs/architecture.md](./docs/architecture.md) | Overview, folder structure, module boundaries, data model, tenant resolution, authentication, security notes, RLS plan |
| [docs/api.md](./docs/api.md) | Envelope, endpoints, `X-Client-Id` rules, token lifecycle, Android guidance, error codes, consuming the OpenAPI spec |
| [docs/environment.md](./docs/environment.md) | Every environment variable |
| [docs/local-development.md](./docs/local-development.md) | Local setup, tenant CLI, Docker, CI |
| [docs/adding-a-module.md](./docs/adding-a-module.md) | How to add a tenant-scoped module and its OpenAPI docs |
| [docs/testing.md](./docs/testing.md) | Test projects, conventions, security suites, CI |
| [docs/deployment-shared.md](./docs/deployment-shared.md) | Operating a shared deployment |
| [docs/deployment-dedicated.md](./docs/deployment-dedicated.md) | Provisioning and operating a dedicated deployment |

Contributing rules (commit and branch conventions, hooks) are in [CLAUDE.md](./CLAUDE.md).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | All Vitest projects |
| `npm run test:unit` | Unit tests (no database) |
| `npm run test:int:shared` | Integration tests, shared mode (needs Postgres) |
| `npm run test:int:dedicated` | Integration tests, dedicated mode (needs Postgres) |
| `npm run db:migrate` | `prisma migrate dev`: author a new migration |
| `npm run db:deploy` | `prisma migrate deploy`: apply committed migrations |
| `npm run db:seed` | Seed local data (refused in production) |
| `npm run db:prune` | Delete dead refresh tokens, sessions and reset tokens (production job; see deployment guides) |
| `npm run db:reset:test` | Drop and re-migrate both test databases (human only) |
| `npm run openapi:generate` | Regenerate `openapi/openapi.json` from the Zod schemas |
| `npm run openapi:lint` | Lint the spec with Redocly |
| `npm run tenant -- <cmd>` | Operator CLI: `create`, `list`, `set-status`, `set-config`, `set-feature` |
