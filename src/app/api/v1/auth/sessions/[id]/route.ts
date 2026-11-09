import { z } from "zod";
import { route } from "@/core/http/route";
import { revokeSessionHandler } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const DELETE = route({
  auth: "required",
  tenant: "required",
  params: z.object({ id: z.string() }),
  handler: revokeSessionHandler,
});
