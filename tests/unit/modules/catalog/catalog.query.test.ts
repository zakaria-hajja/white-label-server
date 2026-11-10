import { describe, expect, it } from "vitest";
import { CatalogListQuerySchema } from "@/modules/catalog/catalog.schemas";
import { toCatalogItemDto } from "@/modules/catalog/catalog.dto";

describe("CatalogListQuerySchema", () => {
  it("applies defaults", () => {
    expect(CatalogListQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: "createdAt:desc",
    });
  });

  it("coerces numbers and trims q", () => {
    expect(
      CatalogListQuerySchema.parse({ page: "2", pageSize: "10", q: "  foo ", category: "Books" }),
    ).toEqual({ page: 2, pageSize: 10, q: "foo", category: "Books", sort: "createdAt:desc" });
  });

  it("treats an empty or whitespace-only q as absent", () => {
    expect(CatalogListQuerySchema.parse({ q: "" }).q).toBeUndefined();
    expect(CatalogListQuerySchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it.each([
    { page: "0" },
    { page: "1.5" },
    { pageSize: "0" },
    { pageSize: "101" },
    { pageSize: "1000" },
    { q: "x".repeat(101) },
    { category: "" },
    { category: "x".repeat(51) },
    { sort: "password:asc" },
    { sort: "title" },
    { unknown: "1" },
  ])("rejects %j", (input) => {
    expect(CatalogListQuerySchema.safeParse(input).success).toBe(false);
  });

  it.each(["createdAt:asc", "createdAt:desc", "title:asc", "title:desc"])(
    "accepts sort %s",
    (s) => {
      expect(CatalogListQuerySchema.parse({ sort: s }).sort).toBe(s);
    },
  );
});

describe("toCatalogItemDto", () => {
  it("is an allowlist: ISO dates, nulls kept, no tenantId", () => {
    const row = {
      id: "i1",
      tenantId: "t1",
      title: "T",
      description: null,
      category: null,
      imageUrl: null,
      createdAt: new Date("2026-01-02T03:04:05.000Z"),
      updatedAt: new Date("2026-02-02T03:04:05.000Z"),
      extra: "secret",
    };
    expect(toCatalogItemDto(row)).toEqual({
      id: "i1",
      title: "T",
      description: null,
      category: null,
      imageUrl: null,
      createdAt: "2026-01-02T03:04:05.000Z",
      updatedAt: "2026-02-02T03:04:05.000Z",
    });
  });
});
