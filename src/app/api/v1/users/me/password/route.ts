import { route } from "@/core/http/route";
import { changePasswordBody } from "@/modules/users/users.schemas";
import { changePasswordHandler, changePasswordRateLimit } from "@/modules/users/users.handlers";

export const runtime = "nodejs";

export const PATCH = route({
  auth: "required",
  tenant: "required",
  body: changePasswordBody,
  rateLimit: changePasswordRateLimit,
  handler: changePasswordHandler,
});
