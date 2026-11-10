import { AppError } from "@/core/errors/app-error";
import { ok } from "@/core/http/envelope";
import type { RouteContext } from "@/core/http/route";
import { isUuid } from "@/core/validation/common";
import { requireFeature } from "../app-config/feature-flags";
import type { CatalogListQuery } from "./catalog.schemas";

type Ctx<Q = undefined, P = undefined> = RouteContext<undefined, Q, P, "required", "required">;

export async function listCatalogHandler(c: Ctx<CatalogListQuery>): Promise<Response> {
  await requireFeature(c, "catalog");
  const { items, pagination } = await c.container.services.catalog.list(c.tenant, c.query);
  return ok(items, { requestId: c.requestId, pagination });
}

export async function getCatalogItemHandler(c: Ctx<undefined, { id: string }>): Promise<Response> {
  await requireFeature(c, "catalog");
  // A malformed id is simply an item that does not exist, not a validation error.
  if (!isUuid(c.params.id)) throw new AppError("NOT_FOUND");
  return ok(await c.container.services.catalog.get(c.tenant, c.params.id), {
    requestId: c.requestId,
  });
}
