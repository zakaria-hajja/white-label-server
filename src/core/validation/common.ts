import { z } from "zod";

export const zEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const zPassword = z.string().min(10).max(128);
export const zUuid = z.uuid();
export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
