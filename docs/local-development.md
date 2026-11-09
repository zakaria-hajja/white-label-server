# Local development

## Prerequisites

- Node 24 (see `.nvmrc`; `package.json` enforces `>=24 <25`).
- A Docker runtime, for example OrbStack or Docker Desktop, with the `docker compose` plugin.

## 1. Install dependencies

```bash
npm install
```

`postinstall` runs `prisma generate` automatically.

## 2. Start Postgres

```bash
docker compose up -d postgres
```

This starts Postgres 17 on `localhost:5432` (user `postgres`, password `postgres`) and, on first
start of the `pgdata` volume, creates three databases via `docker/postgres-init.sql`:

| Database | Used by |
|---|---|
| `whitelabel_dev` | the dev server |
| `whitelabel_test_shared` | `npm run test:int:shared` |
| `whitelabel_test_dedicated` | `npm run test:int:dedicated` |

Check health with `docker compose ps` (the service should report `healthy`). Stop it with
`docker compose stop postgres`; `docker compose down -v` also deletes the data volume (and the init
script runs again on the next start).

## 3. Configure the environment

```bash
cp .env.example .env
```

Then edit `.env`:

- Replace `JWT_SECRET` with a random string of at least 32 characters (for example
  `openssl rand -base64 48`).
- Leave `DEPLOYMENT_MODE=shared`, or switch to `dedicated` and set `DEDICATED_TENANT_SLUG`.

See [environment.md](./environment.md) for every variable.

## 4. Apply migrations

```bash
npm run db:deploy
```

Applies committed migrations (`prisma migrate deploy`). To author a new migration while changing
`prisma/schema.prisma`, use `npm run db:migrate` (`prisma migrate dev`).

## 5. Seed data

Seeding is coming in a later phase. `npm run db:seed` points at a script that does not exist yet.

## 6. Run the dev server

```bash
npm run dev
curl localhost:3000/api/v1/health
```

Expected response:

```json
{"success":true,"data":{"status":"ok","db":"up"},"meta":{"requestId":"..."}}
```

If the database is unreachable the endpoint returns HTTP 503 instead.

## Quality checks

| Command | Purpose |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | unit tests (no database needed) |
| `npm run test:int:shared` | integration tests, shared mode (needs Postgres running) |
| `npm run test:int:dedicated` | integration tests, dedicated mode (no test files yet) |
| `npm run build` | production build |

## Resetting the test databases

```bash
npm run db:reset:test
```

Prisma 7 blocks `prisma migrate reset` when it detects an AI agent, so this command must be run by
a human in their own terminal. It drops and re-migrates both test databases.

## Other scripts

`openapi:generate`, `openapi:lint` and `tenant` are declared in `package.json` but their target
files are not implemented yet; they arrive in later phases.
