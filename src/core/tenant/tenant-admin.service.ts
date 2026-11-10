import type { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "../database/prisma";
import {
  AppConfigDocumentSchema,
  type AppConfigDocument,
} from "@/modules/app-config/app-config.schemas";
import { STARTER_FEATURE_KEYS } from "@/modules/app-config/feature-keys";
import { SLUG_PATTERN, type TenantRecord } from "./tenant-context";

export class TenantAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAdminError";
  }
}

const select = { id: true, slug: true, name: true, status: true } as const;

export function defaultAppConfig(name: string): AppConfigDocument {
  return {
    app: { displayName: name },
    support: {},
    legal: {
      privacyPolicyUrl: "https://example.com/privacy",
      termsUrl: "https://example.com/terms",
    },
    passwordReset: { linkBaseUrl: "https://example.com/reset-password" },
    runtime: { defaultLanguage: "en", supportedLanguages: ["en"], defaultTheme: "SYSTEM" },
  };
}

/** Operator-side tenant management (used by the CLI and seed; there is no admin HTTP API). */
export class TenantAdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly onChange?: () => void,
  ) {}

  async create(input: {
    slug: string;
    name: string;
    config?: AppConfigDocument;
  }): Promise<TenantRecord> {
    if (!SLUG_PATTERN.test(input.slug)) {
      throw new TenantAdminError(
        `Invalid slug "${input.slug}": use 2-63 lowercase letters, digits or hyphens, starting with a letter or digit`,
      );
    }
    if (!input.name.trim()) throw new TenantAdminError("Tenant name must not be empty");
    const config = AppConfigDocumentSchema.parse(input.config ?? defaultAppConfig(input.name));
    if (
      await this.prisma.tenant.findUnique({ where: { slug: input.slug }, select: { id: true } })
    ) {
      throw new TenantAdminError(`Tenant with slug "${input.slug}" already exists`);
    }
    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: { slug: input.slug, name: input.name },
        select,
      });
      await tx.applicationConfiguration.create({
        data: { tenantId: created.id, configuration: config as Prisma.InputJsonValue },
      });
      await tx.featureFlag.createMany({
        data: STARTER_FEATURE_KEYS.map((key) => ({ tenantId: created.id, key, enabled: true })),
      });
      return created;
    });
    this.onChange?.();
    return tenant;
  }

  list(): Promise<TenantRecord[]> {
    return this.prisma.tenant.findMany({ select, orderBy: { createdAt: "asc" } });
  }

  async setStatus(slug: string, status: "ACTIVE" | "SUSPENDED"): Promise<TenantRecord> {
    const tenant = await this.require(slug);
    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { status },
      select,
    });
    this.onChange?.();
    return updated;
  }

  /** Validates the document, replaces the stored one and increments `version`. */
  async setConfig(slug: string, doc: unknown): Promise<{ slug: string; version: number }> {
    const tenant = await this.require(slug);
    const config = AppConfigDocumentSchema.parse(doc);
    const data = { configuration: config as Prisma.InputJsonValue };
    const row = await this.prisma.applicationConfiguration.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, ...data },
      update: { ...data, version: { increment: 1 } },
      select: { version: true },
    });
    this.onChange?.();
    return { slug, version: row.version };
  }

  async setFeature(
    slug: string,
    key: string,
    enabled: boolean,
  ): Promise<{ slug: string; key: string; enabled: boolean }> {
    if (!key.trim()) throw new TenantAdminError("Feature key must not be empty");
    const tenant = await this.require(slug);
    await this.prisma.featureFlag.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key } },
      create: { tenantId: tenant.id, key, enabled },
      update: { enabled },
    });
    this.onChange?.();
    return { slug, key, enabled };
  }

  private async require(slug: string): Promise<TenantRecord> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select });
    if (!tenant) throw new TenantAdminError(`Unknown tenant slug "${slug}"`);
    return tenant;
  }
}
