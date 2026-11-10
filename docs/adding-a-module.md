# Adding a module

The catalog module (`src/modules/catalog`) is the reference. Copy it, rename, adjust.

**Starter module or app module?** In an app's backend (see [creating-a-backend.md](./creating-a-backend.md)),
every new route lives under **`src/app/api/v1/x/<feature>/`**, so it is served at `/api/v1/x/<feature>/…`
and can never collide with a starter route. In the starter itself, routes never go under `x/`, and every
new starter route must be added to `STARTER_ROUTES` in `src/core/contract/starter-routes.ts` (the
namespace test fails otherwise). Starter routes are part of the shared contract; read
[contract.md](./contract.md) first.

## File layout

```
src/modules/<name>/
  <name>.schemas.ts      Zod input schemas (query/body) + inferred types
  <name>.dto.ts          Response DTO type + allowlist mapper
  <name>.repository.ts   Repository interface + Prisma implementation
  <name>.service.ts      Business logic; takes a repository, returns DTOs
  <name>.handlers.ts     Thin HTTP layer (feature gate, rate-limit rules, envelope)
src/modules/<name>/<name>.examples.ts      Fixed fixtures + spec examples built by the real mappers
src/modules/<name>/<name>.openapi.ts       OpenAPI registration (see below)
src/app/api/v1/<name>/route.ts          route({...}) wiring only (app backends: src/app/api/v1/x/<name>/)
src/app/api/v1/<name>/[id]/route.ts
src/core/container.ts                   construct the service, add it to `services`
tests/helpers/fakes/<name>-repository.fake.ts   in-memory repository for unit tests
tests/unit/modules/<name>/              schema, DTO and service tests (fake repo)
tests/integration/<name>/<name>.test.ts            shared-mode project
tests/integration/<name>/<name>.dedicated.test.ts  dedicated-mode project (tenant acme, no header)
```

Naming convention: any `*.test.ts` under `tests/integration` runs in the shared project;
`*.dedicated.test.ts` runs in the dedicated project (`DEDICATED_TENANT_SLUG=acme`).

OpenAPI registration: see the [OpenAPI](#openapi) section.

## Schemas

Query/body schemas are `.strict()` (unknown keys are a 400). Reuse `zPagination` from
`src/core/validation/common.ts`.

```ts
export const CatalogListQuerySchema = zPagination
  .extend({
    q: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v ? v : undefined)),
    category: z.string().min(1).max(50).optional(),
    sort: z.enum(CATALOG_SORTS).default("createdAt:desc"),
  })
  .strict();
export type CatalogListQuery = z.infer<typeof CatalogListQuerySchema>;
```

## Tenant scoping (the rule)

- Every repository method takes `tenantId` as its first argument and puts it in the `where`.
- Look up by id with `findFirst({ where: { id, tenantId } })`, never `findUnique({ where: { id } })`.
  A row of another tenant is then simply "not found" (404 `NOT_FOUND`), never 403.
- `tenantId` comes from `c.tenant`, which `route()` resolves centrally (shared mode: the `X-Client-Id`
  header checked against the token's tenant; dedicated mode: deployment config), never from the
  body, query or path.
  Never trust an id from input for ownership.

```ts
findById(tenantId: string, id: string): Promise<CatalogItem | null> {
  return this.prisma.catalogItem.findFirst({ where: { id, tenantId } });
}
```

Services take `ctx: TenantContext` (and `auth: AuthContext` for per-user data) and pass
`ctx.tenantId` down. Use one `$transaction([findMany, count])` for paginated lists and a unique
secondary sort (`id`) so pages are stable.

## DTO allowlist

Map rows to DTOs field by field. Never spread a row, so new columns (and `tenantId`) cannot leak.
Dates become ISO strings; nulls are preserved.

```ts
export function toCatalogItemDto(item: CatalogItemLike): CatalogItemDto {
  return { id: item.id, title: item.title, /* ... */ createdAt: item.createdAt.toISOString() };
}
```

## Handlers, routes, container

```ts
// handlers
export async function listCatalogHandler(c: Ctx<CatalogListQuery>): Promise<Response> {
  await requireFeature(c, "catalog");            // feature flag gate, first line
  const { items, pagination } = await c.container.services.catalog.list(c.tenant, c.query);
  return ok(items, { requestId: c.requestId, pagination });
}

// src/app/api/v1/catalog/route.ts
export const GET = route({
  auth: "required",
  tenant: "required",
  query: CatalogListQuerySchema,
  handler: listCatalogHandler,
});

// src/core/container.ts
catalog: new CatalogService(new PrismaCatalogRepository(prisma)),
```

Path ids: declare `params: z.object({ id: z.string() })` and check `isUuid(c.params.id)`
(`src/core/validation/common.ts`); a malformed id throws `AppError("NOT_FOUND")`, not a 400.

## Feature flags

`await requireFeature(c, "<key>")` throws `FEATURE_DISABLED` (404) when the tenant's flag is off.
Flags are cached for 30 s; in tests call `getContainer().featureFlags.invalidate()` after
`TenantAdminService.setFeature(slug, key, enabled)`.

## Rate limits

Add `rateLimit: [...]` to `route()`; rules run after input parsing, before the handler. Use `ipKey`
for IP rules (it returns null when the IP is unknown, skipping the rule) and an account key for
per-user rules.

```ts
{ name: "login-ip", limit: 10, windowSeconds: 60, key: ({ ip }) => ipKey(ip) },
{
  name: "password-check", limit: 5, windowSeconds: 900,
  key: ({ tenant, auth }) => (tenant && auth ? `${tenant.tenantId}|${auth.userId}` : null),
},
```

Exceeding a limit yields 429 `RATE_LIMITED` with `retry-after`.

## Error conventions

Throw `AppError(code)` with a code from `src/core/errors/codes.ts`; never build error responses by
hand. Zod failures become 400 `VALIDATION_ERROR` automatically. Use `NOT_FOUND` for missing or
foreign rows, `FEATURE_DISABLED` for gated modules. Anything else is a 500 with a generic message.
Add a new code to `ERROR_STATUS` only if no existing one fits.

## OpenAPI

The Android apps generate their client from the committed `openapi/openapi.json`, so every route must
be in it. Nothing is written by hand: the spec is built from the Zod schemas the routes use.

1. **Response schema** next to the DTO: `<x>.dto.ts` exports `XDtoSchema` (Zod) and
   `export type XDto = z.infer<typeof XDtoSchema>`. Dates are `z.iso.datetime()`.
2. **`src/modules/<x>/<x>.openapi.ts`**: register the DTO and envelopes, then each operation.

   ```ts
   const Item = registry.register("CatalogItemDto", CatalogItemDtoSchema);

   registerOperation({
     method: "get",
     path: "/api/v1/catalog/{id}",
     operationId: "catalogGet", // stable camelCase: the Android method name
     tag: TAGS.catalog, // add a new tag to TAGS and TAG_DESCRIPTIONS
     summary: "Get one catalog item",
     auth: "required", // same values as in route.ts
     tenant: "required",
     params: zIdParams, // the SAME schema objects the route uses
     success: [
       {
         status: 200,
         description: "The item",
         schema: SuccessEnvelope("CatalogItemEnvelope", Item),
         example: catalogExamples.item, // from catalog.examples.ts
       },
     ],
   });
   ```

   Every success response needs an `example` (the full envelope) and every operation with a `body`
   needs a `bodyExample` (registration throws without one). Build them in `<x>.examples.ts` from fixed
   fixtures (`src/core/openapi/fixtures.ts` has `FIXTURE_IDS`, `FIXTURE_NOW`, `exampleEnvelope` and
   `exampleError`) by calling the module's **real** mapper, never by writing the DTO out by hand, and
   never with the clock or random values (the spec must regenerate byte-identically). If the DTO comes
   from a service, extract its pure "build the DTO" step into an exported function and use that. Request
   body examples are hand-written. The 400, 401 and 429 error examples are derived; a public operation
   that can return 401 sets `errorExamples: { 401: ... }`.

   Use `SuccessEnvelope(name, dataSchema)` for single values and `PaginatedEnvelope(name, itemSchema)`
   for lists. `tests/unit/openapi/contract.test.ts` requires `auth`, `tenant`, `body`, `query`,
   `params` and `rateLimit` to be identical to the route's (every `route()` handler carries a `.meta`
   copy of its config), so import the schema and rate-limit objects instead of redefining them.

3. **Error responses are derived**, not written: 500 always; 400 with a body, query, params or a
   required tenant; 401 with `auth: "required"`; 403 with a required tenant; 404 with `params`; 413
   with a body; 429 with `rateLimit` (plus `Retry-After`). If a handler can return another status
   (e.g. 409 `EMAIL_ALREADY_REGISTERED`, 404 `FEATURE_DISABLED`), list it in `extraErrors` **and** in
   `EXTRA_ERRORS` in the contract test.

4. Add `import "@/modules/<x>/<x>.openapi";` to `src/core/openapi/document.ts`.

5. Add a row to `tests/unit/openapi/dto-contract.test.ts`: run the real mapper/service output through
   `ok()` and parse it with your envelope, so the spec cannot drift from the DTO. Also add a case to its
   "spec examples equal the real service output" block: feed the module's fixtures to the real service
   (with its fake repository) and `toEqual` the example's `data`.

6. `npm run openapi:generate`, then `npm run openapi:lint`; commit the regenerated
   `openapi/openapi.json` (CI fails on a diff; a unit test fails when it is stale).

Gotcha: Zod 4 schemas created before `extendZodWithOpenApi()` lack `.openapi()`. The registry module
runs it, so a `*.openapi.ts` file must import `@/core/openapi/registry` (or `components`) before
anything that builds schemas, and tests that import schemas first must import the registry first.

## Tests to copy

- Unit: `tests/unit/modules/catalog/` (schema parsing, DTO allowlist, service with
  `FakeCatalogRepository`, including a cross-tenant case).
- Integration: `tests/integration/catalog/catalog.test.ts` (two seeded tenants: pagination, search,
  filters, validation 400s, 404 for foreign ids, feature flag off) and `catalog.dedicated.test.ts`
  (works with no client header).
- Isolation matrix: add a row for every new tenant-required operation to `ROWS` in
  `tests/integration/security/isolation.test.ts` (and a `CROSS_ROWS` entry when it takes another
  tenant's id). A completeness test discovers every route under `src/app/api/v1` and fails if a
  tenant-required route has no entry. Only public routes (no access token) may go in
  `PUBLIC_TENANT_ROUTES` instead, with a comment saying where their tenant scoping is tested.
