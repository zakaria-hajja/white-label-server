import { route } from "@/core/http/route";
import { registerBody } from "@/modules/auth/auth.schemas";
import { registerHandler, registerRateLimit } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const POST = route({
  auth: "none",
  tenant: "required",
  body: registerBody,
  rateLimit: registerRateLimit,
  handler: registerHandler,
});
