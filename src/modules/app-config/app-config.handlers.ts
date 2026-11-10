import { ok } from "@/core/http/envelope";
import type { RouteContext } from "@/core/http/route";

type Ctx = RouteContext<undefined, undefined, undefined, "required", "none">;

export async function getAppConfigHandler(c: Ctx): Promise<Response> {
  const res = ok(await c.container.services.appConfig.getPublic(c.tenant), {
    requestId: c.requestId,
  });
  res.headers.set("cache-control", "public, max-age=60");
  // Shared mode serves different tenants on one URL; a CDN must key on the client id.
  res.headers.set("vary", "X-Client-Id");
  return res;
}
