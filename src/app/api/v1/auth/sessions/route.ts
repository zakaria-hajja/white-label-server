import { route } from "@/core/http/route";
import { listSessionsHandler } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const GET = route({ auth: "required", tenant: "required", handler: listSessionsHandler });
