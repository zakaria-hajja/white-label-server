import type { CatalogItem } from "@/generated/prisma/client";
import type { CatalogRepository } from "@/modules/catalog/catalog.repository";
import type { CatalogListQuery } from "@/modules/catalog/catalog.schemas";

/** In-memory CatalogRepository; always filters on tenantId like the real one. */
export class FakeCatalogRepository implements CatalogRepository {
  readonly rows: CatalogItem[] = [];

  list(
    tenantId: string,
    query: CatalogListQuery,
  ): Promise<{ items: CatalogItem[]; total: number }> {
    const q = query.q?.toLowerCase();
    const matches = this.rows.filter(
      (r) =>
        r.tenantId === tenantId &&
        (query.category === undefined || r.category === query.category) &&
        (q === undefined ||
          r.title.toLowerCase().includes(q) ||
          (r.description ?? "").toLowerCase().includes(q)),
    );
    const [field, dir] = query.sort.split(":") as ["createdAt" | "title", "asc" | "desc"];
    const sign = dir === "asc" ? 1 : -1;
    matches.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      const cmp = av < bv ? -1 : av > bv ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      return cmp * sign;
    });
    const start = (query.page - 1) * query.pageSize;
    return Promise.resolve({
      items: matches.slice(start, start + query.pageSize),
      total: matches.length,
    });
  }

  findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null);
  }
}
