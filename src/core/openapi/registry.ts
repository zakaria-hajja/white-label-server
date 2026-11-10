import { z, type ZodType } from "zod";
import { extendZodWithOpenApi, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import type { RateLimitRule } from "../rate-limit/rate-limiter";

// Must run before any schema is registered (adds `.openapi()` to Zod schemas).
extendZodWithOpenApi(z);

/** The single registry every `*.openapi.ts` module registers into. */
export const registry = new OpenAPIRegistry();

export type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

export type SuccessResponseDef = {
  status: number;
  description: string;
  /** An envelope schema from `SuccessEnvelope` / `PaginatedEnvelope`. */
  schema: ZodType;
  /** Extra response headers (X-Request-Id is always added). */
  headers?: Record<string, { description: string; schema: { type: "string" } }>;
  /**
   * The full envelope, computed from the module's `*.examples.ts` fixtures by the real mappers.
   * `tests/unit/openapi/examples.test.ts` parses it against `schema`.
   */
  example: unknown;
};

/**
 * Describes one operation. `auth`, `tenant`, `body`, `query`, `params` and `rateLimit` mirror the
 * route's `route({...})` config (same schema objects), and `tests/unit/openapi/contract.test.ts`
 * fails when they drift from the real route. Error responses are derived from them.
 */
export type OperationDef = {
  method: HttpMethod;
  /** OpenAPI path with `{param}` placeholders, e.g. `/api/v1/catalog/{id}`. */
  path: string;
  /** Stable camelCase; used as the method name by client generators. */
  operationId: string;
  tag: string;
  summary: string;
  description?: string;
  auth: "none" | "required";
  tenant: "none" | "required";
  body?: ZodType;
  /** Required when `body` is set (registration throws otherwise); must parse with `body`. */
  bodyExample?: unknown;
  query?: ZodType;
  params?: ZodType;
  rateLimit?: RateLimitRule[];
  /** The first entry is the primary success response. */
  success: SuccessResponseDef[];
  /** Error statuses this operation can return beyond the ones derived from its config. */
  extraErrors?: number[];
  /**
   * Error-envelope examples by status, overriding the defaults (400 VALIDATION_ERROR or
   * INVALID_CLIENT, 401 UNAUTHENTICATED, 429 RATE_LIMITED). Required for a 401 on a public operation.
   */
  errorExamples?: Partial<Record<number, unknown>>;
};

/** Every registered operation, for the contract test. */
export const operations: OperationDef[] = [];

export const TAGS = {
  auth: "Auth",
  users: "Users",
  settings: "Settings",
  catalog: "Catalog",
  appConfig: "App Config",
  system: "System",
} as const;

export const TAG_DESCRIPTIONS: Record<(typeof TAGS)[keyof typeof TAGS], string> = {
  Auth: "Registration, sign-in, token refresh, password reset and session management.",
  Users: "The signed-in user's profile and password.",
  Settings: "The signed-in user's app settings (theme, language, notifications).",
  Catalog: "Tenant-scoped catalog items (feature-flagged).",
  "App Config": "Public per-tenant app configuration: branding, feature flags, legal links.",
  System: "Operational endpoints.",
};
