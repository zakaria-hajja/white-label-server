import { ok } from "@/core/http/envelope";
import type { RouteContext } from "@/core/http/route";
import { ipKey, type RateLimitRule } from "@/core/rate-limit/rate-limiter";
import type { LoginInput, RegisterInput } from "./auth.schemas";

type Ctx<B> = RouteContext<B, undefined, undefined, "required", "none">;

export const registerRateLimit: RateLimitRule[] = [
  { name: "register-ip", limit: 5, windowSeconds: 3600, key: ({ ip }) => ipKey(ip) },
];

export const loginRateLimit: RateLimitRule[] = [
  { name: "login-ip", limit: 10, windowSeconds: 60, key: ({ ip }) => ipKey(ip) },
  // Not IP-scoped: also stops distributed guessing and still applies when the IP is unknown.
  // body.email is already normalised by the schema.
  {
    name: "login-account",
    limit: 5,
    windowSeconds: 60,
    key: ({ body, tenant }) => (tenant ? `${tenant.tenantId}|${(body as LoginInput).email}` : null),
  },
];

const meta = (c: Ctx<unknown>) => ({ userAgent: c.req.headers.get("user-agent"), ip: c.ip });

export async function registerHandler(c: Ctx<RegisterInput>): Promise<Response> {
  const result = await c.container.services.auth.register(c.tenant, c.body, meta(c));
  return ok(result, { status: 201, requestId: c.requestId });
}

export async function loginHandler(c: Ctx<LoginInput>): Promise<Response> {
  const result = await c.container.services.auth.login(c.tenant, c.body, meta(c));
  return ok(result, { requestId: c.requestId });
}
