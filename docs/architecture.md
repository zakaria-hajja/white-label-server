# Architecture

## Overview

A multi-tenant REST API (Next.js 16 route handlers, TypeScript, Prisma 7, PostgreSQL) for white-label
mobile apps. Each client app (one Android build per brand) talks to the same code base; the contract is
the committed [`openapi/openapi.json`](../openapi/openapi.json) (see [api.md](./api.md)).

One image runs in two modes, chosen by `DEPLOYMENT_MODE` at startup:

- **Shared:** one instance and one database serve many tenants; each request names its tenant with
  `X-Client-Id` (the tenant slug), and after login the tenant is the signed `tid` claim.
  See [deployment-shared.md](./deployment-shared.md).
- **Dedicated:** one deployment (own database, `JWT_SECRET`, domain) serves exactly one tenant, fixed by
  `DEDICATED_TENANT_SLUG`. See [deployment-dedicated.md](./deployment-dedicated.md).

```mermaid
flowchart LR
    subgraph Shared
      A1[Acme app<br/>X-Client-Id: acme] --> LB[Load balancer]
      A2[Globex app<br/>X-Client-Id: globex] --> LB
      LB --> I1[API instance] --> DB[(PostgreSQL<br/>tenants: acme, globex)]
      LB --> I2[API instance] --> DB
    end
    subgraph Dedicated
      B1[Acme app] --> D1[api.acme.com<br/>DEDICATED_TENANT_SLUG=acme] --> DBA[(acme DB)]
      B2[Globex app] --> D2[api.globex.com<br/>DEDICATED_TENANT_SLUG=globex] --> DBG[(globex DB)]
    end
```

## Folder structure

```
src/
  app/api/v1/        route.ts files only (thin: each is a route({...}) call)
  instrumentation*.ts startup config validation
  core/
    config/          env schema, loadConfig()
    container.ts     composition root (wires repositories, services, caches)
    database/        Prisma client factory, Prisma error mapping
    errors/          AppError, error codes -> HTTP status
    http/            route() pipeline, envelopes, request id, client IP, body reader, health DTO
    logging/         pino logger with redaction
    rate-limit/      RateLimiter interface + in-memory fixed-window implementation
    tenant/          TenantContext, shared/dedicated resolvers, tenant repository + cache, admin service
    auth/            JWT, password hashing, opaque tokens, per-request session check
    validation/      common Zod schemas (email, password, uuid, pagination)
    openapi/         registry, shared components, system routes
  modules/           auth, users, settings, catalog, app-config, mail
  shared/            tiny pure helpers (clock)
  generated/prisma/  generated Prisma client (do not edit)
prisma/              schema.prisma, migrations/, seed.ts
scripts/             generate-openapi.ts, tenant.ts (operator CLI), commit/CI helpers
openapi/             openapi.json (generated, committed)
tests/               unit/, integration/, helpers/, setup/
docs/                this documentation
docker/              postgres-init.sql (local databases)
```

A request flows `route.ts` -> `route()` (tenant, auth, parse, rate limit) -> `<module>.handlers.ts` ->
`<module>.service.ts` -> `<module>.repository.ts` -> Prisma.

## Module boundaries

| Module | Owns | Does not own |
| --- | --- | --- |
| `core/config` | Parse and validate env; typed `AppConfig` | Business rules |
| `core/tenant` | `TenantContext`; shared and dedicated resolvers; tenant lookup with 30 s cache; tenant admin service (used by the CLI) | Tenant CRUD over HTTP (none exists) |
| `core/auth` | Sign/verify access JWTs; hash/verify passwords; opaque tokens; per-request session check | Login and registration flows |
| `core/http` | `route()` pipeline; success/error envelopes; request id; client IP | Business logic |
| `core/rate-limit` | `RateLimiter` interface; in-memory fixed window | Distributed limiting (swap in Redis behind the interface) |
| `modules/auth` | Register, login, refresh rotation and reuse detection, logout, forgot/reset password, sessions, lockout | Profile edits |
| `modules/users` | Own profile, change password | Tokens |
| `modules/settings` | Per-user theme, language, notification preferences (created lazily with defaults) | App-wide defaults |
| `modules/catalog` | Tenant-scoped list (page, search, filter, sort) and detail; the template for new modules | - |
| `modules/app-config` | Public per-tenant config document (validated JSON, allowlisted output) and feature flags | Android build-time branding |
| `modules/mail` | `Mailer` interface, `ConsoleMailer` | A real provider (none yet) |

Rules: handlers contain no tenancy logic; services receive the `TenantContext` explicitly; only
repositories touch Prisma; DTO mappers are explicit allowlists. See [adding-a-module.md](./adding-a-module.md).

## Data model

Matches `prisma/schema.prisma`. Every tenant-owned table carries `tenant_id`; child tables reference
`(tenant_id, id)` of `users` with composite foreign keys so a row can never point at another tenant's user.

```mermaid
erDiagram
    Tenant ||--o{ User : has
    Tenant ||--o{ Session : has
    Tenant ||--o{ PasswordResetToken : has
    Tenant ||--o{ UserSettings : has
    Tenant ||--o{ CatalogItem : has
    Tenant ||--o| ApplicationConfiguration : has
    Tenant ||--o{ FeatureFlag : has
    User ||--o{ Session : "has (tenantId,userId)"
    User ||--o{ PasswordResetToken : "has (tenantId,userId)"
    User ||--o| UserSettings : "has (tenantId,userId)"
    Session ||--o{ RefreshToken : rotates

    Tenant {
        uuid id PK
        string slug UK
        string name
        enum status "ACTIVE|SUSPENDED"
        datetime createdAt
        datetime updatedAt
    }
    User {
        uuid id PK
        uuid tenantId FK
        string email "unique with tenantId"
        string passwordHash
        string firstName "nullable"
        string lastName "nullable"
        enum status "ACTIVE|DISABLED"
        int failedLoginCount
        datetime lockedUntil "nullable"
        datetime passwordChangedAt
    }
    Session {
        uuid id PK
        uuid tenantId FK
        uuid userId FK
        string userAgent "nullable"
        string ipAddress "nullable"
        datetime lastUsedAt
        datetime expiresAt
        datetime revokedAt "nullable"
        string revokedReason "nullable"
    }
    RefreshToken {
        uuid id PK
        uuid sessionId FK
        string tokenHash UK
        datetime expiresAt
        datetime usedAt "nullable"
    }
    PasswordResetToken {
        uuid id PK
        uuid tenantId FK
        uuid userId FK
        string tokenHash UK
        datetime expiresAt
        datetime usedAt "nullable"
    }
    UserSettings {
        uuid id PK
        uuid tenantId FK
        uuid userId FK "unique"
        enum theme "SYSTEM|LIGHT|DARK"
        string language
        json notificationPreferences
    }
    CatalogItem {
        uuid id PK
        uuid tenantId FK
        string title
        string description "nullable"
        string category "nullable"
        string imageUrl "nullable"
    }
    ApplicationConfiguration {
        uuid id PK
        uuid tenantId FK "unique"
        json configuration
        int version
    }
    FeatureFlag {
        uuid id PK
        uuid tenantId FK
        string key "unique with tenantId"
        boolean enabled
    }
```

A `Session` is the revocable unit (one per login); each refresh rotation adds a `RefreshToken` row to the
same session and marks the previous one used. Ids are UUIDv7. `RefreshToken` has no tenant column: it is
reached only through its session, which is tenant-scoped.

## Tenant resolution

Every request is bound to exactly one tenant before any business code runs. Client input is never
trusted on its own: a slug is checked against the database (or deployment config) and the tenant
claim is trusted only from a signature-verified JWT.

Resolver outcomes (`src/core/tenant/shared-resolver.ts`, `dedicated-resolver.ts`, `resolver.ts`).
"Token" means a signature-verified bearer token carrying `tid`.

| Mode      | Token                               | `X-Client-Id`                               | Result                                                                                                     |
| --------- | ----------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| shared    | no                                  | missing                                     | 400 `INVALID_CLIENT`                                                                                       |
| shared    | no                                  | malformed or unknown slug                   | 400 `INVALID_CLIENT`                                                                                       |
| shared    | no                                  | known slug                                  | tenant from header                                                                                         |
| shared    | yes, tenant exists                  | none, or the token tenant's slug            | tenant from token                                                                                          |
| shared    | yes, tenant exists                  | anything else (other, unknown or malformed) | 403 `TENANT_MISMATCH`                                                                                      |
| shared    | yes, `tid` unknown                  | any                                         | 401 `UNAUTHENTICATED`                                                                                      |
| dedicated | no                                  | none or `DEDICATED_TENANT_SLUG`             | the deployment tenant                                                                                      |
| dedicated | any                                 | any other value                             | 400 `INVALID_CLIENT` (checked before the token)                                                            |
| dedicated | yes, `tid` is the deployment tenant | none or matching                            | the deployment tenant                                                                                      |
| dedicated | yes, `tid` is another tenant        | none or matching                            | 401 `UNAUTHENTICATED`                                                                                      |
| any       | any                                 | any                                         | resolved tenant is `SUSPENDED`: 403 `TENANT_SUSPENDED` (checked last, only for an otherwise valid request) |

```mermaid
flowchart TD
    Req[Incoming request] --> Mode{Mode}
    Mode -- shared --> STok{Verified token?}
    STok -- no --> SH{X-Client-Id valid slug<br/>and tenant exists?}
    SH -- no --> E1[400 INVALID_CLIENT]
    SH -- yes --> Rec
    STok -- yes --> STid{tid exists?}
    STid -- no --> E2[401 UNAUTHENTICATED]
    STid -- yes --> SHdr{Header sent and<br/>not the token tenant's slug?}
    SHdr -- yes --> E3[403 TENANT_MISMATCH]
    SHdr -- no --> Rec
    Mode -- dedicated --> DH{Header sent and<br/>≠ DEDICATED_TENANT_SLUG?}
    DH -- yes --> E4[400 INVALID_CLIENT]
    DH -- no --> DTok{Token tid ≠ deployment tenant?}
    DTok -- yes --> E5[401 UNAUTHENTICATED]
    DTok -- no --> Rec
    Rec[Tenant record] --> Susp{SUSPENDED?}
    Susp -- yes --> E6[403 TENANT_SUSPENDED]
    Susp -- no --> Ctx[Trusted TenantContext]
    Ctx --> Svc[Services receive ctx explicitly]
    Svc --> Repo[Repositories: every query WHERE tenantId = ctx.tenantId]
```

**Caching and suspension.** Tenant lookups are cached in memory for 30 s (`CachedTenantLookup`;
misses are never cached). The CLI runs as a separate process and does not touch the server's
cache, so suspending a tenant takes effect on running servers within 30 s.

**Where enforcement lives.**

- `route()` (`src/core/http/route.ts`) is the only place a `TenantContext` is created, by calling the
  mode's resolver (`src/core/tenant/`). Route handlers contain no tenancy logic.
- Every tenant-owned repository method takes `tenantId` as its first parameter and filters by it;
  lookups by id use `findFirst({ where: { id, tenantId } })`, so a foreign id is "not found".
- The database adds composite foreign keys and tenant-scoped unique constraints as a backstop.
- Postgres RLS (`SET LOCAL app.tenant_id`) is deferred as a future hardening step because it needs
  every query inside a transaction.

Tenants are managed by the operator CLI (`npm run tenant`, see
[local-development.md](./local-development.md)); there is no admin HTTP API.

## Authentication

Email and password accounts, scoped to one tenant (`User` is unique on `(tenantId, email)`).
Sessions are the revocable unit; tokens are just credentials for a session.

**Token model**

- **Access token:** a JWT signed HS256 with `JWT_SECRET`. Claims: `sub` (user id), `tid` (tenant id),
  `sid` (session id), plus `iss` (`JWT_ISSUER`), `aud` (`whitelabel-api`), `iat`, `exp`. TTL is
  `ACCESS_TOKEN_TTL_SECONDS` (default 900 s). The tenant claim is trusted only from a verified token.
- **Refresh token:** 32 random bytes, base64url. Only its SHA-256 hex is stored (`RefreshToken.tokenHash`);
  the plain value is returned once and never logged.
- **Session:** one per login, `REFRESH_SESSION_TTL_DAYS` (default 30) absolute lifetime. It holds the
  user agent and IP and can be revoked with a reason (`logout`, `user_revoked`, `password_reset`,
  `password_changed`, `refresh_token_reuse`). Rotating a refresh token does not extend it.
- **Passwords:** Argon2id (memoryCost 19456, timeCost 2, parallelism 1), 10 to 128 characters.

```mermaid
sequenceDiagram
    participant A as Mobile app
    participant R as route() pipeline
    participant T as TenantResolver
    participant S as AuthService
    participant DB as PostgreSQL
    A->>R: POST /auth/login {email,password}<br/>X-Client-Id: acme
    R->>T: resolve (no token yet)
    T->>DB: Tenant by slug "acme"
    T-->>R: TenantContext{tenantId}
    R->>R: rate limit (login-ip, login-account)
    R->>S: login(ctx, input)
    S->>DB: User where tenantId AND email
    S->>S: argon2id verify (dummy verify if no user, locked or disabled)
    S->>DB: create Session + RefreshToken(hash)
    S-->>A: {user, tokens{accessToken(sub,tid,sid), refreshToken, expiresIn}}
    A->>R: GET /users/me  Authorization: Bearer ...
    R->>R: verify JWT signature/iss/aud/exp
    R->>T: resolve(claims.tid, X-Client-Id)
    T-->>R: TenantContext (header, if sent, must match tid)
    R->>DB: Session sid live for sub+tid? user ACTIVE?
    R->>S: handler(ctx, auth{userId,tenantId,sessionId})
```

**Per-request session check.** For every `auth: "required"` route, `route()` verifies the JWT, resolves
the tenant, then `PrismaSessionCheck` loads the session by `(sid, sub, tid)` and requires it to be not
revoked, not expired, and its user `ACTIVE`; otherwise `401 UNAUTHENTICATED`. This is one indexed query
per request, and it makes logout, password change and disabling a user effective immediately instead of
after the access token expires. `lastUsedAt` is refreshed at most every 5 minutes.

**Refresh rotation and reuse detection** (`AuthService.refresh`). Each refresh token is single use.

1. Look up by hash. Unknown, another tenant's, expired, or belonging to a revoked or expired session or
   a non-active user: `401 INVALID_REFRESH_TOKEN`. A token from another tenant never revokes anything.
2. In one transaction, atomically claim the token (`usedAt` set only if still null), create the next
   token (same session expiry) and touch the session. The new pair is returned.
3. If the claim is lost (token already used): when it was used less than 10 s ago this is treated as
   a benign retry or race: reject with `401`, keep the session. After the 10 s grace window it is
   treated as theft: the session is revoked with reason `refresh_token_reuse` and `401` is returned.

Clients must serialize refreshes (single flight).

**Lockout and enumeration protections**

- 10 consecutive failed logins lock the account for 15 minutes (DB-backed, so it holds across
  instances). A locked, disabled or unknown account returns the same `401 INVALID_CREDENTIALS` as a
  wrong password, and each of those paths spends one Argon2 verification (a dummy one when no hash is
  available) to equalize timing. A successful login clears the counter.
- Forgot-password always answers `202 {}` and swallows mail errors.
- Reset tokens: 32 random bytes, SHA-256 stored, 30 min expiry, single use, looked up per tenant. A
  reset updates the password, revokes all sessions and clears the lockout. Requesting a new token
  invalidates earlier ones.
- Changing a password (`PATCH /users/me/password`) requires the current password and revokes every
  other session, keeping the caller's.

**Rate limits** (in `auth.handlers.ts` and `users.handlers.ts`, evaluated by `route()` after input parsing; `429
RATE_LIMITED` with `Retry-After`). IP rules use `ipKey`, which skips the rule when the IP is unknown.

| Rule name                 | Route                      | Limit / window | Key                 |
| ------------------------- | -------------------------- | -------------- | ------------------- |
| `register-ip`             | POST /auth/register        | 5 / 1 h        | IP                  |
| `login-ip`                | POST /auth/login           | 10 / 60 s      | IP                  |
| `login-account`           | POST /auth/login           | 5 / 60 s       | tenant id + email   |
| `refresh-ip`              | POST /auth/refresh         | 30 / 60 s      | IP                  |
| `forgot-account`          | POST /auth/forgot-password | 3 / 15 min     | tenant id + email   |
| `forgot-ip`               | POST /auth/forgot-password | 10 / 15 min    | IP                  |
| `reset-ip`                | POST /auth/reset-password  | 10 / 15 min    | IP                  |
| `change-password-account` | PATCH /users/me/password   | 5 / 15 min     | tenant id + user id |

Differences from the original design: `login-account` is keyed by tenant and email, not IP and email, so
distributed guessing is also limited; logout, `/auth/me`, sessions and the other `/users/me` routes have
no rate limit of their own.

**Security notes**

- `POST /auth/register` returns `409 EMAIL_ALREADY_REGISTERED`, a known account-enumeration vector
  (a mobile UX trade-off); it is rate limited per IP.
- IP-based limits only work with `TRUST_PROXY=true` behind a proxy that sets the client IP header;
  otherwise the IP is unknown and those rules are skipped (a warning is logged in production).
  Account-keyed rules still apply.
- A refresh whose response is lost cannot be recovered: tokens are stored hashed, so the server cannot resend
  the new pair, and the retry with the old token gets `INVALID_REFRESH_TOKEN` (the user signs in again;
  after the 10 s grace the session is revoked). Accepted trade-off; see [api.md](./api.md#token-lifecycle).
- Rate limits are in memory and per instance: with N instances the effective limit is up to N times
  higher. Account lockout is in the database and is not affected.
- Forgot-password has a timing difference (an existing account does database writes and a mail send).
  Send the mail asynchronously before a real mail provider is added; the current console mailer only logs.

## Follow-up: Postgres row-level security

Not built; app-level scoping plus composite foreign keys are the current isolation. Plan for adding RLS
as defense in depth:

1. Use two roles: a migration owner role, and a non-owner, non-`BYPASSRLS` app role the server connects as.
2. Add `ENABLE` and `FORCE ROW LEVEL SECURITY` plus a policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`
   on every table with `tenant_id`; give `refresh_tokens` a policy through its session.
3. Run every request's queries inside one interactive transaction that starts with
   `SELECT set_config('app.tenant_id', $1, true)` (equivalent to `SET LOCAL`). This is the real cost:
   repositories must take a transaction client, and pre-tenant lookups (tenant by slug, refresh-token
   lookup by hash) need a deliberately scoped exemption.
4. Run the existing isolation suites with RLS on, then add tests that query without setting the variable
   and expect zero rows.
