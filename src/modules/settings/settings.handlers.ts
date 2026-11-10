import { ok } from "@/core/http/envelope";
import type { RouteContext } from "@/core/http/route";
import type { UpdateSettingsInput } from "./settings.schemas";

type Ctx<B = undefined> = RouteContext<B, undefined, undefined, "required", "required">;

export async function getSettingsHandler(c: Ctx): Promise<Response> {
  return ok(await c.container.services.settings.get(c.tenant, c.auth), { requestId: c.requestId });
}

export async function updateSettingsHandler(c: Ctx<UpdateSettingsInput>): Promise<Response> {
  const dto = await c.container.services.settings.update(c.tenant, c.auth, c.body);
  return ok(dto, { requestId: c.requestId });
}
