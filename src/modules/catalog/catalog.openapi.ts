import { PaginatedEnvelope, SuccessEnvelope, registerOperation } from "@/core/openapi/components";
import { registry, TAGS } from "@/core/openapi/registry";
import { zIdParams } from "@/core/validation/common";
import { CatalogItemDtoSchema } from "./catalog.dto";
import { CatalogListQuerySchema } from "./catalog.schemas";
import { catalogExamples } from "./catalog.examples";

const Item = registry.register("CatalogItemDto", CatalogItemDtoSchema);
export const CatalogListEnvelope = PaginatedEnvelope("CatalogListEnvelope", Item);
export const CatalogItemEnvelope = SuccessEnvelope("CatalogItemEnvelope", Item);
const base = {
  tag: TAGS.catalog,
  tenant: "required",
  auth: "required",
  description: "404 FEATURE_DISABLED when the tenant has the `catalog` feature turned off.",
} as const;

registerOperation({
  ...base,
  method: "get",
  path: "/api/v1/catalog",
  operationId: "catalogList",
  summary: "List catalog items (paginated)",
  query: CatalogListQuerySchema,
  success: [
    {
      status: 200,
      description: "A page of items; `meta.pagination` describes the page",
      schema: CatalogListEnvelope,
      example: catalogExamples.page,
    },
  ],
  extraErrors: [404],
});

registerOperation({
  ...base,
  method: "get",
  path: "/api/v1/catalog/{id}",
  operationId: "catalogGet",
  summary: "Get one catalog item",
  description: `${base.description} A malformed or foreign id is 404 NOT_FOUND.`,
  params: zIdParams,
  success: [
    {
      status: 200,
      description: "The item",
      schema: CatalogItemEnvelope,
      example: catalogExamples.item,
    },
  ],
});
