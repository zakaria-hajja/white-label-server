import { describe, expect, it } from "vitest";
// Must stay first: the registry module runs extendZodWithOpenApi() before any schema is built.
import "@/core/openapi/registry";
import type { ZodType } from "zod";
import { ERROR_STATUS, type ErrorCode } from "@/core/errors/codes";
import { generateOpaqueToken } from "@/core/auth/tokens";
import { ErrorEnvelope } from "@/core/openapi/components";
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

  it("is deterministic: building the document twice gives identical examples", () => {
    expect(JSON.stringify(buildOpenApiDocument())).toBe(JSON.stringify(doc));
  });
});
