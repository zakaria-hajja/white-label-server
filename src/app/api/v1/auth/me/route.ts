import { route } from "@/core/http/route";
import { meHandler } from "@/modules/auth/auth.handlers";

export const runtime = "nodejs";

export const GET = route({ auth: "required", tenant: "required", handler: meHandler });
