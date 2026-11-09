import { route } from "@/core/http/route";
import { updateMeBody } from "@/modules/users/users.schemas";
import { getMeHandler, updateMeHandler } from "@/modules/users/users.handlers";

export const runtime = "nodejs";

export const GET = route({ auth: "required", tenant: "required", handler: getMeHandler });

export const PATCH = route({
  auth: "required",
  tenant: "required",
  body: updateMeBody,
  handler: updateMeHandler,
});
