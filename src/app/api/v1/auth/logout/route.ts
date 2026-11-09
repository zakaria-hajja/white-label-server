import { route } from "@/core/http/route";
import { logoutBody } from "@/modules/auth/auth.schemas";
import { logoutHandler } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const POST = route({
  auth: "none",
  tenant: "required",
  body: logoutBody,
  handler: logoutHandler,
});
