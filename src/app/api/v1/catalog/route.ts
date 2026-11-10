import { route } from "@/core/http/route";
import { CatalogListQuerySchema } from "@/modules/catalog/catalog.schemas";
import { listCatalogHandler } from "@/modules/catalog/catalog.handlers";

export const runtime = "nodejs";

export const GET = route({
  auth: "required",
  tenant: "required",
  query: CatalogListQuerySchema,
  handler: listCatalogHandler,
});
