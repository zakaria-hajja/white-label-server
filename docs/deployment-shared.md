# Shared deployment

One or more identical API instances and one PostgreSQL database serve many tenants. Each Android app
sends its tenant slug in `X-Client-Id` (see [api.md](./api.md#x-client-id-rules)). Background and diagrams:
[architecture.md](./architecture.md).

## Configuration

Set the variables in [environment.md](./environment.md). The minimum is:

```dotenv
DEPLOYMENT_MODE=shared
DATABASE_URL=postgresql://APP_USER:PASSWORD@HOST:5432/whitelabel?sslmode=require
JWT_SECRET=<random, at least 32 characters>
NODE_ENV=production
TRUST_PROXY=true
```

Do not set `DEDICATED_TENANT_SLUG` in shared mode (startup fails). Config is validated at startup; an
invalid value stops the process with the variable names (never the values).

## Build

One image serves both modes; the runtime image has no Prisma CLI, so migrations use a second target:

```bash
docker build -t whitelabel-api .                                  # runtime (default target)
docker build --target migrator -t whitelabel-api-migrator .      # prisma migrate deploy
```

Both run as the non-root `node` user; the runtime image listens on port 3000 and has a `HEALTHCHECK` on
`/api/v1/health`.

## Every rollout

1. Build both images from the same commit.
2. Run the migrator against the production database **before** starting the new app version:
   `docker run --rm -e DATABASE_URL=<owner-role URL> whitelabel-api-migrator`. It runs `prisma migrate deploy`
   and exits non-zero on failure; abort the rollout if it does.
3. Roll the app instances. Migrations must stay backward compatible with the previous app version for the
   duration of a rolling deploy (add columns before using them, remove them a release later).
4. Check `GET /api/v1/health` returns 200 (a database outage returns 503; see [api.md](./api.md#health)).

## Onboarding a tenant

There is no admin API; tenants are managed with the operator CLI. **The CLI is not in the runtime or
migrator images** (they contain no `scripts/`, `src/` or `tsx`). Run it from a source checkout of the same
release tag, on a trusted admin machine or a one-off job, with `DATABASE_URL` pointing at the target
database over TLS (`sslmode=require`) using a role that may write the tenant tables. It also requires
`DEPLOYMENT_MODE` and `JWT_SECRET` (the config loader validates them; the value is not used by the CLI).
No `.env` file is needed if you export the variables:

```bash
git checkout <release-tag> && npm ci
export DEPLOYMENT_MODE=shared JWT_SECRET=<any 32+ char value> \
  DATABASE_URL='postgresql://APP_USER:PASSWORD@HOST:5432/whitelabel?sslmode=require'
npm run tenant -- create --slug acme --name "Acme" --config acme-config.json
npm run tenant -- set-feature --slug acme --key catalog --enabled true
npm run tenant -- list
```

`create` writes a default application config and the `catalog` flag in one transaction; slugs are 2 to 63
lowercase letters, digits or hyphens. `--config` / `set-config` are validated against the app-config schema
(including `passwordReset.linkBaseUrl`, the deep link base for reset emails) and bump the config version.
Then ship the Android build with the shared base URL and `X-Client-Id=<slug>`. The CLI is a separate
process: server caches (tenant status, config, flags) refresh within 30 s.

**Suspending a tenant:** `npm run tenant -- set-status --slug acme --status SUSPENDED`. Running instances
return 403 `TENANT_SUSPENDED` within 30 s (the tenant cache TTL). Reactivate with `--status ACTIVE`.

## Behind a proxy: `TRUST_PROXY=true`

Terminate TLS at a load balancer and set `TRUST_PROXY=true`. Most proxies **append** the peer address to
`X-Forwarded-For` instead of replacing it, so the leftmost entries are whatever the client sent. The app
therefore reads the client IP from the right: set `TRUST_PROXY_HOPS` to the number of proxies **you
control** between the internet and the app (default `1`); the entry that many places from the right is
the client IP and everything to its left is ignored. If the header has fewer entries than that, or the
entry is not an IP, the IP is "unknown". `X-Real-IP` is read only when `X-Forwarded-For` is absent.

| Setup | `TRUST_PROXY_HOPS` |
| --- | --- |
| AWS ALB in front of the app (appends the client IP) | `1` |
| GCP external HTTP(S) load balancer (appends `<client-ip>, <lb-ip>`) | `2` |
| nginx with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` | `1` per nginx you run |
| CDN (e.g. CloudFront) -> ALB -> app | `2` (CDN + ALB) |

The rule: hops = number of proxies you control that append to the header. Verify once by logging a
request through the real chain. Without `TRUST_PROXY=true` the IP is "unknown", **all IP-based rate
limits are skipped** (a warning is logged in production) and only the account-keyed limits apply. Also make the proxy or CDN key any cache of `/app/config` on `X-Client-Id`
(the response sends `Vary: X-Client-Id`).

## Rate limits are per instance

Limits live in memory in each instance, so with N instances the effective limit is up to N times higher
(account lockout is stored in the database and is unaffected). To enforce them globally, implement the
`RateLimiter` interface (`src/core/rate-limit/rate-limiter.ts`) on Redis and wire it in
`src/core/container.ts`; no other code changes. Until then, add edge rate limiting at the load balancer.

## Secrets and rotation

- `JWT_SECRET` is shared by all instances of the deployment. **Rotating it invalidates every access token
  at once** (there is no overlap period: tokens signed with the old secret fail verification with 401
  `UNAUTHENTICATED`). Refresh tokens are random opaque values stored hashed and do not depend on the secret,
  and `/auth/refresh` does not need an access token, so a client that follows the
  [Android guidance](./api.md#android-client-guidance) (refresh once on 401, then retry) recovers silently;
  a client that treats that 401 as "sign out" signs every user out. Plan for either outcome, rotate all
  instances together and off-peak, and expect a burst of refreshes. To force a real sign-out, revoke the
  sessions in the database instead.
- Store secrets in your secret manager, never in the image or repository. The images contain no `.env`.
- Rotating the database password: create the new credential, update `DATABASE_URL`, roll instances.

## Database

- **TLS:** use `?sslmode=require` in `DATABASE_URL` for any non-local database.
- **Least privilege:** use two roles. `whitelabel_owner` owns the database and schema objects and is used
  **only by the migrator** (`DATABASE_URL` of the migrator job). `whitelabel_app` is not a superuser, owns
  nothing, and has only `SELECT, INSERT, UPDATE, DELETE`; it is the `DATABASE_URL` of the app instances.
  Run as a superuser (or an admin role) on a fresh database, before the first migration (tested on
  Postgres 17):

  ```sql
  CREATE ROLE whitelabel_owner LOGIN PASSWORD '<owner password>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  CREATE ROLE whitelabel_app   LOGIN PASSWORD '<app password>'   NOSUPERUSER NOCREATEDB NOCREATEROLE;
  CREATE DATABASE whitelabel OWNER whitelabel_owner;
  REVOKE ALL ON DATABASE whitelabel FROM PUBLIC;
  GRANT CONNECT ON DATABASE whitelabel TO whitelabel_app;

  \connect whitelabel
  -- PostgreSQL 15+ no longer lets PUBLIC (or non-owners) create in schema public
  GRANT USAGE, CREATE ON SCHEMA public TO whitelabel_owner;
  GRANT USAGE ON SCHEMA public TO whitelabel_app;
  -- tables the owner creates in future migrations (run by the owner or a superuser)
  ALTER DEFAULT PRIVILEGES FOR ROLE whitelabel_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO whitelabel_app;
  -- tables that already exist (a no-op on a fresh database)
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO whitelabel_app;
  ```

  Then run the migrator with the owner URL (`postgresql://whitelabel_owner:...@HOST:5432/whitelabel?sslmode=require`)
  and start the app with the app URL. Verified: as `whitelabel_app`, `SELECT` and `INSERT` on `tenants`
  work, while `DROP TABLE tenants` fails ("must be owner of table") and `CREATE TABLE` fails ("permission
  denied for schema public"). Tenant CLI writes need the app role or the owner. The test suites truncate
  tables, so they use their own superuser-owned test databases, not these roles.
- Back up the database; there is no application-level export.

## Pruning auth data (`npm run db:prune`)

Refresh tokens, sessions and password reset tokens are never deleted by the app, so the tables grow with
every login and refresh. Run the prune job periodically (daily is plenty) against each database. It is
built for production, idempotent, safe while the API serves traffic, and prints what it deleted:

- refresh tokens of revoked or expired sessions, used refresh tokens older than 1 day + the 10 s reuse
  window, and superseded refresh tokens older than 1 day;
- sessions revoked or expired more than 7 days ago (with their tokens);
- password reset tokens used or expired more than 1 day ago.

A deleted token presented later is simply unknown (401, nothing revoked), so no outcome changes. It covers
all tenants of the database. Like the tenant CLI it is **not in the images**: run it from a source checkout
of the same release tag (a cron job on an admin machine, or a scheduled one-off job), with the app role
(it needs only `DELETE`) and the same variables the CLI needs:

```bash
git checkout <release-tag> && npm ci
export DEPLOYMENT_MODE=shared JWT_SECRET=<any 32+ char value> \
  DATABASE_URL='postgresql://whitelabel_app:PASSWORD@HOST:5432/whitelabel?sslmode=require'
npm run db:prune   # {"deleted": {"refreshTokens": 120, "sessions": 8, "passwordResetTokens": 3}}
```

## Before adding a real mail provider

Forgot-password currently uses the console mailer: it only logs, and in production it **suppresses the
link** (`reset email suppressed: no mail provider`), so password reset does not work end to end in
production until a provider is added. With any other `NODE_ENV` (staging, `test`, unset) it **logs the
live reset link**, which lets anyone who can read the logs reset that account: set `NODE_ENV=production`
on every environment with real users, or restrict access to its logs. When you implement `Mailer` (`src/modules/mail/mailer.ts`):

- Send the mail **asynchronously** (queue or fire-and-forget with error logging). Today an existing account
  costs extra database writes and a mail call that an unknown email does not; a synchronous provider call
  would make that a measurable timing oracle for account enumeration.
- Keep the endpoint's `202 {}` response and swallow provider errors.
- Add the new `MAILER` value to `src/core/config/env.ts` and [environment.md](./environment.md).
