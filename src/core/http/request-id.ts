const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Echoes a well-formed inbound X-Request-Id; otherwise generates a UUID. */
export function resolveRequestId(req: Request): string {
  const inbound = req.headers.get("x-request-id");
  return inbound !== null && SAFE_ID.test(inbound) ? inbound : crypto.randomUUID();
}
