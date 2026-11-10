import { z } from "zod";

export const CatalogItemDtoSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  imageUrl: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CatalogItemDto = z.infer<typeof CatalogItemDtoSchema>;

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
