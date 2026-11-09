import type { PrismaClient } from "@/core/database/prisma";
import { AppConfigDocumentSchema, type AppConfigDocument } from "./app-config.schemas";

export interface AppConfigReader {
  getDocument(tenantId: string): Promise<AppConfigDocument>;
}

export class PrismaAppConfigReader implements AppConfigReader {
  constructor(private readonly prisma: PrismaClient) {}

  async getDocument(tenantId: string): Promise<AppConfigDocument> {
    const row = await this.prisma.applicationConfiguration.findUnique({ where: { tenantId } });
    if (!row) throw new Error(`application configuration missing for tenant ${tenantId}`);
    const parsed = AppConfigDocumentSchema.safeParse(row.configuration);
    if (!parsed.success) {
      throw new Error(`application configuration invalid for tenant ${tenantId}`);
    }
    return parsed.data;
  }
}
