import { exampleEnvelope, exampleError } from "./fixtures";

export const healthExamples = {
  ok: exampleEnvelope({ status: "ok" as const, db: "up" as const }),
  degraded: exampleEnvelope({ status: "degraded" as const, db: "down" as const }),
};

/** Error envelopes as the server writes them (messages copied from where each code is thrown). */
export const errorExamples = {
  validation: exampleError("VALIDATION_ERROR", "Request validation failed", [
    { path: "email", message: "Invalid email address" },
  ]),
  invalidClient: exampleError("INVALID_CLIENT", "A valid X-Client-Id header is required"),
  unauthenticated: exampleError("UNAUTHENTICATED", "UNAUTHENTICATED"),
  invalidCredentials: exampleError("INVALID_CREDENTIALS", "INVALID_CREDENTIALS"),
  invalidRefreshToken: exampleError("INVALID_REFRESH_TOKEN", "INVALID_REFRESH_TOKEN"),
  rateLimited: exampleError("RATE_LIMITED", "RATE_LIMITED"),
};
