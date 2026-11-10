import { exampleEnvelope, FIXTURE_IDS } from "@/core/openapi/fixtures";
import { toCatalogItemDto } from "./catalog.dto";
import type { CatalogListQuery } from "./catalog.schemas";

/** Ordered newest first, as the default sort (`createdAt:desc`) returns them. */
export const catalogFixtures = {
  items: [
    {
      id: FIXTURE_IDS.catalogItem,
      title: "Acme Item 2",
      description: "Sample item 2 for Acme",
      category: "Music",
      imageUrl: "https://example.com/items/2.png",
      createdAt: new Date("2025-12-10T12:00:00.000Z"),
      updatedAt: new Date("2025-12-11T08:15:00.000Z"),
    },
    {
      id: FIXTURE_IDS.otherCatalogItem,
      title: "Acme Item 1",
      description: null,
      category: null,
      imageUrl: null,
      createdAt: new Date("2025-12-05T12:00:00.000Z"),
      updatedAt: new Date("2025-12-05T12:00:00.000Z"),
    },
  ],
  query: { page: 1, pageSize: 20, q: undefined, sort: "createdAt:desc" } satisfies CatalogListQuery,
};

const first = catalogFixtures.items[0] as (typeof catalogFixtures.items)[number];

export const catalogExamples = {
  page: exampleEnvelope(catalogFixtures.items.map(toCatalogItemDto), {
    pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
  }),
  item: exampleEnvelope(toCatalogItemDto(first)),
};

/** A query (string values, as in the URL) that fails validation; the 400 example is its real error. */
export const catalogListInvalidQuery = { pageSize: "500" };
