import { route } from "@/core/http/route";
import { refreshBody } from "@/modules/auth/auth.schemas";
import { refreshHandler, refreshRateLimit } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const POST = route({
  auth: "none",
  tenant: "required",
  body: refreshBody,
  rateLimit: refreshRateLimit,
  handler: refreshHandler,
});
