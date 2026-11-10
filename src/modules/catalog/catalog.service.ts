import { AppError } from "@/core/errors/app-error";
import type { Pagination } from "@/core/http/envelope";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { toCatalogItemDto, type CatalogItemDto } from "./catalog.dto";
import type { CatalogRepository } from "./catalog.repository";
import type { CatalogListQuery } from "./catalog.schemas";

export class CatalogService {
  constructor(private readonly repo: CatalogRepository) {}

  async list(
    ctx: TenantContext,
    query: CatalogListQuery,
  ): Promise<{ items: CatalogItemDto[]; pagination: Pagination }> {
    const { items, total } = await this.repo.list(ctx.tenantId, query);
    return {
      items: items.map(toCatalogItemDto),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async get(ctx: TenantContext, id: string): Promise<CatalogItemDto> {
    const item = await this.repo.findById(ctx.tenantId, id);
    if (!item) throw new AppError("NOT_FOUND");
    return toCatalogItemDto(item);
  }
}
