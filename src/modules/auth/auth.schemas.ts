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

const refreshTokenField = z.string().min(1).max(256);
export const refreshBody = z.object({ refreshToken: refreshTokenField }).strict();
export const logoutBody = refreshBody;

export const forgotPasswordBody = z.object({ email: zEmail }).strict();
export const resetPasswordBody = z
  .object({ token: z.string().min(1).max(256), newPassword: zPassword })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordBody>;
export type ResetPasswordInput = z.infer<typeof resetPasswordBody>;
export type RefreshInput = z.infer<typeof refreshBody>;
export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;

export const TokenPairSchema = z.object({
  accessToken: z.string().describe("JWT; send as `Authorization: Bearer <accessToken>`"),
  refreshToken: z
    .string()
    .describe("Opaque, single-use; exchange at POST /auth/refresh for a new pair"),
  tokenType: z.literal("Bearer"),
  expiresIn: z.number().int().describe("Access token lifetime in seconds"),
});

export type TokenPair = z.infer<typeof TokenPairSchema>;
