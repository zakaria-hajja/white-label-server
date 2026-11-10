import { z } from "zod";
import { route } from "@/core/http/route";
import { getCatalogItemHandler } from "@/modules/catalog/catalog.handlers";

export const runtime = "nodejs";

export const GET = route({
  auth: "required",
  tenant: "required",
  params: z.object({ id: z.string() }),
  handler: getCatalogItemHandler,
});
