import { beforeEach, describe, expect, it } from "vitest";
import { FakeCatalogRepository } from "../../../helpers/fakes/catalog-repository.fake";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { CatalogService } from "@/modules/catalog/catalog.service";
import { CatalogListQuerySchema } from "@/modules/catalog/catalog.schemas";

const A: TenantContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  slug: "a",
  name: "A",
  source: "header",
};
const B: TenantContext = { ...A, tenantId: "00000000-0000-4000-8000-00000000000b", slug: "b" };
const query = (q: object = {}) => CatalogListQuerySchema.parse(q);

let repo: FakeCatalogRepository;
let service: CatalogService;

function add(tenantId: string, n: number, title: string, category: string | null = null) {
  repo.rows.push({
    id: `i${n}`,
    tenantId,
    title,
    description: null,
    category,
    imageUrl: null,
    createdAt: new Date(2026, 0, n),
    updatedAt: new Date(2026, 0, n),
  });
}

beforeEach(() => {
  repo = new FakeCatalogRepository();
  service = new CatalogService(repo);
  for (let i = 1; i <= 5; i++) add(A.tenantId, i, `A ${i}`);
  add(B.tenantId, 6, "B 6");
});

describe("CatalogService.list", () => {
  it("returns DTOs and pagination for one tenant only", async () => {
    const r = await service.list(A, query({ pageSize: "2" }));
    expect(r.items.map((i) => i.id)).toEqual(["i5", "i4"]);
    expect(r.items[0]).not.toHaveProperty("tenantId");
    expect(r.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 5, totalPages: 3 });
  });

  it("has totalPages 0 when empty", async () => {
    const r = await service.list(A, query({ q: "nomatch" }));
    expect(r.items).toEqual([]);
    expect(r.pagination).toEqual({ page: 1, pageSize: 20, totalItems: 0, totalPages: 0 });
  });

  it("a page beyond the end is empty with correct totals", async () => {
    const r = await service.list(A, query({ page: "99" }));
    expect(r.items).toEqual([]);
    expect(r.pagination.totalItems).toBe(5);
  });
});

describe("CatalogService.get", () => {
  it("returns the item", async () => {
    expect((await service.get(A, "i1")).title).toBe("A 1");
  });

  it("throws NOT_FOUND for another tenant's item", async () => {
    await expect(service.get(A, "i6")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.get(A, "i6")).rejects.toBeInstanceOf(AppError);
  });
});
