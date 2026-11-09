import type { AuthContext } from "@/core/auth/auth-context";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AppConfigReader } from "../app-config/app-config.reader";
import type { SettingsRepository } from "./settings.repository";
import {
  NotificationsSchema,
  ThemeSchema,
  type Notifications,
  type UpdateSettingsInput,
} from "./settings.schemas";

export type SettingsDto = {
  theme: "SYSTEM" | "LIGHT" | "DARK";
  language: string;
  notifications: Notifications;
};

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly appConfig: AppConfigReader,
  ) {}

  /** Stored settings, or tenant defaults when the user has no row (nothing is written). */
  async get(ctx: TenantContext, auth: AuthContext): Promise<SettingsDto> {
    return this.current(ctx, auth);
  }

  async update(
    ctx: TenantContext,
    auth: AuthContext,
    input: UpdateSettingsInput,
  ): Promise<SettingsDto> {
    if (input.language !== undefined) {
      const { runtime } = await this.appConfig.getDocument(ctx.tenantId);
      if (!runtime.supportedLanguages.includes(input.language)) {
        throw new AppError("VALIDATION_ERROR", "Validation failed", [
          { path: "language", message: "Language is not supported by this tenant" },
        ]);
      }
    }
    const base = await this.current(ctx, auth);
    const merged: SettingsDto = {
      theme: input.theme ?? base.theme,
      language: input.language ?? base.language,
      notifications: {
        ...base.notifications,
        ...Object.fromEntries(
          Object.entries(input.notifications ?? {}).filter(([, v]) => v !== undefined),
        ),
      },
    };
    await this.repo.upsertForUser(ctx.tenantId, auth.userId, {
      theme: merged.theme,
      language: merged.language,
      notificationPreferences: merged.notifications,
    });
    return merged;
  }

  private async current(ctx: TenantContext, auth: AuthContext): Promise<SettingsDto> {
    const row = await this.repo.findForUser(ctx.tenantId, auth.userId);
    if (row) {
      return {
        theme: row.theme,
        language: row.language,
        notifications: NotificationsSchema.parse(
          typeof row.notificationPreferences === "object" && row.notificationPreferences !== null
            ? row.notificationPreferences
            : {},
        ),
      };
    }
    const { runtime } = await this.appConfig.getDocument(ctx.tenantId);
    return {
      theme: ThemeSchema.parse(runtime.defaultTheme),
      language: runtime.defaultLanguage,
      notifications: NotificationsSchema.parse({}),
    };
  }
}
