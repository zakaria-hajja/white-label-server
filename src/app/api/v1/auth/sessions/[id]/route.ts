import { route } from "@/core/http/route";
import { zIdParams } from "@/core/validation/common";
import { revokeSessionHandler } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const DELETE = route({
  auth: "required",
  tenant: "required",
  params: zIdParams,
  handler: revokeSessionHandler,
});
