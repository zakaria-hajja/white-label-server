import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRoutes as discoverAll, type RouteInfo } from "../../helpers/routes";
import { ERROR_STATUS } from "@/core/errors/codes";
import { buildOpenApiDocument } from "@/core/openapi/document";
import { errorStatuses } from "@/core/openapi/components";
import { operations } from "@/core/openapi/registry";

// Routes that are deliberately not part of the contract.
const EXCLUDED = new Set(["/api/v1/openapi.json"]);

/**
 * Statuses an operation returns beyond what its route config implies. Keep in sync with the
 * handlers/services; anything else is derived from the route's own config.
 */
const EXTRA_ERRORS: Record<string, number[]> = {
  "POST /api/v1/auth/register": [409], // EMAIL_ALREADY_REGISTERED
  "POST /api/v1/auth/login": [401], // INVALID_CREDENTIALS
  "POST /api/v1/auth/refresh": [401], // INVALID_REFRESH_TOKEN
  "GET /api/v1/catalog": [404], // FEATURE_DISABLED
};

const discoverRoutes = () => discoverAll(EXCLUDED);

const doc = buildOpenApiDocument();
type Operation = {
  operationId: string;
  security?: Record<string, unknown>[];
  parameters?: { $ref?: string; name?: string; in?: string }[];
  requestBody?: unknown;
  responses: Record<
    string,
    { content?: Record<string, { schema: { $ref?: string } }>; headers?: Record<string, unknown> }
  >;
};
const paths = doc.paths as unknown as Record<string, Record<string, Operation>>;
const opFor = (r: RouteInfo) => paths[r.path]?.[r.method.toLowerCase()];

describe("OpenAPI contract", () => {
  it("is OpenAPI 3.1 with version from package.json", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("0.1.0");
    expect(doc.servers).toEqual([{ url: "/" }]);
  });

  it("has an operation for every route.ts method, and no operation without a route", async () => {
    const routes = await discoverRoutes();
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) expect(opFor(r), `missing ${r.key}`).toBeDefined();
    const documented = Object.entries(paths).flatMap(([p, ms]) =>
      Object.keys(ms).map((m) => `${m.toUpperCase()} ${p}`),
    );
    expect(documented.sort()).toEqual(routes.map((r) => r.key).sort());
  });

  it("uses unique camelCase operation ids", () => {
    const ids = Object.values(paths).flatMap((ms) => Object.values(ms).map((o) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it("mirrors each route's real config (auth, tenant, schemas, rate limits)", async () => {
    for (const r of await discoverRoutes()) {
      const def = operations.find((o) => o.method === r.method.toLowerCase() && o.path === r.path);
      const meta = r.handler.meta;
      expect(def, r.key).toBeDefined();
      expect(def?.auth, `${r.key} auth`).toBe(meta.auth);
      expect(def?.tenant, `${r.key} tenant`).toBe(meta.tenant);
      // Identity: the operation reuses the very schema objects the route validates with.
      expect(def?.body, `${r.key} body`).toBe(meta.body);
      expect(def?.query, `${r.key} query`).toBe(meta.query);
      expect(def?.params, `${r.key} params`).toBe(meta.params);
      expect(def?.rateLimit, `${r.key} rateLimit`).toBe(meta.rateLimit);
    }
  });

  it("applies the error-response rules to every operation", async () => {
    for (const r of await discoverRoutes()) {
      const op = opFor(r) as Operation;
      const m = r.handler.meta;
      const expected = new Set<number>([500, ...(EXTRA_ERRORS[r.key] ?? [])]);
      if (m.body || m.query || m.params || m.tenant === "required") expected.add(400);
      if (m.auth === "required") expected.add(401);
      if (m.tenant === "required") expected.add(403);
      if (m.params) expected.add(404);
      if (m.body) expected.add(413);
      if ((m.rateLimit ?? []).length > 0) expected.add(429);

      // Non-2xx statuses that are part of the success envelope (health's 503) are not errors.
      const success = operations
        .find((o) => o.method === r.method.toLowerCase() && o.path === r.path)
        ?.success.map((x) => x.status);
      const actual = Object.keys(op.responses)
        .map(Number)
        .filter((s) => s >= 400 && !success?.includes(s));
      expect(actual.sort(), r.key).toEqual([...expected].sort());
      for (const s of actual) {
        const res = op.responses[String(s)];
        expect(res?.content?.["application/json"]?.schema.$ref, `${r.key} ${s}`).toBe(
          "#/components/schemas/ErrorEnvelope",
        );
        expect(res?.headers, `${r.key} ${s}`).toHaveProperty("X-Request-Id");
        if (s === 429) expect(res?.headers).toHaveProperty("Retry-After");
      }
    }
  });

  it("derives error statuses from the same function the generator uses", async () => {
    for (const op of operations) {
      expect(Object.keys(paths[op.path]?.[op.method]?.responses ?? {}).map(Number)).toEqual(
        expect.arrayContaining(errorStatuses(op)),
      );
    }
  });

  it("requires the bearer scheme exactly on authenticated operations", async () => {
    for (const r of await discoverRoutes()) {
      const op = opFor(r) as Operation;
      expect(op.security, r.key).toEqual(
        r.handler.meta.auth === "required" ? [{ bearerAuth: [] }] : [],
      );
    }
    expect(doc.components?.securitySchemes).toHaveProperty("bearerAuth");
  });

  it("documents X-Client-Id on tenant-required operations and X-Request-Id on all", async () => {
    for (const r of await discoverRoutes()) {
      const refs = (opFor(r) as Operation).parameters?.map((p) => p.$ref) ?? [];
      expect(refs.includes("#/components/parameters/XClientId"), r.key).toBe(
        r.handler.meta.tenant === "required",
      );
      expect(refs, r.key).toContain("#/components/parameters/XRequestIdParam");
    }
  });

  it("documents the app-config cache headers", () => {
    const res = paths["/api/v1/app/config"]?.get?.responses["200"];
    expect(res?.headers).toHaveProperty("Cache-Control");
    expect(res?.headers).toHaveProperty("Vary");
  });

  it("lists every ErrorCode in the ErrorEnvelope", () => {
    const schemas = doc.components?.schemas as unknown as Record<
      string,
      { properties: { error: { properties: { code: { enum: string[] } } } } }
    >;
    expect(schemas.ErrorEnvelope?.properties.error.properties.code.enum).toEqual(
      Object.keys(ERROR_STATUS),
    );
  });

  it("generates byte-identical output twice", () => {
    expect(JSON.stringify(buildOpenApiDocument())).toBe(JSON.stringify(buildOpenApiDocument()));
  });

  it("matches the committed openapi/openapi.json (run npm run openapi:generate)", async () => {
    const { readFileSync } = await import("node:fs");
    const committed = readFileSync(join(process.cwd(), "openapi/openapi.json"), "utf8");
    expect(committed).toBe(`${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
  });
});
