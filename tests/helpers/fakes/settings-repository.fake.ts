import type { UserSettings } from "@/generated/prisma/client";
import type { SettingsRepository, SettingsValues } from "@/modules/settings/settings.repository";

/** In-memory SettingsRepository keyed on (tenantId, userId). */
export class FakeSettingsRepository implements SettingsRepository {
  readonly rows: UserSettings[] = [];

  findForUser(tenantId: string, userId: string): Promise<UserSettings | null> {
    return Promise.resolve(
      this.rows.find((r) => r.tenantId === tenantId && r.userId === userId) ?? null,
    );
  }

  upsertForUser(tenantId: string, userId: string, values: SettingsValues): Promise<UserSettings> {
    const existing = this.rows.find((r) => r.tenantId === tenantId && r.userId === userId);
    if (existing) {
      Object.assign(existing, values);
      return Promise.resolve(existing);
    }
    const row: UserSettings = {
      id: `s${this.rows.length + 1}`,
      tenantId,
      userId,
      ...values,
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return Promise.resolve(row);
  }
}
