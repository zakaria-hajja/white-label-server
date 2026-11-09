import { z } from "zod";
import { zEmail, zPassword } from "@/core/validation/common";

const name = z.string().trim().min(1).max(50);

export const registerBody = z
  .object({
    email: zEmail,
    password: zPassword,
    firstName: name.optional(),
    lastName: name.optional(),
  })
  .strict();

// The password policy is not enforced on login: a wrong (even short) password must yield
// INVALID_CREDENTIALS, not VALIDATION_ERROR.
export const loginBody = z
  .object({
    email: zEmail,
    password: z.string().min(1).max(128),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;
