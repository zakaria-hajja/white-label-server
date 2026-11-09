import type { Prisma, Theme, UserSettings } from "@/generated/prisma/client";
import type { PrismaClient } from "@/core/database/prisma";

export type SettingsValues = {
  theme: Theme;
  language: string;
  notificationPreferences: Prisma.JsonObject;
};

export interface SettingsRepository {
  findForUser(tenantId: string, userId: string): Promise<UserSettings | null>;
  upsertForUser(tenantId: string, userId: string, values: SettingsValues): Promise<UserSettings>;
}

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findForUser(tenantId: string, userId: string): Promise<UserSettings | null> {
    return this.prisma.userSettings.findFirst({ where: { tenantId, userId } });
  }

  upsertForUser(tenantId: string, userId: string, values: SettingsValues): Promise<UserSettings> {
    return this.prisma.userSettings.upsert({
      where: { tenantId_userId: { tenantId, userId } },
      create: { tenantId, userId, ...values },
      update: values,
    });
  }
}
