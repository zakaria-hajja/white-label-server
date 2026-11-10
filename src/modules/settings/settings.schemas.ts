import { z } from "zod";

export const ThemeSchema = z.enum(["SYSTEM", "LIGHT", "DARK"]);

/** Stored shape of `notificationPreferences`; missing keys fall back, unknown keys are dropped. */
export const NotificationsSchema = z.object({
  push: z.boolean().default(true),
  email: z.boolean().default(true),
  marketing: z.boolean().default(false),
});

export const updateSettingsBody = z
  .object({
    theme: ThemeSchema.optional(),
    language: z.string().min(2).max(10).optional(),
    notifications: z
      .object({
        push: z.boolean().optional(),
        email: z.boolean().optional(),
        marketing: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "At least one of theme, language, notifications is required",
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsBody>;
export type Notifications = z.infer<typeof NotificationsSchema>;
