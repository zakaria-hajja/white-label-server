import { z } from "zod";
import { zPagination } from "@/core/validation/common";

export const CATALOG_SORTS = [
  "createdAt:asc",
  "createdAt:desc",
  "title:asc",
  "title:desc",
] as const;

export const CatalogListQuerySchema = zPagination
  .extend({
    // An empty or whitespace-only q means "no search".
    q: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((v) => (v ? v : undefined)),
    category: z.string().min(1).max(50).optional(),
    sort: z.enum(CATALOG_SORTS).default("createdAt:desc"),
  })
  .strict();

export type CatalogListQuery = z.infer<typeof CatalogListQuerySchema>;
