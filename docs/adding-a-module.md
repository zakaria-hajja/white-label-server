# Adding a module

The catalog module (`src/modules/catalog`) is the reference. Copy it, rename, adjust.

## File layout

```
src/modules/<name>/
  <name>.schemas.ts      Zod input schemas (query/body) + inferred types
  <name>.dto.ts          Response DTO type + allowlist mapper
  <name>.repository.ts   Repository interface + Prisma implementation
  <name>.service.ts      Business logic; takes a repository, returns DTOs
  <name>.handlers.ts     Thin HTTP layer (feature gate, rate-limit rules, envelope)
src/app/api/v1/<name>/route.ts          route({...}) wiring only
src/app/api/v1/<name>/[id]/route.ts
src/core/container.ts                   construct the service, add it to `services`
tests/helpers/fakes/<name>-repository.fake.ts   in-memory repository for unit tests
tests/unit/modules/<name>/              schema, DTO and service tests (fake repo)
tests/integration/<name>/<name>.test.ts            shared-mode project
tests/integration/<name>/<name>.dedicated.test.ts  dedicated-mode project (tenant acme, no header)
```

Naming convention: any `*.test.ts` under `tests/integration` runs in the shared project;
`*.dedicated.test.ts` runs in the dedicated project (`DEDICATED_TENANT_SLUG=acme`).

OpenAPI registration: see Task 17 / docs once available.

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
- `tenantId` comes from `c.tenant` (resolved from the token), never from the body, query or path.
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
  name: "change-password-account", limit: 5, windowSeconds: 900,
  key: ({ tenant, auth }) => (tenant && auth ? `${tenant.tenantId}|${auth.userId}` : null),
},
```

Exceeding a limit yields 429 `RATE_LIMITED` with `retry-after`.

## Error conventions

Throw `AppError(code)` with a code from `src/core/errors/codes.ts`; never build error responses by
hand. Zod failures become 400 `VALIDATION_ERROR` automatically. Use `NOT_FOUND` for missing or
foreign rows, `FEATURE_DISABLED` for gated modules. Anything else is a 500 with a generic message.
Add a new code to `ERROR_STATUS` only if no existing one fits.

## Tests to copy

- Unit: `tests/unit/modules/catalog/` (schema parsing, DTO allowlist, service with
  `FakeCatalogRepository`, including a cross-tenant case).
- Integration: `tests/integration/catalog/catalog.test.ts` (two seeded tenants: pagination, search,
  filters, validation 400s, 404 for foreign ids, feature flag off) and `catalog.dedicated.test.ts`
  (works with no client header).
