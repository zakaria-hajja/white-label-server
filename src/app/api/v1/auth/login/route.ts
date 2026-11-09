import { route } from "@/core/http/route";
import { loginBody } from "@/modules/auth/auth.schemas";
import { loginHandler, loginRateLimit } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const POST = route({
  auth: "none",
  tenant: "required",
  body: loginBody,
  rateLimit: loginRateLimit,
  handler: loginHandler,
});
