# White-Label Backend API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable Next.js + TypeScript REST API that serves many white-label Android apps in either a shared multi-tenant deployment or dedicated per-client deployments, from one codebase and one Prisma schema.

**Architecture:** Thin App Router route files call a central `route()` pipeline (request ID → logging → error mapping → rate limit → tenant resolution → auth → Zod validation), which hands a trusted `TenantContext` to module handlers → services → repositories. Every tenant-owned repository method takes `tenantId` explicitly. Mode differences live only in `core/config` and the two `TenantResolver` implementations.

**Tech Stack:** Node.js 24 LTS, Next.js 16 (App Router, standalone output), TypeScript (strict), PostgreSQL 17, Prisma 7 + `@prisma/adapter-pg`, Zod 4, `@asteasolutions/zod-to-openapi` 8, `jose`, `@node-rs/argon2`, `pino`, Vitest, `@redocly/cli`, `tsx`, Docker Compose, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-09-whitelabel-backend-design.md` (architecture design; section numbers below such as "design §5" refer to it).

## Global Constraints

- `DEPLOYMENT_MODE` ∈ `shared` | `dedicated`, validated at startup. Invalid config exits the process.
- All endpoints live under `/api/v1`. Every JSON response uses the envelope `{success, data, meta}` / `{success:false, error:{code,message,details?}, meta}`, except `GET /api/v1/openapi.json`. `meta.requestId` is always present, and `X-Request-Id` is always echoed.
- No route handler contains business logic; no business module imports `core/config` or branches on deployment mode.
- Every tenant-owned repository method takes `tenantId: string` as its first parameter and filters by it. Lookups by ID use `findFirst({ where: { id, tenantId } })`.
- A client-sent tenant identifier (`X-Client-Id`) is never trusted without a DB/config check. The tenant claim is trusted only from a verified JWT.
- Passwords: Argon2id, memoryCost 19456, timeCost 2, parallelism 1. Policy: 10–128 chars.
- Access JWT HS256, `aud: "whitelabel-api"`, `iss: JWT_ISSUER`, claims `sub`, `tid`, `sid`, default TTL 900 s. Refresh token: 32 random bytes base64url; only its SHA-256 hex is stored. Session TTL 30 days. Reset token TTL 30 min, single use. Reuse grace window 10 s.
- Lockout: 10 consecutive failures → 15 min lock; a locked login returns the same `401 INVALID_CREDENTIALS`.
- Errors never include stack traces, Prisma messages or SQL. Logs redact `password`, `currentPassword`, `newPassword`, `passwordHash`, `refreshToken`, `token`, `accessToken`, `authorization`, `cookie`.
- No web frontend, no admin dashboard, no admin HTTP API.
- Dependency versions: latest release of the named major that is ≥ 2 weeks old, pinned exactly (`save-exact=true` in `.npmrc`).
- Error codes and statuses exactly as in design §9.

## Review Focus

1. **Concurrent refresh with the same token** (Android retry/parallel calls) — the second call gets `401 INVALID_REFRESH_TOKEN` and the session survives if within 10 s; beyond 10 s the session is revoked. Test added in Task 10.
2. **Email casing/whitespace** — ` Bob@Example.com ` and `bob@example.com` are the same account within a tenant (register → 409, login succeeds), but distinct across tenants. Tests added in Task 9 and Task 16.
3. **Tenant suspended after tokens were issued** — existing access and refresh tokens stop working (`403 TENANT_SUSPENDED`) once the cache entry expires. Test added in Task 16.
4. **Malformed or oversized bodies** — non-JSON body, wrong content type, `null` body or a body over `MAX_BODY_BYTES` → 400 `VALIDATION_ERROR` / 413 `PAYLOAD_TOO_LARGE`, never 500. Tests added in Task 4.
5. **Catalog edge input** — a non-UUID `id` → 404 (not a 500 from Postgres); `page` past the end → empty list with correct totals; `pageSize=1000` or `sort=password:asc` → 400. Tests added in Task 15.

---

## Phases and PRs

Git workflow rules: `CLAUDE.md` § Git workflow (built by "Task 0: Git workflow",
`docs/superpowers/plans/2026-11-09-git-workflow.md`). Each phase is one branch and one PR:

| Branch | Tasks |
|--------|-------|
| `feat/foundation` | 0–5 |
| `feat/tenancy` | 6–7 |
| `feat/auth-users` | 8–12 |
| `feat/modules` | 13–15 |
| `feat/security-openapi-ci` | 16–18 |
| `docs/guides` | 19 |

At every checkpoint ("Report and wait", Task 5, and the end of Tasks 18 and 19): push the
branch, open a PR with `gh pr create` filled in from `.github/pull_request_template.md`,
report, and wait for the owner to merge. Then branch the next phase from the updated `main`.

## Phase 2 — Foundation

### Task 1: Toolchain and Next.js skeleton

**Files:**
- Create: `package.json`, `.npmrc`, `.nvmrc`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `vitest.config.ts`, `src/app/api/v1/health/route.ts` (temporary stub), `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts used by every later task: `dev`, `build`, `start`, `lint`, `typecheck`, `test:unit`, `test:int:shared`, `test:int:dedicated`, `test` (all), `db:migrate`, `db:deploy`, `db:seed`, `db:reset:test`, `openapi:generate`, `openapi:lint`, `tenant`.

- [ ] **Step 1: Install toolchain.** `brew install node@24` (or `fnm install 24`) and Docker Desktop (`brew install --cask docker-desktop`; needs the user's sudo password). **Ask the user before installing a Docker runtime** — it is a system-level app. Verify: `node -v` prints `v24.*`, `docker compose version` succeeds.
- [ ] **Step 2: `git init`**, create `.gitignore` (node_modules, .next, .env*, !.env.example, coverage, src/generated).
- [ ] **Step 3: Scaffold manually (not `create-next-app`, which adds a frontend):** install `next react react-dom` and dev deps `typescript @types/node @types/react eslint eslint-config-next prettier vitest vite-tsconfig-paths tsx`. `tsconfig`: `strict`, `noUncheckedIndexedAccess`, path alias `@/*` → `src/*`. `next.config.ts`: `output: "standalone"`, `serverExternalPackages: ["@node-rs/argon2", "pino"]`, `poweredByHeader: false`. `.nvmrc`: `24`. `"engines": {"node": ">=24 <25"}`.
- [ ] **Step 4: Write `tests/unit/smoke.test.ts`** asserting `GET` from the health stub returns status 200. Vitest config defines three projects: `unit` (`tests/unit/**`), `integration-shared` and `integration-dedicated` (`tests/integration/**`, `fileParallelism: false`, each with its own `env` — see Task 3).
- [ ] **Step 5: Run** `npm run test:unit`, `npm run lint`, `npm run typecheck` and `npm run build`. Expected: all pass.
- [ ] **Step 6: Commit** (include `docs/superpowers/**`): `chore: scaffold Next.js API project`.

### Task 2: Config, logging, errors, envelopes

**Files:**
- Create: `src/core/config/env.ts`, `src/core/logging/logger.ts`, `src/core/errors/app-error.ts`, `src/core/errors/codes.ts`, `src/core/http/envelope.ts`, `src/shared/clock.ts`, `.env.example`
- Test: `tests/unit/core/config.test.ts`, `tests/unit/core/envelope.test.ts`, `tests/unit/core/logger.test.ts`

**Interfaces:**
- Produces:
  - `type DeploymentMode = "shared" | "dedicated"`
  - `type AppConfig = { mode: DeploymentMode; databaseUrl: string; dedicatedTenantSlug: string | null; jwt: { secret: Uint8Array; issuer: string; audience: "whitelabel-api"; accessTtlSeconds: number }; sessionTtlDays: number; passwordResetTtlMinutes: number; trustProxy: boolean; logLevel: string; mailer: "console"; maxBodyBytes: number; nodeEnv: string }`
  - `loadConfig(env: Record<string, string | undefined>): AppConfig` — throws `ConfigError` listing every invalid var (never echoes secret values).
  - `ErrorCode` string union + `ERROR_STATUS: Record<ErrorCode, number>` (design §9).
  - `class AppError extends Error { constructor(code: ErrorCode, message?: string, details?: unknown, headers?: Record<string,string>) ; status: number }`
  - `ok<T>(data: T, opts?: { status?: number; pagination?: Pagination; requestId: string }): Response`, `fail(err: AppError, requestId: string): Response`, `type Pagination = { page; pageSize; totalItems; totalPages }`
  - `createLogger(level: string): pino.Logger` with the redaction list from Global Constraints.
  - `interface Clock { now(): Date }`, `systemClock`.

- [ ] **Step 1: Write failing tests:**
  - `loadConfig` rejects a missing `DEPLOYMENT_MODE`, `DEPLOYMENT_MODE=multi`, `JWT_SECRET` shorter than 32 chars, and `dedicated` without `DEDICATED_TENANT_SLUG`; the error message contains `JWT_SECRET` but not the secret's value.
  - `shared` with `DEDICATED_TENANT_SLUG` set → throws (ambiguous config).
  - Defaults: `accessTtlSeconds === 900`, `sessionTtlDays === 30`, `passwordResetTtlMinutes === 30`, `maxBodyBytes === 65536`, `trustProxy === false`.
  - `ok({a:1},{requestId:"r1"})` → body `{success:true,data:{a:1},meta:{requestId:"r1"}}`, header `x-request-id: r1`.
  - `fail(new AppError("RATE_LIMITED", undefined, undefined, {"Retry-After":"30"}), "r1")` → status 429, `Retry-After: 30`, body `error.code === "RATE_LIMITED"`.
  - The logger writing `{password:"x", refreshToken:"y", headers:{authorization:"z"}}` emits `[Redacted]` for all three.
- [ ] **Step 2: Run** `npm run test:unit` → FAIL (modules missing).
- [ ] **Step 3: Implement** with a Zod schema over `process.env`-shaped input; the secret is encoded with `TextEncoder`. `.env.example` documents every var from design §Environment variables, with two commented blocks (shared / dedicated).
- [ ] **Step 4: Run** `npm run test:unit` → PASS.
- [ ] **Step 5: Commit** `feat(core): config, logging, errors, response envelopes`.

### Task 3: Prisma schema, migration, local Postgres

**Files:**
- Create: `prisma/schema.prisma`, `prisma.config.ts`, `prisma/migrations/*` (generated), `src/core/database/prisma.ts`, `src/core/database/prisma-errors.ts`, `docker-compose.yml`, `docker/postgres-init.sql`, `tests/helpers/db.ts`, `tests/setup/integration.ts`
- Test: `tests/integration/database/schema.test.ts`

**Interfaces:**
- Produces:
  - Prisma models exactly per design §4: `Tenant`, `User`, `Session`, `RefreshToken`, `PasswordResetToken`, `UserSettings`, `CatalogItem`, `ApplicationConfiguration`, `FeatureFlag`; enums `TenantStatus {ACTIVE SUSPENDED}`, `UserStatus {ACTIVE DISABLED}`, `Theme {SYSTEM LIGHT DARK}`. Generator `prisma-client`, output `src/generated/prisma`.
  - `createPrisma(databaseUrl: string): PrismaClient` (adapter-pg).
  - `isUniqueViolation(e: unknown): boolean`, `isNotFound(e: unknown): boolean` (P2002/P2025).
  - Test helpers: `testPrisma(): PrismaClient`, `resetDb(): Promise<void>` (TRUNCATE all tables CASCADE), `createTenant(slug: string, overrides?): Promise<Tenant>`.

- [ ] **Step 1: docker-compose:** service `postgres` (image `postgres:17`, port 5432, healthcheck `pg_isready`, volume). `docker/postgres-init.sql` creates the databases `whitelabel_dev`, `whitelabel_test_shared` and `whitelabel_test_dedicated`. Optional service `api` under profile `app` (built in Task 18).
- [ ] **Step 2: Write the schema.** `@@map` snake_case tables and `@map` snake_case columns; UUIDv7 IDs with `@db.Uuid`; `User @@unique([tenantId, email])` and `@@unique([tenantId, id])`; composite relations `Session/PasswordResetToken/UserSettings (tenantId, userId) → User(tenantId, id)`; `UserSettings.userId @unique`; `ApplicationConfiguration.tenantId @unique`; `FeatureFlag @@unique([tenantId, key])`; `RefreshToken.tokenHash @unique`; `PasswordResetToken.tokenHash @unique`; indexes from design §4; `onDelete: Cascade`.
- [ ] **Step 3: Run** `docker compose up -d postgres`, then `npx prisma validate` and `npx prisma migrate dev --name init` → migration created. `db:reset:test` script = `prisma migrate reset --force --skip-seed` against both test DBs.
- [ ] **Step 4: Write failing integration tests** (in `integration-shared`): creating two users with the same email in one tenant throws a P2002 unique violation, while the same email across two tenants succeeds; a `Session` with `tenantId` of tenant B and `userId` of a tenant-A user is rejected by the FK; deleting a tenant cascades to users.
- [ ] **Step 5: Run** `npm run test:int:shared` → PASS (the setup file runs `resetDb()` before each test).
- [ ] **Step 6: Commit** `feat(db): initial Prisma schema with tenant-scoped constraints`.

### Task 4: `route()` pipeline and health endpoint

**Files:**
- Create: `src/core/http/route.ts`, `src/core/http/request-id.ts`, `src/core/http/client-ip.ts`, `src/core/http/body.ts`, `src/core/validation/common.ts`, `src/core/container.ts`, `src/instrumentation.ts`, `src/app/api/v1/health/route.ts`
- Test: `tests/unit/core/route.test.ts`, `tests/integration/health.test.ts`

**Interfaces:**
- Consumes: Task 2 `AppError`, `ok`, `fail`, `createLogger`; Task 3 `createPrisma`.
- Produces:
  - `type Container = { config: AppConfig; prisma: PrismaClient; logger: Logger; clock: Clock; tenantResolver: TenantResolver; rateLimiter: RateLimiter; services: Services }` (fields filled in by later tasks; `Services` grows per module).
  - `getContainer(): Container` (lazy singleton from `process.env`), `setContainer(c: Container | null): void` (tests only).
  - `createContainer(config: AppConfig, overrides?: Partial<Container>): Container`.
  - `route<B, Q, P>(def: { auth: "none" | "required"; tenant: "required" | "none"; body?: ZodType<B>; query?: ZodType<Q>; params?: ZodType<P>; rateLimit?: RateLimitRule[]; handler: (c: RouteContext<B,Q,P>) => Promise<Response> }): (req: Request, ctx: { params: Promise<Record<string,string>> }) => Promise<Response>`
  - `type RouteContext<B,Q,P> = { req: Request; requestId: string; ip: string; body: B; query: Q; params: P; tenant: TenantContext | null; auth: AuthContext | null; container: Container; logger: Logger }` (the tenant/auth slots are wired in Tasks 6 and 8; until then `tenant: "none"` only).
  - Common Zod: `zEmail` (trim, lowercase, `z.email()`, max 254), `zPassword` (10–128), `zUuid`, `zPagination` (`page` coerce int ≥ 1 default 1; `pageSize` coerce int 1–100 default 20).
  - `readJsonBody(req: Request, maxBytes: number): Promise<unknown>`.
  - `resolveRequestId(req: Request): string`, `clientIp(req: Request, trustProxy: boolean): string`.

- [ ] **Step 1: Write failing unit tests** for `route()`:
  - A handler throwing `AppError("NOT_FOUND")` → 404 envelope.
  - A handler throwing `new Error("db password=abc")` → 500, `error.code === "INTERNAL_ERROR"`, and the body does not contain `"abc"` or `"stack"`; the logger received the error.
  - A body failing its Zod schema → 400 with `details[0].path === "email"`.
  - **(Review Focus 4)** Body `"{not json"` → 400 `VALIDATION_ERROR`; body `null` with a body schema → 400; `Content-Type: text/plain` with a body schema → 400; a 70,000-byte body → 413 `PAYLOAD_TOO_LARGE`.
  - `X-Request-Id: abcdef12` is echoed; `X-Request-Id: <script>` is replaced by a UUID.
  - `clientIp` with `trustProxy=false` ignores `X-Forwarded-For`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Pipeline order: requestId → child logger → try { rate limit → tenant → auth → parse params/query/body → handler } catch → map `AppError` / `ZodError` / unknown → `fail`. Log one line per request: method, path, status, durationMs, requestId, tenant slug. `instrumentation.ts` `register()` (only when `NEXT_RUNTIME === "nodejs"`) calls `getContainer()` and, in dedicated mode, `await container.tenantResolver.verifyStartup()` (added in Task 6); it logs and calls `process.exit(1)` on failure.
- [ ] **Step 4: Health route:** `route({auth:"none", tenant:"none"})` runs `SELECT 1` and returns `ok({status:"ok", db:"up"})`; if the DB query fails → 503 envelope `{status:"degraded", db:"down"}`. Integration test asserts 200 and `data.db === "up"`.
- [ ] **Step 5: Run** unit + shared integration tests → PASS; `npm run build` → PASS.
- [ ] **Step 6: Commit** `feat(http): central route pipeline, request ids, health endpoint`.

### Task 5: Phase 2 checkpoint

- [ ] Run `npm run lint && npm run typecheck && npm run test:unit && npm run test:int:shared && npm run build` → all green.
- [ ] Write `docs/local-development.md` (start Postgres, copy `.env.example`, migrate, seed, dev server) and `docs/environment.md` (the full var table from design §Environment variables).
- [ ] Security note in the report: error mapping verified, log redaction verified.
- [ ] Commit `docs: local development and environment reference`. **Report to the user and wait for go-ahead.**

---

## Phase 3 — Multi-tenant foundation

### Task 6: Tenant context and resolvers

**Files:**
- Create: `src/core/tenant/tenant-context.ts`, `src/core/tenant/tenant.repository.ts`, `src/core/tenant/tenant-cache.ts`, `src/core/tenant/resolver.ts`, `src/core/tenant/shared-resolver.ts`, `src/core/tenant/dedicated-resolver.ts`
- Modify: `src/core/container.ts` (choose the resolver by `config.mode`, the only place mode is read), `src/core/http/route.ts` (call the resolver)
- Test: `tests/unit/core/tenant-resolver.test.ts`, `tests/integration/tenant/resolution.shared.test.ts`, `tests/integration/tenant/resolution.dedicated.test.ts`

**Interfaces:**
- Produces:
  - `type TenantContext = Readonly<{ tenantId: string; slug: string; name: string; source: "header" | "token" | "deployment" }>`
  - `interface TenantLookup { findBySlug(slug: string): Promise<TenantRecord | null>; findById(id: string): Promise<TenantRecord | null> }`, `type TenantRecord = { id; slug; name; status: "ACTIVE" | "SUSPENDED" }`
  - `class CachedTenantLookup implements TenantLookup` (TTL 30 s, takes a `Clock`; `invalidate(): void`).
  - `interface TenantResolver { resolve(input: { clientId: string | null; tokenTenantId: string | null }): Promise<TenantContext>; verifyStartup(): Promise<void> }`
  - `X-Client-Id` header name constant `CLIENT_ID_HEADER = "x-client-id"`; slug format `^[a-z0-9][a-z0-9-]{1,62}$`.

Resolution rules (design §8):

| Mode | tokenTenantId | clientId | Result |
|---|---|---|---|
| shared | null | null | 400 `INVALID_CLIENT` |
| shared | null | unknown or bad format | 400 `INVALID_CLIENT` |
| shared | null | known | ctx(source "header") |
| shared | T | null or same tenant | ctx(source "token") |
| shared | T | different known/unknown tenant | 403 `TENANT_MISMATCH` |
| dedicated | null | null or == configured slug | ctx(source "deployment") |
| dedicated | any | ≠ configured slug | 400 `INVALID_CLIENT` |
| dedicated | ≠ deployment tenant id | – | 401 `UNAUTHENTICATED` |
| any | – | – | resolved tenant SUSPENDED → 403 `TENANT_SUSPENDED` |

- [ ] **Step 1: Write failing unit tests** — one test per table row, using an in-memory `TenantLookup` fake. Also: `CachedTenantLookup` calls its source once for two lookups within 30 s and again after the clock advances 31 s. `DedicatedTenantResolver.verifyStartup()` rejects when the slug is missing from the DB or the tenant is suspended.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `route()` reads the header and passes `tokenTenantId` from verified claims (null until Task 8). Routes with `tenant: "required"` get `c.tenant` non-null.
- [ ] **Step 4: Integration tests** with a probe route defined inside the test file using `route({auth:"none", tenant:"required"})`: in shared mode, a header with a seeded tenant returns its slug; in dedicated mode (dedicated project), no header returns the configured slug.
- [ ] **Step 5: Run** unit + both integration projects → PASS.
- [ ] **Step 6: Commit** `feat(tenant): centralized tenant context with shared and dedicated resolvers`.

### Task 7: Tenant management CLI and seed

**Files:**
- Create: `scripts/tenant.ts`, `src/core/tenant/tenant-admin.service.ts`, `prisma/seed.ts`
- Test: `tests/integration/tenant/tenant-admin.test.ts`

**Interfaces:**
- Consumes: `AppConfigDocumentSchema` from Task 14. **Ordering note:** this task defines `AppConfigDocumentSchema` in `src/modules/app-config/app-config.schemas.ts` now; Task 14 extends that file.
- Produces: `TenantAdminService` with `create({slug, name, config?: AppConfigDocument}): Promise<TenantRecord>`, `list()`, `setStatus(slug, status)`, `setConfig(slug, doc: unknown)` (validates with the Zod schema and increments `version`), `setFeature(slug, key, enabled)`.
- CLI: `npm run tenant -- create --slug acme --name "Acme" [--config path.json]`, `list`, `set-status --slug acme --status SUSPENDED`, `set-config --slug acme --file cfg.json`, `set-feature --slug acme --key catalog --enabled true`.
- `AppConfigDocumentSchema` (Zod): `{ app: { displayName: string(1..80), minSupportedVersionCode?: int≥1, latestVersionCode?: int≥1 }, support: { email?: email, phone?: string≤32, url?: url }, legal: { privacyPolicyUrl: url, termsUrl: url }, passwordReset: { linkBaseUrl: string url-or-custom-scheme } , runtime: { defaultLanguage: string(2..10), supportedLanguages: string[] min 1, defaultTheme: "SYSTEM"|"LIGHT"|"DARK" }, branding?: { primaryColor?: /^#[0-9A-Fa-f]{6}$/, logoUrl?: url } }`.

- [ ] **Step 1: Write failing tests:** `create` with a duplicate slug → error naming the slug; `setConfig` with `legal.privacyPolicyUrl: "nope"` → Zod error and the DB stays unchanged; `setFeature` upserts (two calls → one row); `create` writes a default config and default flags (`catalog: true`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** The seed reads `DEPLOYMENT_MODE`: shared seeds `acme` and `globex` (each with 2 users using password `Password123!` and 25 catalog items with different titles across tenants plus one identical title); dedicated seeds only `DEDICATED_TENANT_SLUG`. The seed refuses to run when `NODE_ENV=production`.
- [ ] **Step 4: Run** tests → PASS; `npm run db:seed` against dev → completes.
- [ ] **Step 5: Phase 3 checkpoint:** full test suite + build green; add the "Tenant resolution" section and the diagram from design §8 to `docs/architecture.md`; commit `feat(tenant): tenant management CLI and seed`. **Report and wait.**

---

## Phase 4 — Authentication and users

### Task 8: Crypto, JWT, and the auth guard

**Files:**
- Create: `src/core/auth/password.ts`, `src/core/auth/tokens.ts`, `src/core/auth/jwt.ts`, `src/core/auth/auth-context.ts`, `src/core/auth/session-check.ts`, `src/core/rate-limit/rate-limiter.ts`
- Modify: `src/core/http/route.ts` (the `auth: "required"` path), `src/core/container.ts`
- Test: `tests/unit/core/jwt.test.ts`, `tests/unit/core/password.test.ts`, `tests/unit/core/rate-limiter.test.ts`, `tests/integration/security/auth-guard.shared.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(p: string): Promise<string>`, `verifyPassword(hash: string, p: string): Promise<boolean>`, `dummyVerify(p: string): Promise<void>` (verifies against a fixed precomputed hash).
  - `generateOpaqueToken(): string` (32 bytes base64url), `hashToken(t: string): string` (sha256 hex).
  - `signAccessToken(cfg: AppConfig["jwt"], claims: { sub; tid; sid }, now: Date): Promise<string>`; `verifyAccessToken(cfg, token): Promise<AccessClaims>` → throws `AppError("TOKEN_EXPIRED")` for expiry, `AppError("UNAUTHENTICATED")` for anything else (bad signature, `alg: none`, wrong `iss`/`aud`, missing claims). Only `HS256` is accepted.
  - `type AuthContext = Readonly<{ userId: string; tenantId: string; sessionId: string }>`
  - `SessionCheck.assertLive(claims: AccessClaims, now: Date): Promise<void>` — the session exists with `id = sid AND userId = sub AND tenantId = tid AND revokedAt IS NULL AND expiresAt > now` and the user is ACTIVE; otherwise `UNAUTHENTICATED`. Updates `lastUsedAt` at most once per 5 minutes.
  - `interface RateLimiter { hit(key: string, limit: number, windowSeconds: number): { allowed: boolean; retryAfterSeconds: number } }`, `InMemoryRateLimiter` (fixed window, `Clock`, evicts expired keys).
  - `type RateLimitRule = { name: string; limit: number; windowSeconds: number; key: (c: { ip: string; body: unknown; tenant: TenantContext | null }) => string | null }`. Rejection → `AppError("RATE_LIMITED")` with a `Retry-After` header.
  - Pipeline order for `auth:"required"`: extract Bearer → verify JWT → resolve tenant with `tokenTenantId = claims.tid` → `assertLive` → `c.auth` set.

- [ ] **Step 1: Write failing tests:** JWT round-trip; an expired token → `TOKEN_EXPIRED`; a token signed with another secret, `alg:none`, wrong `aud`, or missing `tid` → `UNAUTHENTICATED`; `hashToken` is deterministic and 64 hex chars; `verifyPassword` is true for the right password and false for the wrong one; the limiter allows 5 hits, blocks the 6th with `retryAfterSeconds > 0`, and resets after the window.
- [ ] **Step 2: Integration guard tests** (probe route with `auth:"required"`): no header → 401 `UNAUTHENTICATED`; `Bearer garbage` → 401; a valid token whose session is revoked → 401; a valid token with tenant A plus `X-Client-Id: globex` → 403 `TENANT_MISMATCH`; a valid token with a DISABLED user → 401.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(auth): jwt, password hashing, session-checked auth guard, rate limiter`.

### Task 9: Register and login

**Files:**
- Create: `src/modules/auth/auth.schemas.ts`, `src/modules/auth/auth.repository.ts`, `src/modules/auth/auth.service.ts`, `src/modules/auth/auth.handlers.ts`, `src/modules/auth/user.dto.ts`, `src/app/api/v1/auth/register/route.ts`, `src/app/api/v1/auth/login/route.ts`
- Test: `tests/unit/modules/auth/login.test.ts`, `tests/integration/auth/register-login.shared.test.ts`, `tests/integration/auth/register-login.dedicated.test.ts`, `tests/helpers/fakes/auth-repository.fake.ts`

**Interfaces:**
- Consumes: Task 8 crypto/JWT; Task 6 `TenantContext`.
- Produces:
  - `type UserDto = { id; email; firstName: string | null; lastName: string | null; status; createdAt: string }` and `toUserDto(user): UserDto` (allowlist; never includes `passwordHash`, `failedLoginCount`, `lockedUntil`).
  - `type TokenPair = { accessToken; refreshToken; tokenType: "Bearer"; expiresIn: number }`
  - `interface AuthRepository` (every method takes `tenantId` first): `findUserByEmail(tenantId, email)`, `findUserById(tenantId, id)`, `createUser(tenantId, data)`, `recordFailedLogin(tenantId, userId, lockUntil: Date | null)`, `resetFailedLogins(tenantId, userId)`, `createSession(tenantId, userId, meta: {userAgent, ip}, expiresAt) → Session`, `createRefreshToken(sessionId, tokenHash, expiresAt)` (later tasks add more).
  - `AuthService` constructor `(repo: AuthRepository, cfg: AuthServiceConfig, clock: Clock)`; `register(ctx: TenantContext, input: {email, password, firstName?, lastName?}, meta) → {user: UserDto, tokens: TokenPair}`; `login(ctx, {email, password}, meta) → same`.
  - Rate limit rules: register 5/3600 s per IP; login 10/60 s per IP and 5/60 s per `ip|tenant|email`.

- [ ] **Step 1: Write failing unit tests** (fake repo, fake clock): a wrong password increments the failure count; the 10th failure sets `lockedUntil = now + 15 min`; while locked, the correct password → `INVALID_CREDENTIALS`; after the clock advances 15 min, the correct password succeeds and resets the counter; an unknown email calls `dummyVerify` and returns `INVALID_CREDENTIALS`; a DISABLED user → `INVALID_CREDENTIALS`.
- [ ] **Step 2: Write failing integration tests:**
  - register → 201, `data.user.email` normalized, `data.tokens.tokenType === "Bearer"`, body has no `passwordHash`;
  - **(Review Focus 2)** registering ` Bob@Example.com ` then `bob@example.com` in acme → 409 `EMAIL_ALREADY_REGISTERED`; the same email in globex → 201; login with `BOB@example.com` in acme → 200;
  - login with the same password but the other tenant's header → 401 (the user lives only in acme);
  - a 6th login attempt in a minute → 429 with `Retry-After`;
  - dedicated: register/login with no `X-Client-Id` → 201/200.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** Handlers map `isUniqueViolation` → `EMAIL_ALREADY_REGISTERED`. **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(auth): tenant-bound registration and login with lockout`.

### Task 10: Refresh rotation, logout, sessions, me

**Files:**
- Create: `src/app/api/v1/auth/{refresh,logout,me}/route.ts`, `src/app/api/v1/auth/sessions/route.ts`, `src/app/api/v1/auth/sessions/[id]/route.ts`
- Modify: `src/modules/auth/auth.{repository,service,handlers,schemas}.ts`
- Test: `tests/unit/modules/auth/refresh.test.ts`, `tests/integration/auth/sessions.shared.test.ts`

**Interfaces:**
- Produces on `AuthRepository`: `findRefreshTokenByHash(hash) → {token, session} | null`, `claimRefreshToken(id, now): Promise<boolean>` (`updateMany where id AND usedAt null`, returns `count === 1`), `revokeSession(tenantId, sessionId, reason, now)`, `revokeAllSessions(tenantId, userId, now, exceptSessionId?)`, `listActiveSessions(tenantId, userId, now)`, `findSession(tenantId, userId, sessionId)`.
- `AuthService.refresh(ctx, refreshToken, now) → TokenPair`; `logout(ctx, refreshToken)` (idempotent; unknown token → still 200); `me(ctx, auth) → {user, tenant:{slug,name}, session:{id, expiresAt}}`; `listSessions(ctx, auth) → SessionDto[]` with `current: boolean`; `revokeSession(ctx, auth, sessionId)` (another user's or tenant's session ID → `NOT_FOUND`).
- `/auth/refresh` and `/auth/logout` use `tenant:"required"`, `auth:"none"`; the token's `session.tenantId` must equal `ctx.tenantId`, otherwise `INVALID_REFRESH_TOKEN`. Refresh rate limit: 30/60 s per IP.

- [ ] **Step 1: Write failing unit tests:**
  - refresh returns a new pair; the old token's `usedAt` is set; the new token works once;
  - **(Review Focus 1)** using the same token twice within 10 s → the second call is `INVALID_REFRESH_TOKEN` and the session is NOT revoked (the new token from call 1 still works);
  - reusing an old token 11 s later → `INVALID_REFRESH_TOKEN` **and** the session is revoked with `revokedReason "refresh_token_reuse"` (the new token now fails too);
  - an expired session → `INVALID_REFRESH_TOKEN`; a token belonging to tenant B presented with ctx A → `INVALID_REFRESH_TOKEN`.
- [ ] **Step 2: Write failing integration tests:** login → refresh → the old access token still verifies until expiry, but after logout every access token for that session → 401 (session check); `GET /auth/sessions` after two logins lists 2 with exactly one `current: true`; `DELETE /auth/sessions/{otherId}` → that session's refresh fails; `DELETE` with a session ID from another user → 404; two `Promise.all` refresh calls with the same token → one 200 and one 401, and the session is still usable.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** `feat(auth): refresh rotation with reuse detection, logout, sessions, me`.

### Task 11: Forgot and reset password

**Files:**
- Create: `src/modules/mail/mailer.ts`, `src/modules/mail/console-mailer.ts`, `src/app/api/v1/auth/{forgot-password,reset-password}/route.ts`
- Modify: auth repository/service/handlers/schemas
- Test: `tests/unit/modules/auth/password-reset.test.ts`, `tests/integration/auth/password-reset.shared.test.ts`, `tests/helpers/fakes/recording-mailer.ts`

**Interfaces:**
- Produces: `interface Mailer { sendPasswordReset(input: { to: string; tenantName: string; resetLink: string; expiresAt: Date }): Promise<void> }`; `ConsoleMailer(logger, nodeEnv)` logs the link only when `nodeEnv !== "production"` (otherwise logs "reset email suppressed: no mail provider").
- Repo: `createResetToken(tenantId, userId, hash, expiresAt)`, `invalidateResetTokens(tenantId, userId, now)`, `findResetTokenByHash(hash)`, `consumeResetToken(id, now): Promise<boolean>` (atomic `usedAt IS NULL AND expiresAt > now`), `updatePassword(tenantId, userId, hash, now)`.
- `AuthService.forgotPassword(ctx, email)` → always resolves; `resetPassword(ctx, token, newPassword)`.
- Reset link = `${config.passwordReset.linkBaseUrl}?token=${token}`, read from the tenant's app config (Task 7 schema) via `AppConfigReader.getDocument(tenantId)` (defined here, reused in Task 14).
- Rate limits: forgot 3/900 s per `tenant|email`, 10/900 s per IP; reset 10/900 s per IP.

- [ ] **Step 1: Write failing tests:**
  - forgot for an unknown email → 202 with a body identical to the known-email case, and the mailer is not called;
  - forgot twice → only the latest token works;
  - reset with a valid token → 200; login with the new password works and the old password fails; all prior sessions' refresh tokens fail; `failedLoginCount` is 0 and `lockedUntil` is null;
  - the same reset token used twice → second call 400 `INVALID_RESET_TOKEN`; a token older than 30 min → 400;
  - a token issued in acme presented with the globex header → 400.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(auth): password reset with single-use expiring tokens`.

### Task 12: Users module

**Files:**
- Create: `src/modules/users/users.{schemas,repository,service,handlers}.ts`, `src/app/api/v1/users/me/route.ts`, `src/app/api/v1/users/me/password/route.ts`
- Test: `tests/unit/modules/users/users.service.test.ts`, `tests/integration/users/users.shared.test.ts`

**Interfaces:**
- Consumes: `toUserDto`, `AuthRepository.revokeAllSessions`, `hashPassword`/`verifyPassword`.
- Produces: `UsersService.getMe(ctx, auth) → UserDto`, `updateMe(ctx, auth, {firstName?: string(1..50) | null, lastName?: string(1..50) | null}) → UserDto` (strict schema: unknown keys such as `email`, `tenantId`, `status` → 400), `changePassword(ctx, auth, {currentPassword, newPassword}) → void` (wrong current → 401 `INVALID_CREDENTIALS`; new === current → 400 `VALIDATION_ERROR`; revokes all sessions except `auth.sessionId`).

- [ ] **Step 1: Write failing tests:** PATCH `{firstName:"Ann"}` → 200 with `firstName "Ann"`; PATCH `{tenantId:"…"}` → 400; changing the password keeps the current session working while another device's refresh → 401; GET without a token → 401.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Phase 4 checkpoint:** full suite + build; `docs/architecture.md` gains the "Authentication flow" section (design §5 sequence diagram + rotation rules); the security review note lists the residual register enumeration vector and per-instance rate limits. Commit `feat(users): profile and password management`. **Report and wait.**

---

## Phase 5 — Core modules

### Task 13: Settings module

**Files:**
- Create: `src/modules/settings/settings.{schemas,repository,service,handlers}.ts`, `src/app/api/v1/settings/route.ts`
- Test: `tests/unit/modules/settings/settings.service.test.ts`, `tests/integration/settings/settings.shared.test.ts`

**Interfaces:**
- Produces: `type SettingsDto = { theme: "SYSTEM"|"LIGHT"|"DARK"; language: string; notifications: { push: boolean; email: boolean; marketing: boolean } }`. The repository `upsertForUser(tenantId, userId, patch)` / `findForUser(tenantId, userId)`. GET with no row returns defaults derived from the tenant's `runtime.defaultTheme`/`defaultLanguage` and notifications `{push:true, email:true, marketing:false}` without writing a row. PATCH merges `notifications` shallowly; `language` must be in the tenant's `runtime.supportedLanguages`, else 400.

- [ ] **Step 1: Write failing tests:** GET on a fresh user → tenant defaults; PATCH `{theme:"DARK"}` → GET returns DARK while the other fields are unchanged; PATCH `{notifications:{marketing:true}}` keeps `push:true`; PATCH `{language:"xx"}` → 400; user A's PATCH is not visible to user B in the same tenant.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(settings): per-user tenant-scoped preferences`.

### Task 14: App config and feature flags

**Files:**
- Create: `src/modules/app-config/app-config.{repository,service,handlers}.ts`, `src/modules/app-config/feature-flags.ts`, `src/app/api/v1/app/config/route.ts`
- Modify: `src/modules/app-config/app-config.schemas.ts` (add `PublicAppConfigSchema`)
- Test: `tests/unit/modules/app-config/app-config.service.test.ts`, `tests/integration/app-config/app-config.shared.test.ts`, `tests/integration/app-config/app-config.dedicated.test.ts`

**Interfaces:**
- Consumes: `AppConfigReader.getDocument(tenantId)` from Task 11 (this task moves it into `app-config.repository.ts` if Task 11 placed it elsewhere, adds a 30 s cache, and makes a missing row → `INTERNAL_ERROR` logged as misconfiguration).
- Produces: `FeatureFlags.isEnabled(tenantId, key): Promise<boolean>` (unknown key → false), `FeatureFlags.all(tenantId): Promise<Record<string, boolean>>`; `requireFeature(c: RouteContext, key: string): Promise<void>` → `AppError("FEATURE_DISABLED")`; `AppConfigService.getPublic(ctx) → PublicAppConfig` built field-by-field (allowlist per design §9). Route: `auth:"none"`, `tenant:"required"`, response header `Cache-Control: public, max-age=60`.

- [ ] **Step 1: Write failing tests:**
  - the response for acme vs globex differs in `app.displayName` and `features`;
  - the response never contains the keys `passwordReset` or `linkBaseUrl`, nor the `JWT_SECRET`/`DATABASE_URL` values (assert with a deep string search over `JSON.stringify(body)`);
  - a config row stored with an extra `secretApiKey` property → not present in the response;
  - dedicated mode with no header → the configured tenant's config;
  - shared mode with no header → 400 `INVALID_CLIENT`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(app-config): public runtime config and feature flags`.

### Task 15: Catalog module (reference pattern)

**Files:**
- Create: `src/modules/catalog/catalog.{schemas,repository,service,handlers,openapi}.ts`, `src/app/api/v1/catalog/route.ts`, `src/app/api/v1/catalog/[id]/route.ts`
- Test: `tests/unit/modules/catalog/catalog.query.test.ts`, `tests/integration/catalog/catalog.shared.test.ts`, `tests/integration/catalog/catalog.dedicated.test.ts`

**Interfaces:**
- Produces: `CatalogListQuerySchema` (design §9: `page`, `pageSize`, `q` ≤ 100, `category` ≤ 50, `sort` enum, `.strict()`); `type CatalogItemDto = { id; title; description: string | null; category: string | null; imageUrl: string | null; createdAt: string; updatedAt: string }`; `CatalogRepository.list(tenantId, query) → {items, total}` (one `$transaction([findMany, count])`; search = `OR [title contains q insensitive, description contains q insensitive]`; secondary sort `id` for stable pages); `CatalogRepository.findById(tenantId, id)`; `CatalogService.list(ctx, query)`, `get(ctx, id)`. Both routes: `auth:"required"`, then `requireFeature(c, "catalog")`.

- [ ] **Step 1: Write failing tests:**
  - acme lists 25 items with `pageSize=10` → 10 items, `totalItems 25`, `totalPages 3`; none have a globex ID;
  - `q` matches case-insensitively; `category` filters; `sort=title:asc` is ordered;
  - **(Review Focus 5)** `page=99` → `data: []`, `totalItems 25`; `pageSize=1000` → 400; `sort=password:asc` → 400; an unknown query key → 400; `GET /catalog/not-a-uuid` → 404; `GET /catalog/{globexItemId}` with an acme token → 404 `NOT_FOUND`;
  - feature `catalog` disabled for acme → 404 `FEATURE_DISABLED`, while globex is unaffected;
  - dedicated: a list works with no header.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Phase 5 checkpoint:** full suite + build; write `docs/adding-a-module.md` using catalog as the worked example (files to create, the tenant-scoping rule, OpenAPI registration, tests to copy). Commit `feat(catalog): tenant-scoped catalog reference module`. **Report and wait.**

---

## Phase 6 — Production readiness

### Task 16: Isolation and security suites

**Files:**
- Create: `tests/integration/security/isolation.shared.test.ts`, `tests/integration/security/tokens.shared.test.ts`, `tests/integration/security/suspension.shared.test.ts`, `tests/integration/security/leakage.shared.test.ts`, `tests/integration/security/dedicated.test.ts`, `tests/helpers/actors.ts`

**Interfaces:**
- Produces: `tests/helpers/actors.ts` → `seedTwoTenants(): Promise<{acme, globex}>` (each with users `alice@shared.test` and `bob@shared.test`, deliberately colliding emails and catalog titles) and `loginAs(tenantSlug, email): Promise<{accessToken, refreshToken, userId}>`.

- [ ] **Step 1: Write the tests:**
  - **Isolation matrix:** for every authenticated endpoint (`auth/me`, `auth/sessions`, `users/me` GET/PATCH, `settings` GET/PATCH, `catalog`, `catalog/{id}`), an acme token + `X-Client-Id: globex` → 403 `TENANT_MISMATCH`, and an acme token alone only ever returns acme data (assert the IDs belong to acme rows in the DB).
  - acme alice's PATCH to `users/me` does not change globex alice.
  - A globex refresh token with the acme header → 401.
  - A JWT re-signed with `tid` swapped to globex but the original secret → 401 (the session check fails because `sid` belongs to an acme user).
  - **Tokens:** an expired access token (fake clock in the container) → 401 `TOKEN_EXPIRED`; a random refresh token → 401 `INVALID_REFRESH_TOKEN`.
  - **(Review Focus 3) Suspension:** login, `tenant set-status SUSPENDED` via `TenantAdminService`, call `cachedLookup.invalidate()` → `users/me` → 403 `TENANT_SUSPENDED`, refresh → 403, login → 403; the other tenant is unaffected.
  - **(Review Focus 2) Leakage:** for every endpoint response in the suite, `JSON.stringify(body)` contains none of `passwordHash`, `tokenHash`, `stack`, `prisma`, `$argon2`.
  - **Dedicated:** a token signed with the same secret but `tid` of a tenant row that is not the deployment tenant → 401.
- [ ] **Step 2: Run** both integration projects. Expected: PASS. Any failure is a defect in an earlier task — fix it there, not in the test.
- [ ] **Step 3: Commit** `test(security): tenant isolation and token security suites`.

### Task 17: OpenAPI contract

**Files:**
- Create: `src/core/openapi/registry.ts`, `src/core/openapi/components.ts`, `src/modules/*/*.openapi.ts` (auth, users, settings, app-config; catalog exists), `scripts/generate-openapi.ts`, `openapi/openapi.json`, `src/app/api/v1/openapi.json/route.ts`, `redocly.yaml`
- Test: `tests/unit/openapi/contract.test.ts`

**Interfaces:**
- Produces: `registry: OpenAPIRegistry`; `components.ts` registers the `SuccessEnvelope(schema)` / `PaginatedEnvelope(schema)` helpers, the `ErrorEnvelope` with the `code` enum of all `ErrorCode`s, the `bearerAuth` security scheme, and the `XClientId` header parameter (documented: required in shared mode for unauthenticated endpoints, optional otherwise). `buildOpenApiDocument(): OpenAPIObject` (OpenAPI 3.1.0, `info.version` from package.json, `servers: [{url: "/"}]`).

- [ ] **Step 1: Write failing tests:** every `route.ts` path under `src/app/api/v1` (discovered by globbing) has a matching path+method in `buildOpenApiDocument()` (excluding `openapi.json` itself); every operation declares 400/401/429/500 error responses where applicable; authenticated operations have `security: [{bearerAuth: []}]`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Each operation reuses the module's request/response Zod schemas (no duplicate definitions). `npm run openapi:generate` writes a pretty-printed, key-stable `openapi/openapi.json`. `openapi:lint` = `redocly lint openapi/openapi.json`. The route serves the committed JSON.
- [ ] **Step 4: Run** tests, `npm run openapi:generate`, `npm run openapi:lint` → PASS with no errors.
- [ ] **Step 5: Commit** `feat(openapi): generated API contract from zod schemas`.

### Task 18: Docker and CI

**Files:**
- Create: `Dockerfile`, `.dockerignore`
- Modify: `docker-compose.yml` (the `api` service under profile `app`), `.github/workflows/ci.yml` (created by Task 0)

- [ ] **Step 1: Dockerfile:** multi-stage on `node:24-slim` (glibc, for prebuilt argon2): deps (`npm ci`) → build (`prisma generate`, `next build`) → runtime (copies `.next/standalone`, `.next/static`, `prisma/`, generated client; runs as the non-root `node` user; `EXPOSE 3000`; `CMD ["node","server.js"]`). Migrations are a separate command: `docker run <image> npx prisma migrate deploy`.
- [ ] **Step 2: Verify:** `docker build -t whitelabel-api .` succeeds; `docker compose --profile app up` with shared env → `curl localhost:3000/api/v1/health` returns `"db":"up"`; with `DEPLOYMENT_MODE=dedicated` and an unknown slug the container exits non-zero with a config error in its logs.
- [ ] **Step 3: Extend `.github/workflows/ci.yml`** (keep the job id `ci`, its triggers, and the "Commit messages" step): add a `postgres:17` service to the job; steps: checkout → setup-node 24 with npm cache → `npm ci` → `npm run lint` → `npm run typecheck` → `npx prisma validate` → create the test DBs → `npx prisma migrate deploy` on each → `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` (shadow DB URL from env; fails if the schema has unmigrated changes) → `npm run test:unit` → `npm run test:int:shared` → `npm run test:int:dedicated` → `npm run openapi:generate && git diff --exit-code openapi/` → `npm run openapi:lint` → `npm run build`. Secrets in CI are throwaway literals (`JWT_SECRET` 32+ chars).
- [ ] **Step 4: Verify** locally with the same command sequence (or `act` if available). Expected: every step exits 0.
- [ ] **Step 5: Commit** `ci: docker image and GitHub Actions pipeline`.

### Task 19: Documentation and final review

**Files:**
- Create/complete: `README.md`, `docs/architecture.md`, `docs/api.md`, `docs/deployment-shared.md`, `docs/deployment-dedicated.md`, `docs/testing.md`; review `docs/environment.md`, `docs/local-development.md`, `docs/adding-a-module.md`

- [ ] **Step 1: Write the docs.** `architecture.md`: overview, folder structure, module boundaries, the ER diagram, auth + tenant flows (design §1–§8 diagrams), the RLS follow-up plan. `api.md`: envelope, error codes, pagination, the `X-Client-Id` rules, token lifecycle, the **Android client guidance** (send `X-Client-Id` always; single-flight refresh; on `TOKEN_EXPIRED` refresh once, then retry; on `INVALID_REFRESH_TOKEN` sign out), and how the Android repo consumes `openapi/openapi.json` (e.g. via a pinned git tag or release artifact). The deployment guides cover env vars, migrations per release, onboarding a tenant (shared) or provisioning a deployment (dedicated), secret rotation (rotating `JWT_SECRET` logs everyone out), DB TLS (`sslmode=require`), a least-privilege DB role (no superuser; migrations run with a separate owner role), and the rate limits being per instance (swap to Redis behind `RateLimiter`). `testing.md`: the three Vitest projects and how to run each.
- [ ] **Step 2: Verify** that every command in `README.md` and `docs/local-development.md` works from a fresh clone: `rm -rf node_modules .next && npm ci && docker compose up -d postgres && npm run db:deploy && npm run db:seed && npm run dev`, then `curl -H 'X-Client-Id: acme' localhost:3000/api/v1/app/config` → 200.
- [ ] **Step 3:** Run the full suite + build one final time. Expected: all green.
- [ ] **Step 4: Commit** `docs: architecture, API, deployment and testing guides`. Final report: completed work, residual risks (register enumeration, per-instance rate limits, RLS deferred, console mailer), next steps.
