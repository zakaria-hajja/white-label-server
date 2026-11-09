import { describe, expect, it } from "vitest";
import { AppError } from "@/core/errors/app-error";
import { ERROR_STATUS } from "@/core/errors/codes";
import { fail, ok } from "@/core/http/envelope";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response) => r.json() as Promise<any>;

describe("ok", () => {
  it("wraps data with meta and echoes the request id", async () => {
    const res = ok({ a: 1 }, { requestId: "r1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBe("r1");
    expect(await json(res)).toEqual({ success: true, data: { a: 1 }, meta: { requestId: "r1" } });
  });

  it("includes pagination and custom status", async () => {
    const pagination = { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 };
    const res = ok([1], { requestId: "r1", status: 201, pagination });
    expect(res.status).toBe(201);
    expect((await json(res)).meta).toEqual({ requestId: "r1", pagination });
  });
});

describe("fail", () => {
  it("maps code to status and merges headers", async () => {
    const res = fail(
      new AppError("RATE_LIMITED", undefined, undefined, { "Retry-After": "30" }),
      "r1",
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("x-request-id")).toBe("r1");
    const body = await json(res);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error).not.toHaveProperty("details");
    expect(body.meta).toEqual({ requestId: "r1" });
  });

  it("includes details when defined", async () => {
    const res = fail(
      new AppError("VALIDATION_ERROR", "bad", [{ path: "email", message: "x" }]),
      "r1",
    );
    expect((await json(res)).error.details).toEqual([{ path: "email", message: "x" }]);
  });
});

describe("ERROR_STATUS", () => {
  it("matches the design table", () => {
    expect(ERROR_STATUS).toEqual({
      VALIDATION_ERROR: 400,
      INVALID_CLIENT: 400,
      UNAUTHENTICATED: 401,
      TOKEN_EXPIRED: 401,
      INVALID_CREDENTIALS: 401,
      INVALID_REFRESH_TOKEN: 401,
      INVALID_RESET_TOKEN: 400,
      FORBIDDEN: 403,
      TENANT_SUSPENDED: 403,
      TENANT_MISMATCH: 403,
      NOT_FOUND: 404,
      FEATURE_DISABLED: 404,
      EMAIL_ALREADY_REGISTERED: 409,
      PAYLOAD_TOO_LARGE: 413,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
    });
  });
});
