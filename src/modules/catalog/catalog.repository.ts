import type { CatalogItem, Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/core/database/prisma";
import type { CatalogListQuery } from "./catalog.schemas";

export interface CatalogRepository {
  list(tenantId: string, query: CatalogListQuery): Promise<{ items: CatalogItem[]; total: number }>;
  findById(tenantId: string, id: string): Promise<CatalogItem | null>;
}

export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    tenantId: string,
    query: CatalogListQuery,
  ): Promise<{ items: CatalogItem[]; total: number }> {
    const where: Prisma.CatalogItemWhereInput = {
      tenantId,
      ...(query.category !== undefined ? { category: query.category } : {}),
      ...(query.q !== undefined
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" } },
              { description: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [field, dir] = query.sort.split(":") as ["createdAt" | "title", "asc" | "desc"];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.catalogItem.findMany({
        where,
        // id as the tie-breaker keeps page boundaries stable.
        orderBy: [{ [field]: dir }, { id: dir }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.catalogItem.count({ where }),
    ]);
    return { items, total };
  }

  findById(tenantId: string, id: string): Promise<CatalogItem | null> {
    return this.prisma.catalogItem.findFirst({ where: { id, tenantId } });
  }
}
