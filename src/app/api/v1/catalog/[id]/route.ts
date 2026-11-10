import { route } from "@/core/http/route";
import { zIdParams } from "@/core/validation/common";
import { getCatalogItemHandler } from "@/modules/catalog/catalog.handlers";

export const runtime = "nodejs";

export const GET = route({
  auth: "required",
  tenant: "required",
  params: zIdParams,
  handler: getCatalogItemHandler,
});
