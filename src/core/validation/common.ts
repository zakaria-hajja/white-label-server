import { z } from "zod";

export const zEmail = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const zPassword = z.string().min(10).max(128);
export const zUuid = z.uuid();
export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For path ids: a malformed id is "not found" (404), so check this instead of validating with zUuid. */
export const isUuid = (v: string): boolean => UUID_RE.test(v);

/** Path params of `/{id}` routes. Malformed ids are a 404 (see `isUuid`), so this stays a plain string. */
export const zIdParams = z.object({ id: z.string().describe("UUID of the resource") });
