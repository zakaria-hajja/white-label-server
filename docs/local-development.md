# Local development

## Prerequisites

- Node 24 (see `.nvmrc`; `package.json` enforces `>=24 <25`).
- Docker Desktop (`brew install --cask docker-desktop`, then open it once to accept the license). It provides `docker` and the `docker compose` plugin.

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

```bash
npm run db:seed
```

Idempotent (safe to run repeatedly) and refused when `NODE_ENV=production`. In `shared` mode it
creates tenants `acme` and `globex`; in `dedicated` mode only `DEDICATED_TENANT_SLUG`. Each tenant
gets users `alice@shared.test` and `bob@shared.test` (password `Password123!`) and 25 catalog items.

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
| `npm run test:int:dedicated` | integration tests, dedicated mode (needs Postgres running) |
| `npm run build` | production build |

## Resetting the test databases

```bash
npm run db:reset:test
```

Prisma 7 blocks `prisma migrate reset` when it detects an AI agent, so this command must be run by
a human in their own terminal. It drops and re-migrates both test databases.

## Other scripts

`npm run openapi:generate` rewrites `openapi/openapi.json` from the Zod schemas; `npm run openapi:lint`
runs Redocly on it. See the OpenAPI section of [adding-a-module.md](adding-a-module.md).

## Managing tenants

There is no admin API; tenants are managed with a CLI (it reads `DATABASE_URL` from `.env`):

```bash
npm run tenant -- create --slug acme --name "Acme" [--config path.json]
npm run tenant -- list
npm run tenant -- set-status --slug acme --status SUSPENDED   # or ACTIVE
npm run tenant -- set-config --slug acme --file cfg.json      # validated; bumps config version
npm run tenant -- set-feature --slug acme --key catalog --enabled true
```

`create` writes a default application config and the `catalog` feature flag in one transaction.
Output is JSON; errors print one line and exit 1. A running server notices status changes within
30 s (tenant cache TTL). See [architecture.md](./architecture.md#tenant-resolution).

## Docker

One image serves both deployment modes; the mode comes from env (see [environment.md](environment.md)).
The image runs as the non-root `node` user, contains no `.env` files, and listens on port 3000.

```bash
docker build -t whitelabel-api .                                    # runtime image (default target)
docker build --target migrator -t whitelabel-api-migrator .        # Prisma CLI + migrations
```

Run migrations before rolling out the app (the runtime image deliberately has no Prisma CLI):

```bash
docker run --rm -e DATABASE_URL=... whitelabel-api-migrator        # runs `prisma migrate deploy`
docker run -p 3000:3000 -e DEPLOYMENT_MODE=shared -e DATABASE_URL=... -e JWT_SECRET=... whitelabel-api
```

To try the whole stack locally (throwaway dev secrets, migrates `whitelabel_dev` first):

```bash
docker compose --profile app up --build        # API on :3000; set API_PORT=3100 if 3000 is taken
docker compose --profile app down              # keeps the postgres volume
```

A dedicated instance with an unknown `DEDICATED_TENANT_SLUG` exits 1 at startup.

## CI

`.github/workflows/ci.yml` (job `ci`, on every PR and on push to `main`) runs against a `postgres:17`
service: lint, typecheck, `prisma validate`, migrate the shared and dedicated test databases,
`prisma migrate diff` (fails if `schema.prisma` has changes without a migration; uses
`SHADOW_DATABASE_URL`), unit tests, shared and dedicated integration tests (tenant isolation and auth),
OpenAPI regeneration with `git diff --exit-code openapi/` (fails on contract drift), OpenAPI lint,
`next build`, and the commit message check. Run the drift check locally with `SHADOW_DATABASE_URL`
pointing at an empty scratch database.
