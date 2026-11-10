export type CatalogItemDto = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type CatalogItemLike = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Explicit allowlist: never spreads the row, so tenantId (and future columns) cannot leak. */
export function toCatalogItemDto(item: CatalogItemLike): CatalogItemDto {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    category: item.category,
    imageUrl: item.imageUrl,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
