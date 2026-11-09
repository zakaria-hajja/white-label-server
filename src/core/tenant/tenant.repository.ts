import type { PrismaClient } from "../database/prisma";
import type { TenantLookup, TenantRecord } from "./tenant-context";

const select = { id: true, slug: true, name: true, status: true } as const;

export class PrismaTenantLookup implements TenantLookup {
  constructor(private readonly prisma: PrismaClient) {}

  findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.prisma.tenant.findUnique({ where: { slug }, select });
  }

  findById(id: string): Promise<TenantRecord | null> {
    return this.prisma.tenant.findUnique({ where: { id }, select });
  }
}
