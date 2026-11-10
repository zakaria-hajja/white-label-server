import type { AuthContext } from "@/core/auth/auth-context";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { AppConfigReader } from "../app-config/app-config.reader";
import type { SettingsRepository } from "./settings.repository";
import {
  NotificationsSchema,
  ThemeSchema,
  type SettingsDto,
  type UpdateSettingsInput,
} from "./settings.schemas";

type StoredSettings = { theme: string; language: string; notificationPreferences: unknown };
type RuntimeDefaults = { defaultTheme: string; defaultLanguage: string };

/**
 * The settings DTO: the stored row when there is one, otherwise the tenant's defaults. Pure, so the
 * OpenAPI examples are computed with it.
 */
export function buildSettingsDto(stored: StoredSettings, runtime?: RuntimeDefaults): SettingsDto;
export function buildSettingsDto(stored: null, runtime: RuntimeDefaults): SettingsDto;
export function buildSettingsDto(
  stored: StoredSettings | null,
  runtime?: RuntimeDefaults,
): SettingsDto {
  if (stored) {
    return {
      theme: ThemeSchema.parse(stored.theme),
      language: stored.language,
      notifications: NotificationsSchema.parse(
        typeof stored.notificationPreferences === "object" &&
          stored.notificationPreferences !== null
          ? stored.notificationPreferences
          : {},
      ),
    };
  }
  if (!runtime) throw new Error("buildSettingsDto: runtime defaults are required without a row");
  return {
    theme: ThemeSchema.parse(runtime.defaultTheme),
    language: runtime.defaultLanguage,
    notifications: NotificationsSchema.parse({}),
  };
}

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
    if (row) return buildSettingsDto(row);
    const { runtime } = await this.appConfig.getDocument(ctx.tenantId);
    return buildSettingsDto(null, runtime);
  }
}
