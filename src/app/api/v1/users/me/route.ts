import { route } from "@/core/http/route";
import { deleteMeBody, updateMeBody } from "@/modules/users/users.schemas";
import {
  deleteAccountRateLimit,
  deleteMeHandler,
  getMeHandler,
  updateMeHandler,
} from "@/modules/users/users.handlers";

export const runtime = "nodejs";

export const GET = route({ auth: "required", tenant: "required", handler: getMeHandler });

export const PATCH = route({
  auth: "required",
  tenant: "required",
  body: updateMeBody,
  handler: updateMeHandler,
});

export const DELETE = route({
  auth: "required",
  tenant: "required",
  body: deleteMeBody,
  rateLimit: deleteAccountRateLimit,
  handler: deleteMeHandler,
});
