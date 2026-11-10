import { ok } from "@/core/http/envelope";
import type { RouteContext } from "@/core/http/route";
import { isUuid } from "@/core/validation/common";
import { ipKey, type RateLimitRule } from "@/core/rate-limit/rate-limiter";
import { AppError } from "@/core/errors/app-error";
import type {
  ForgotPasswordInput,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
} from "./auth.schemas";

type Ctx<B> = RouteContext<B, undefined, undefined, "required", "none">;

// Rule order matters: route() stops at the first rejected rule, so IP rules come first. A blocked
// IP then never reaches (and never creates) the body-keyed account buckets.
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

export const refreshRateLimit: RateLimitRule[] = [
  { name: "refresh-ip", limit: 30, windowSeconds: 60, key: ({ ip }) => ipKey(ip) },
];

export const forgotPasswordRateLimit: RateLimitRule[] = [
  { name: "forgot-ip", limit: 10, windowSeconds: 900, key: ({ ip }) => ipKey(ip) },
  // Not IP-scoped, so a distributed flood cannot spam one mailbox. body.email is already normalised.
  {
    name: "forgot-account",
    limit: 3,
    windowSeconds: 900,
    key: ({ body, tenant }) =>
      tenant ? `${tenant.tenantId}|${(body as ForgotPasswordInput).email}` : null,
  },
];

export const resetPasswordRateLimit: RateLimitRule[] = [
  { name: "reset-ip", limit: 10, windowSeconds: 900, key: ({ ip }) => ipKey(ip) },
];

type AuthedCtx<P = undefined> = RouteContext<undefined, undefined, P, "required", "required">;

const meta = (c: Ctx<unknown>) => ({ userAgent: c.req.headers.get("user-agent"), ip: c.ip });

export async function registerHandler(c: Ctx<RegisterInput>): Promise<Response> {
  const result = await c.container.services.auth.register(c.tenant, c.body, meta(c));
  return ok(result, { status: 201, requestId: c.requestId });
}

export async function loginHandler(c: Ctx<LoginInput>): Promise<Response> {
  const result = await c.container.services.auth.login(c.tenant, c.body, meta(c));
  return ok(result, { requestId: c.requestId });
}

export async function refreshHandler(c: Ctx<RefreshInput>): Promise<Response> {
  const tokens = await c.container.services.auth.refresh(c.tenant, c.body.refreshToken);
  return ok({ tokens }, { requestId: c.requestId });
}

export async function logoutHandler(c: Ctx<RefreshInput>): Promise<Response> {
  await c.container.services.auth.logout(c.tenant, c.body.refreshToken);
  return ok({}, { requestId: c.requestId });
}

export async function forgotPasswordHandler(c: Ctx<ForgotPasswordInput>): Promise<Response> {
  await c.container.services.auth.forgotPassword(c.tenant, c.body.email);
  return ok({}, { status: 202, requestId: c.requestId });
}

export async function resetPasswordHandler(c: Ctx<ResetPasswordInput>): Promise<Response> {
  await c.container.services.auth.resetPassword(c.tenant, c.body.token, c.body.newPassword);
  return ok({}, { requestId: c.requestId });
}

export async function meHandler(c: AuthedCtx): Promise<Response> {
  return ok(await c.container.services.auth.me(c.tenant, c.auth), { requestId: c.requestId });
}

export async function listSessionsHandler(c: AuthedCtx): Promise<Response> {
  const sessions = await c.container.services.auth.listSessions(c.tenant, c.auth);
  return ok({ sessions }, { requestId: c.requestId });
}

export async function revokeSessionHandler(c: AuthedCtx<{ id: string }>): Promise<Response> {
  // A malformed id is simply a session that does not exist, not a validation error.
  if (!isUuid(c.params.id)) throw new AppError("NOT_FOUND");
  await c.container.services.auth.revokeSession(c.tenant, c.auth, c.params.id);
  return ok({}, { requestId: c.requestId });
}
