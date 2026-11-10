import { z } from "zod";
import { zPassword } from "@/core/validation/common";

const name = z.string().trim().min(1).max(50).nullable();

export const updateMeBody = z
  .object({ firstName: name.optional(), lastName: name.optional() })
  .strict()
  .refine((v) => v.firstName !== undefined || v.lastName !== undefined, {
    message: "At least one of firstName, lastName is required",
  });

// The policy applies to the new password only; a wrong current one must be INVALID_CREDENTIALS.
export const changePasswordBody = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: zPassword })
  .strict();

// No password policy here: a wrong (even short) password must be INVALID_CREDENTIALS.
export const deleteMeBody = z.object({ password: z.string().min(1).max(128) }).strict();

export type DeleteMeInput = z.infer<typeof deleteMeBody>;
export type UpdateMeInput = z.infer<typeof updateMeBody>;
export type ChangePasswordInput = z.infer<typeof changePasswordBody>;
