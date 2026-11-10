import { afterAll, beforeAll, describe, expect, it } from "vitest";
// Must stay first: the registry module runs extendZodWithOpenApi() before any schema is built.
import "@/core/openapi/registry";
import { z, type ZodType } from "zod";
import { ERROR_STATUS, type ErrorCode } from "@/core/errors/codes";
import { generateOpaqueToken } from "@/core/auth/tokens";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import type { PrismaClient } from "@/core/database/prisma";
import { route } from "@/core/http/route";
import { createLogger } from "@/core/logging/logger";
import { FIXTURE_REQUEST_ID } from "@/core/openapi/fixtures";
import { ErrorEnvelope, registerOperation } from "@/core/openapi/components";
import { buildOpenApiDocument } from "@/core/openapi/document";
import { operations, type OperationDef } from "@/core/openapi/registry";
import { authBodyExamples, authFixtures } from "@/modules/auth/auth.examples";

type Media = { schema: unknown; example?: unknown };
type Operation = {
  requestBody?: { content: Record<string, Media> };
  responses: Record<string, { content?: Record<string, Media> }>;
};

const doc = buildOpenApiDocument();
const paths = doc.paths as unknown as Record<string, Record<string, Operation>>;
const opDoc = (op: OperationDef) => paths[op.path]?.[op.method] as Operation;
const label = (op: OperationDef) => `${op.method.toUpperCase()} ${op.path}`;

describe("OpenAPI examples", () => {
  it("covers every registered operation", () => {
    expect(operations.length).toBeGreaterThan(15);
  });

  it.each(operations.map((op) => [label(op), op] as const))(
    "%s: success examples parse against their response schemas",
    (_, op) => {
      for (const s of op.success) {
        expect(s.example, `${label(op)} ${s.status}`).toBeDefined();
        const parsed = (s.schema as ZodType).safeParse(s.example);
        expect(parsed.error?.issues ?? [], `${label(op)} ${s.status}`).toEqual([]);
      }
    },
  );

  it.each(operations.filter((op) => op.body).map((op) => [label(op), op] as const))(
    "%s: the body example parses with the route's own body schema",
    (_, op) => {
      expect(op.bodyExample).toBeDefined();
      const parsed = (op.body as ZodType).safeParse(op.bodyExample);
      expect(parsed.error?.issues ?? []).toEqual([]);
    },
  );

  it.each(operations.map((op) => [label(op), op] as const))(
    "%s: the generated document carries the examples",
    (_, op) => {
      const o = opDoc(op);
      for (const s of op.success) {
        expect(o.responses[s.status]?.content?.["application/json"]?.example).toEqual(s.example);
      }
      if (op.body) {
        expect(o.requestBody?.content["application/json"]?.example).toEqual(op.bodyExample);
      }
    },
  );

  it.each(operations.map((op) => [label(op), op] as const))(
    "%s: 400, 401 and 429 responses have error examples with a matching code",
    (_, op) => {
      const o = opDoc(op);
      for (const status of ["400", "401", "429"]) {
        const media = o.responses[status]?.content?.["application/json"];
        if (!media) continue;
        const parsed = ErrorEnvelope.safeParse(media.example);
        expect(parsed.error?.issues ?? [], `${label(op)} ${status}`).toEqual([]);
        const code = (media.example as { error: { code: ErrorCode } }).error.code;
        expect(ERROR_STATUS[code], `${label(op)} ${status} ${code}`).toBe(Number(status));
      }
    },
  );

  it("uses VALIDATION_ERROR with details for bodies, UNAUTHENTICATED for auth, RATE_LIMITED", () => {
    const codeOf = (op: OperationDef, status: string) =>
      (
        opDoc(op).responses[status]?.content?.["application/json"]?.example as {
          error: { code: string; details?: unknown[] };
        }
      ).error;
    for (const op of operations) {
      if (op.body) {
        const e = codeOf(op, "400");
        expect(e.code, label(op)).toBe("VALIDATION_ERROR");
        expect(e.details?.length, label(op)).toBeGreaterThan(0);
      }
      if (op.auth === "required") expect(codeOf(op, "401").code, label(op)).toBe("UNAUTHENTICATED");
      if (op.rateLimit?.length) expect(codeOf(op, "429").code, label(op)).toBe("RATE_LIMITED");
    }
  });

  it("400 examples only show what the operation can return", () => {
    const err400 = (op: OperationDef) =>
      (
        opDoc(op).responses["400"]?.content?.["application/json"]?.example as {
          error: { code: string; message: string };
        }
      ).error;
    for (const op of operations) {
      if (!opDoc(op).responses["400"]) continue;
      const e = err400(op);
      // Path params are plain strings (a malformed id is 404), so only a body or query can fail.
      if (!op.body && !op.query) expect(e.code, label(op)).toBe("INVALID_CLIENT");
      // With a token, the tenant comes from the token; only dedicated mode's header check can 400.
      if (e.code === "INVALID_CLIENT" && op.auth === "required") {
        expect(e.message, label(op)).toBe("Unknown client");
      }
    }
  });

  it("opaque token examples look like real tokens (32 random bytes, base64url)", () => {
    const shape = (t: string) => ({ length: t.length, base64url: /^[A-Za-z0-9_-]+$/.test(t) });
    const real = shape(generateOpaqueToken());
    expect(shape(authFixtures.tokens.refreshToken)).toEqual(real);
    expect(shape(authBodyExamples.resetPassword.token)).toEqual(real);
  });

  describe("400 VALIDATION_ERROR examples are the real response to the op's invalidExample", () => {
    beforeAll(() => {
      const config = loadConfig({
        DEPLOYMENT_MODE: "shared",
        DATABASE_URL: "postgresql://x:y@localhost:5432/none",
        JWT_SECRET: "test-jwt-secret-test-jwt-secret-0123456789",
        LOG_LEVEL: "silent",
      });
      setContainer(
        createContainer(config, { prisma: {} as PrismaClient, logger: createLogger("silent") }),
      );
    });
    afterAll(() => setContainer(null));

    it.each(operations.filter((op) => op.body || op.query).map((op) => [label(op), op] as const))(
      "%s",
      async (_, op) => {
        expect(op.invalidExample, "invalidExample").toBeDefined();
        // Same body/query schema as the real route; tenant and auth are not what is under test.
        const h = route({
          auth: "none",
          tenant: "none",
          ...(op.body ? { body: op.body } : { query: op.query }),
          handler: async () => Response.json({}),
        });
        const url = new URL(`http://localhost${op.path}`);
        if (!op.body) {
          for (const [k, v] of Object.entries(op.invalidExample as Record<string, string>)) {
            url.searchParams.set(k, v);
          }
        }
        const res = await h(
          new Request(url, {
            method: op.method.toUpperCase(),
            headers: { "content-type": "application/json", "x-request-id": FIXTURE_REQUEST_ID },
            ...(op.body ? { body: JSON.stringify(op.invalidExample) } : {}),
          }),
          { params: Promise.resolve({}) },
        );
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual(
          opDoc(op).responses["400"]?.content?.["application/json"]?.example,
        );
      },
    );
  });

  it("registration rejects a missing or valid invalidExample, before registering anything", () => {
    const body = z.object({ name: z.string().min(1) }).strict();
    const def: OperationDef = {
      method: "post",
      path: "/api/v1/x/probe",
      operationId: "probe",
      tag: "System",
      summary: "probe",
      auth: "none",
      tenant: "none",
      body,
      bodyExample: { name: "a" },
      success: [{ status: 200, description: "ok", schema: z.object({}), example: {} }],
    };
    const before = operations.length;
    expect(() => registerOperation(def)).toThrow(/needs an invalidExample/);
    expect(() => registerOperation({ ...def, invalidExample: { name: "a" } })).toThrow(
      /must fail validation/,
    );
    expect(operations.length).toBe(before);
  });

  it("is deterministic: building the document twice gives identical examples", () => {
    expect(JSON.stringify(buildOpenApiDocument())).toBe(JSON.stringify(doc));
  });
});
