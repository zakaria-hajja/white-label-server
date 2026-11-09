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
  firstName: string;
  lastName: string;
  status: string;
  createdAt: Date;
};

/**
 * Explicit allowlist: never spreads the row, so passwordHash, failedLoginCount and lockedUntil
 * cannot leak. The columns are NOT NULL; an empty string (name not provided at registration) is
 * exposed as null.
 */
export function toUserDto(user: UserLike): UserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName === "" ? null : user.firstName,
    lastName: user.lastName === "" ? null : user.lastName,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
  };
}
