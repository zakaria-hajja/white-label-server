import type { ErrorCode } from "../errors/codes";
import type { Pagination } from "../http/envelope";

/**
 * Fixed inputs for the OpenAPI examples. Examples are computed from these by the real mappers, so
 * they never use the clock or random values and regeneration stays byte-identical.
 */
export const FIXTURE_REQUEST_ID = "0b8f5c3e-6d1a-4f4e-9a57-2c1d3e4f5a6b";
export const FIXTURE_NOW = new Date("2026-01-01T00:00:00.000Z");

export const FIXTURE_IDS = {
  tenant: "01950000-0000-7000-8000-000000000001",
  user: "01950000-0000-7000-8000-000000000101",
  session: "01950000-0000-7000-8000-000000000201",
  otherSession: "01950000-0000-7000-8000-000000000202",
  catalogItem: "01950000-0000-7000-8000-000000000301",
  otherCatalogItem: "01950000-0000-7000-8000-000000000302",
} as const;

export const FIXTURE_TENANT = { slug: "acme", name: "Acme" } as const;

export function exampleEnvelope<T>(
  data: T,
  opts: { pagination?: Pagination } = {},
): { success: true; data: T; meta: { requestId: string; pagination?: Pagination } } {
  return {
    success: true,
    data,
    meta: opts.pagination
      ? { requestId: FIXTURE_REQUEST_ID, pagination: opts.pagination }
      : { requestId: FIXTURE_REQUEST_ID },
  };
}

export function exampleError(
  code: ErrorCode,
  message: string,
  details?: { path: string; message: string }[],
) {
  return {
    success: false as const,
    error: { code, message, ...(details ? { details } : {}) },
    meta: { requestId: FIXTURE_REQUEST_ID },
  };
}
