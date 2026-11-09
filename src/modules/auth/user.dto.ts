export type UserDto = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  createdAt: string;
};

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

export type SessionDto = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
};

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
