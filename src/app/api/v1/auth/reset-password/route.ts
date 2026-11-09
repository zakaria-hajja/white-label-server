import { route } from "@/core/http/route";
import { resetPasswordBody } from "@/modules/auth/auth.schemas";
import { resetPasswordHandler, resetPasswordRateLimit } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const POST = route({
  auth: "none",
  tenant: "required",
  body: resetPasswordBody,
  rateLimit: resetPasswordRateLimit,
  handler: resetPasswordHandler,
});
