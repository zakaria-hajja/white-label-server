import { route } from "@/core/http/route";
import { getAppConfigHandler } from "@/modules/app-config/app-config.handlers";

export const runtime = "nodejs";

export const GET = route({ auth: "none", tenant: "required", handler: getAppConfigHandler });
