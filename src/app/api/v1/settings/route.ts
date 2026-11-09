import { route } from "@/core/http/route";
import { updateSettingsBody } from "@/modules/settings/settings.schemas";
import { getSettingsHandler, updateSettingsHandler } from "@/modules/settings/settings.handlers";

export const runtime = "nodejs";

export const GET = route({ auth: "required", tenant: "required", handler: getSettingsHandler });

export const PATCH = route({
  auth: "required",
  tenant: "required",
  body: updateSettingsBody,
  handler: updateSettingsHandler,
});
