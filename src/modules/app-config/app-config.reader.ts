import type { Logger } from "pino";
import type { PrismaClient } from "@/core/database/prisma";
import type { Clock } from "../../shared/clock";
import { AppConfigDocumentSchema, type AppConfigDocument } from "./app-config.schemas";

const TTL_MS = 30_000;

export interface AppConfigReader {
  getDocument(tenantId: string): Promise<AppConfigDocument>;
}

/** A missing or invalid stored document is a misconfiguration: logged, then thrown (-> 500). */
export class PrismaAppConfigReader implements AppConfigReader {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger?: Logger,
  ) {}

  async getDocument(tenantId: string): Promise<AppConfigDocument> {
    const row = await this.prisma.applicationConfiguration.findUnique({ where: { tenantId } });
    if (!row) {
      this.logger?.error({ tenantId }, "app config misconfigured");
      throw new Error(`application configuration missing for tenant ${tenantId}`);
    }
    const parsed = AppConfigDocumentSchema.safeParse(row.configuration);
    if (!parsed.success) {
      this.logger?.error({ tenantId }, "app config misconfigured");
      throw new Error(`application configuration invalid for tenant ${tenantId}`);
    }
    return parsed.data;
  }
}

/** Caches documents per tenant for 30 s. Failures are never cached. */
export class CachedAppConfigReader implements AppConfigReader {
  private readonly entries = new Map<string, { doc: AppConfigDocument; expires: number }>();

  constructor(
    private readonly source: AppConfigReader,
    private readonly clock: Clock,
  ) {}

  async getDocument(tenantId: string): Promise<AppConfigDocument> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(tenantId);
    if (hit && hit.expires > now) return hit.doc;
    const doc = await this.source.getDocument(tenantId);
    this.entries.set(tenantId, { doc, expires: now + TTL_MS });
    return doc;
  }

  invalidate(): void {
    this.entries.clear();
  }
}
