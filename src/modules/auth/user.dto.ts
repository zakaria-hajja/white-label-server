import { z } from "zod";

/** Response contract of a user; the OpenAPI spec and the DTO contract test use this schema. */
export const UserDtoSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  status: z.string().describe("Account status, e.g. ACTIVE"),
  createdAt: z.iso.datetime(),
});

export type UserDto = z.infer<typeof UserDtoSchema>;

type UserLike = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  createdAt: Date;
};

/**
 * Explicit allowlist: never spreads the row, so passwordHash, failedLoginCount and lockedUntil
 * cannot leak.
 */
export function toUserDto(user: UserLike): UserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}

export const SessionDtoSchema = z.object({
  id: z.uuid(),
  userAgent: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean().describe("True for the session that made this request"),
});

export type SessionDto = z.infer<typeof SessionDtoSchema>;

/** Explicit allowlist: never exposes ipAddress or token data. */
export function toSessionDto(
  session: { id: string; userAgent: string | null; createdAt: Date; lastUsedAt: Date },
  currentSessionId: string,
): SessionDto {
  return {
    id: session.id,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    current: session.id === currentSessionId,
  };
}
