# Backend Starter and Shared Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `backend-api` into the documented backend starter with a stable, CI-guarded shared contract (spec examples, shared flag keys, `/api/v1/x/` app namespace), then add account deletion.

**Architecture:** PR 1 (`docs/starter-contract`, Tasks 1–5) adds starter-level flag keys, deterministic examples in the generated OpenAPI spec computed from real mappers, a namespace guard test, an `oasdiff` breaking-change CI step, and the positioning, creation-guide and contract-policy docs. PR 2 (`feat/delete-account`, Task 6) adds `DELETE /api/v1/users/me`. PR 2 branches from `main` after PR 1 merges.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, Zod 4, `@asteasolutions/zod-to-openapi` 9, Vitest, GitHub Actions, `oasdiff` (GitHub Action, pinned).

**Spec:** `docs/superpowers/specs/2026-11-10-backend-starter-contract-design.md`

## Global Constraints

- Every change is backward compatible with the current `openapi/openapi.json`. Nothing is removed, renamed, retyped or made required. The `oasdiff` breaking check must pass on both PRs.
- `/api/v1` is extend-only. The starter never defines routes under `/api/v1/x/`; that namespace is for app backends.
- Starter flag keys are exactly `catalog` and `profile`. `features` stays a key → boolean map, and unknown keys are off. `profile` is client-side only: no server gating of `/users/me`.
- The generated spec stays byte-identical on regeneration (existing test). Examples use fixed UUIDs, dates and request IDs, never `Date.now()` or random values.
- Spec generation (`scripts/generate-openapi.ts`) never imports from `tests/` and needs no database, fakes or clock.
- The npm package name and the JWT issuer and audience defaults are unchanged.
- Local dev is unchanged: shared mode, with tenants `acme` and `globex` in the seed.
- No edits to `../android-starter-kit`. Android follow-ups go in the PR descriptions (spec §8).
- Git: follow `CLAUDE.md`. Use Conventional Commits with headers ≤ 72 chars and the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer; hooks must pass; never `--no-verify`. Open a PR per phase; the owner merges.
- Shell: start every command with `export PATH="/opt/homebrew/opt/node@24/bin:$PATH";`. Postgres runs in Docker Desktop.

## Review Focus

1. **A dev database seeded before this change** has `acme` and `globex` without a `profile` flag. Running `npm run db:seed` must add it without duplicating anything. Test in Task 1.
2. **A DTO gains a field later but its example isn't updated.** The examples test must fail, because each example is compared with the mapper's real output for the same fixture, not only parsed. Test in Task 2.
3. **A starter developer adds a route under `/api/v1/x/`, or adds a route without listing it.** The namespace test fails with the offending `METHOD path`. Test in Task 3.
4. **The breaking-change step on a PR whose base has no `openapi/openapi.json`** (for example a new app backend's first PR) passes with a notice instead of erroring. It is verified in Task 4.
5. **`DELETE /users/me` with no body, the wrong content type, or a wrong password** never deletes anything: 400/400/401. After a real deletion, the old access and refresh tokens are rejected. Tests in Task 6.

---

## PR 1 — branch `docs/starter-contract` (already exists; the design doc is committed on it)

### Task 1: Starter feature-flag keys

**Files:**
- Create: `src/modules/app-config/feature-keys.ts`
- Modify: `src/core/tenant/tenant-admin.service.ts` (`create`), `prisma/seed-data.ts` (`seed`)
- Test: `tests/integration/tenant/tenant-admin.test.ts`, `tests/integration/tenant/seed.test.ts` (or the existing seed test file; extend it)

**Interfaces:**
- Produces: `export const STARTER_FEATURE_KEYS = ["catalog", "profile"] as const;` and `export type StarterFeatureKey = (typeof STARTER_FEATURE_KEYS)[number];`

- [ ] **Step 1: Write the failing tests:**
  - `create` without config → the tenant has exactly flags `{catalog: true, profile: true}`.
  - The seed run twice in shared mode → each of `acme` and `globex` has `catalog` and `profile` both `true`, and the `feature_flags` row count is 4.
  - **(Review Focus 1)** Create `acme` with only a `catalog` flag (simulating an old seed), then run `seed()` → `acme` has `profile: true` and other counts are unchanged.
- [ ] **Step 2: Run** `npm run test:int:shared -- tenant` → FAIL.
- [ ] **Step 3: Implement.**
  - `create` loops over `STARTER_FEATURE_KEYS`.
  - `seed()`, after creating or skipping each tenant, upserts every key with `enabled: true` through `TenantAdminService.setFeature`. It never flips a flag that exists and is `false`: create missing keys only, using `createMany({skipDuplicates: true})` or equivalent.
- [ ] **Step 4: Run** `npm run test:int:shared` and `npm run test:int:dedicated` → PASS.
- [ ] **Step 5: Commit** `feat(app-config): seed starter flag keys catalog and profile`.

### Task 2: Deterministic examples in the OpenAPI spec

**Files:**
- Create: `src/core/openapi/fixtures.ts`; `src/modules/{auth,users,settings,catalog,app-config}/*.examples.ts`; `src/core/openapi/system.examples.ts` (health + error envelopes)
- Modify: `src/core/openapi/components.ts` (`OperationDef`, `registerOperation`, error responses); every `src/modules/*/*.openapi.ts` and `src/core/openapi/system.openapi.ts`; `src/modules/settings/settings.service.ts` and `src/modules/app-config/app-config.service.ts` (extract the pure builders); `openapi/openapi.json` (regenerated)
- Test: `tests/unit/openapi/examples.test.ts`; extend `tests/unit/openapi/dto-contract.test.ts`

**Interfaces:**
- Produces in `fixtures.ts`:
  - `FIXTURE_REQUEST_ID`: a fixed UUID string;
  - `FIXTURE_NOW`: `new Date("2026-01-01T00:00:00.000Z")`;
  - fixed UUID constants, e.g. `FIXTURE_IDS = { tenant, user, session, catalogItem, … }`;
  - `exampleEnvelope<T>(data: T, opts?: { pagination?: Pagination }): { success: true; data: T; meta: { requestId: string; pagination?: Pagination } }`;
  - `exampleError(code: ErrorCode, message: string, details?: {path: string; message: string}[])`, returning the error envelope shape.
- Produces in `OperationDef`:
  - each `success[]` entry gains a **required** `example: unknown` (the full envelope);
  - the op gains `bodyExample?: unknown`, which is required when `body` is set (enforced at registration: throw if missing);
  - `registerOperation` emits these as `content["application/json"].example`.
- Produces pure builders, which the services call so behaviour is unchanged:
  - `buildSettingsDto(stored: {theme; language; notificationPreferences: unknown} | null, runtime: {defaultTheme; defaultLanguage}): SettingsDto` exported from `settings.service.ts`;
  - `buildPublicAppConfig(doc: AppConfigDocument, features: Record<string, boolean>, tenant: {slug; name}): PublicAppConfig` exported from `app-config.service.ts`.
- Each module's `*.examples.ts` exports its fixture inputs and the example values computed from the real pure mappers and builders (`toUserDto`, `toSessionDto`, the catalog mapper, `buildSettingsDto`, `buildPublicAppConfig`), plus hand-written request body examples.

- [ ] **Step 1: Write the failing tests in `examples.test.ts`:**
  - every registered operation (iterate the `operations` list in `components.ts`) has an `example` on each success response and a `bodyExample` when it has a body;
  - each success example `parse`s against that response's schema;
  - each `bodyExample` `parse`s against the op's `body` schema, which is the same object the route uses;
  - the generated document contains `example` under each operation's success `application/json` content;
  - error responses for 400, 401 and 429 include examples with codes `VALIDATION_ERROR` (with `details`), `UNAUTHENTICATED` and `RATE_LIMITED`, each parsing against `ErrorEnvelope`.
- [ ] **Step 2: Extend `dto-contract.test.ts` (Review Focus 2):** for each service whose example is fixture-based, the real service output on the same fixture (using the existing fakes) `toEqual`s the example's `data`. This covers settings defaults and updated values, the app config, `me`, sessions and the catalog page. Example: `expect((await settingsService.get(ctx, auth)).valueOf()).toEqual(settingsExamples.defaults.data)` with the fake repo returning `settingsFixtures.stored`.
- [ ] **Step 3: Run** `npm run test:unit -- openapi` → FAIL.
- [ ] **Step 4: Implement.**
  - Extract the builders, with no behaviour change; the existing settings and app-config tests stay green.
  - Add the fixtures and the examples modules, and wire `example` and `bodyExample` into every registration.
  - Run `npm run openapi:generate`.
- [ ] **Step 5: Run** `npm run test:unit`, `npm run test:int:shared`, `npm run openapi:generate` (then `git diff --stat openapi/` shows only additions; rerun and confirm no further diff), and `npm run openapi:lint` → PASS.
- [ ] **Step 6: Commit** `feat(openapi): deterministic examples from real mappers`.

### Task 3: Namespace guard

**Files:**
- Create: `src/core/contract/starter-routes.ts`
- Test: `tests/unit/contract/namespace.test.ts`

**Interfaces:**
- Consumes: `discoverRoutes()` from `tests/helpers/routes.ts` (`RouteInfo.key` is `METHOD /api/v1/path`, with `[id]` written as `{id}`).
- Produces:
  - `export const STARTER_ROUTES: readonly string[]`: every current route key, sorted (e.g. `"GET /api/v1/health"`, `"GET /api/v1/openapi.json"`, `"DELETE /api/v1/auth/sessions/{id}"`, …);
  - `export const APP_NAMESPACE = "/api/v1/x/";`.

- [ ] **Step 1: Write the failing tests:**
  - every discovered route key is in `STARTER_ROUTES` or has a path starting with `APP_NAMESPACE`. The failure message lists the unknown keys and says "add starter routes to STARTER_ROUTES; app routes belong under /api/v1/x/".
  - every `STARTER_ROUTES` entry is discovered (no stale entries).
  - no `STARTER_ROUTES` entry starts with `APP_NAMESPACE`.
  - **(Review Focus 3)** the check function, extracted as `checkRoutes(discovered: string[], starter: readonly string[]): string[]` returning problems, is unit-tested with synthetic inputs: an unlisted `POST /api/v1/foo`, a listed `GET /api/v1/x/bar`, a stale entry, and an allowed `GET /api/v1/x/notes`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Generate the list once from `discoverRoutes()` output, then commit it as a literal.
- [ ] **Step 4: Run** `npm run test:unit` → PASS.
- [ ] **Step 5: Commit** `test(contract): guard starter routes and the x/ namespace`.

### Task 4: Breaking-change CI check

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add a step to job `ci`** (keep the job id, triggers, concurrency and every existing step), placed after "OpenAPI contract is up to date":
  - It runs only when `github.event_name == 'pull_request'`.
  - A shell step writes `/tmp/base-openapi.json` via `git show "origin/${{ github.base_ref }}:openapi/openapi.json"`. If that fails, it prints `::notice::base has no openapi/openapi.json; skipping breaking-change check` and sets an output `skip=true`.
  - When it isn't skipped, the next step runs the `oasdiff` breaking action pinned to an exact version at least 2 weeks old, with `base: /tmp/base-openapi.json`, `revision: openapi/openapi.json`, and failing on `ERR`-level breaking changes.
- [ ] **Step 2: Verify locally with the oasdiff Docker image** (same version), from the repo root:
  - (a) base = `git show main:openapi/openapi.json`, revision = the working copy → exit 0;
  - (b) a temp copy with one `ErrorEnvelope` `code` enum value removed → non-zero exit, with the enum removal reported;
  - (c) a temp copy with a response field removed from `User` → non-zero exit.

  Paste outputs into the report. Delete the temp files.
- [ ] **Step 3: Verify the skip path** by running the shell part with a nonexistent ref → the notice is printed and the exit is 0 **(Review Focus 4)**.
- [ ] **Step 4: Commit** `ci: fail pull requests that break the API contract`.

### Task 5: Positioning and contract docs, and the PR 1 checkpoint

**Files:**
- Modify: `README.md`, `docs/architecture.md`, `docs/deployment-shared.md`, `docs/api.md`, `docs/adding-a-module.md`
- Create: `docs/creating-a-backend.md`, `docs/contract.md`

- [ ] **Step 1: Write the docs exactly as spec §1–§5:**
  - **README:** the starter role, the two modes, and links to `creating-a-backend.md` and `contract.md`. Remove the "white-label" wording.
  - **architecture.md:** a "Role of this repo" section with the spec §1 mermaid diagram.
  - **deployment-shared.md:** a "When to choose shared mode" section.
  - **creating-a-backend.md:** sections 1–6 of spec §2, including the exact git commands, the Android `app.properties` mapping table, and the generated-file merge rule.
  - **contract.md:**
    - the spec §3 table and tag rules;
    - the `x/` namespace;
    - deprecation;
    - the starter flag keys from spec §4;
    - the CI guards from spec §5;
    - the lists of what Android depends on: error codes by exact name (unknown → `UNKNOWN`), the optional `X-Client-Id` and its per-mode behaviour, and that the User-Agent is never parsed.
  - **api.md:** the feature-flags section (keys, resolution, `profile` client-side only), and response examples now in the spec.
  - **adding-a-module.md:** app routes under `src/app/api/v1/x/<feature>/`, starter routes must be added to `STARTER_ROUTES`, and every operation needs examples.
- [ ] **Step 2: Verify:**
  - every relative link in the changed docs resolves (`grep -o '](\./[^)]*\|](\.\./[^)]*' …` then `test -e`);
  - every command in `creating-a-backend.md` §1 works in a throwaway clone in `/tmp`: clone this repo, add a fake empty origin (`git init --bare /tmp/fake-origin.git`), push. Delete it afterwards.
- [ ] **Step 3: Run the full gate:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run openapi:generate` (no diff), `npm run openapi:lint` → all green.
- [ ] **Step 4: Commit** `docs: backend starter positioning, creation guide and contract policy`.
- [ ] **Step 5: Checkpoint:** push `docs/starter-contract` and open the PR from `.github/pull_request_template.md`. Its description includes the "Android follow-ups" section (spec §8) and the post-merge owner step "tag `v1.0.0`". Wait for CI green and the owner's merge. **Do not tag.**

---

## PR 2 — branch `feat/delete-account`, cut from `main` after PR 1 merges

### Task 6: Delete account

**Files:**
- Modify: `src/modules/users/{users.schemas,users.repository,users.service,users.handlers,users.openapi,users.examples}.ts`, `src/core/contract/starter-routes.ts`, `tests/helpers/fakes/users-repository.fake.ts`, `tests/integration/security/{isolation,leakage}.test.ts`, `openapi/openapi.json`, `docs/{api,contract,architecture}.md`
- Modify: `src/app/api/v1/users/me/route.ts` gains a `DELETE` export (same file as GET/PATCH)
- Test: `tests/unit/modules/users/users.service.test.ts`, `tests/integration/users/delete-account.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`; `route()`; `ipKey` is not needed. Also the existing `UsersRepository` pattern (tenantId first).
- Produces:
  - `deleteMeBody = z.object({ password: z.string().min(1).max(128) }).strict()`;
  - `UsersRepository.deleteUser(tenantId: string, id: string): Promise<void>` (deletes via the `tenantId_id` compound key);
  - `UsersService.deleteMe(ctx: TenantContext, auth: AuthContext, input: { password: string }): Promise<void>`;
  - `deleteAccountRateLimit = [{ name: "delete-account", limit: 5, windowSeconds: 900, key: ({tenant, auth}) => `${tenant!.tenantId}|${auth!.userId}` }]`;
  - operationId `usersDeleteMe`; route key `"DELETE /api/v1/users/me"` added to `STARTER_ROUTES`.

- [ ] **Step 1: Write the failing unit tests:**
  - a wrong password → `AppError("INVALID_CREDENTIALS")` and `deleteUser` not called;
  - the correct password → `deleteUser(ctx.tenantId, auth.userId)` called once;
  - a user not found → `NOT_FOUND`.
- [ ] **Step 2: Write the failing integration tests:**
  - After `DELETE /users/me` with `{password}` → 200 `{}`, and the DB has no user row and no sessions, refresh tokens, reset tokens or settings for that user. The other users of the same tenant and of globex are intact.
  - **(Review Focus 5)** the old access token → 401 `UNAUTHENTICATED`; the old refresh token → 401 `INVALID_REFRESH_TOKEN`; registering the same email again → 201.
  - **(Review Focus 5)** no body → 400; `Content-Type: text/plain` → 400; wrong password → 401 `INVALID_CREDENTIALS`. In all three the user still exists.
  - The 6th attempt in 15 min → 429.
  - Add an isolation-matrix row: TENANT_MISMATCH deletes nothing, and acme alice deleting leaves globex alice intact. The completeness test forces the row.
  - Add a leakage row: the response contains no forbidden strings.
- [ ] **Step 3: Run** → FAIL.
- [ ] **Step 4: Implement.**
  - Verify with Argon2 before deleting.
  - A single `delete` relies on the existing cascades; don't hand-delete child rows.
  - Register the operation with request and response examples per Task 2's rules. The description: "Permanently deletes the account and all its sessions and settings. Confirm with the current password."
  - Add the route key to `STARTER_ROUTES`, then regenerate the spec.
- [ ] **Step 5: Docs.**
  - `api.md`: the endpoint, and Android guidance (confirm with password, then clear local tokens and go to the auth graph).
  - `contract.md`: a "v1 additions" entry (v1.1.0).
  - `architecture.md`: the account lifecycle note.
- [ ] **Step 6: Run the full gate** (as Task 5 Step 3). Also run the oasdiff breaking check locally against `main`'s spec → exit 0 (the change is purely additive).
- [ ] **Step 7: Commit** `feat(users): delete account with password confirmation`.
- [ ] **Step 8: Checkpoint:** push and open the PR, including the "Android follow-ups" item 3 (the delete-account UI) and the post-merge owner step "tag `v1.1.0`". Wait for the owner's merge.
