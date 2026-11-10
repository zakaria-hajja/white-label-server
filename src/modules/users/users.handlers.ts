import { ok } from "@/core/http/envelope";
import type { RouteContext } from "@/core/http/route";
import type { RateLimitRule } from "@/core/rate-limit/rate-limiter";
import type { ChangePasswordInput, DeleteMeInput, UpdateMeInput } from "./users.schemas";

type Ctx<B = undefined> = RouteContext<B, undefined, undefined, "required", "required">;

/**
 * Brute-force protection for the password check on change-password and delete-account; per
 * account, not per IP. One shared bucket, so both routes together allow 5 guesses per window.
 */
const passwordCheckRateLimit: RateLimitRule[] = [
  {
    name: "password-check",
    limit: 5,
    windowSeconds: 900,
    key: ({ tenant, auth }) => (tenant && auth ? `${tenant.tenantId}|${auth.userId}` : null),
  },
];

export const changePasswordRateLimit = passwordCheckRateLimit;
export const deleteAccountRateLimit = passwordCheckRateLimit;

export async function getMeHandler(c: Ctx): Promise<Response> {
  return ok(await c.container.services.users.getMe(c.tenant, c.auth), { requestId: c.requestId });
}

export async function updateMeHandler(c: Ctx<UpdateMeInput>): Promise<Response> {
  const user = await c.container.services.users.updateMe(c.tenant, c.auth, c.body);
  return ok(user, { requestId: c.requestId });
}

export async function changePasswordHandler(c: Ctx<ChangePasswordInput>): Promise<Response> {
  await c.container.services.users.changePassword(c.tenant, c.auth, c.body);
  return ok({}, { requestId: c.requestId });
}

export async function deleteMeHandler(c: Ctx<DeleteMeInput>): Promise<Response> {
  await c.container.services.users.deleteMe(c.tenant, c.auth, c.body);
  return ok({}, { requestId: c.requestId });
}
