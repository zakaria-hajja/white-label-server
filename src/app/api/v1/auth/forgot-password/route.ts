import { route } from "@/core/http/route";
import { forgotPasswordBody } from "@/modules/auth/auth.schemas";
import { forgotPasswordHandler, forgotPasswordRateLimit } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const POST = route({
  auth: "none",
  tenant: "required",
  body: forgotPasswordBody,
  rateLimit: forgotPasswordRateLimit,
  handler: forgotPasswordHandler,
});
