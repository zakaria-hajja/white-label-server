import type { AuthContext } from "@/core/auth/auth-context";
import { hashPassword, verifyPassword } from "@/core/auth/password";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import type { Clock } from "@/shared/clock";
import { toUserDto, type UserDto } from "../auth/user.dto";
import type { UsersRepository } from "./users.repository";
import type { ChangePasswordInput, DeleteMeInput, UpdateMeInput } from "./users.schemas";

export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly clock: Clock,
  ) {}

  async getMe(ctx: TenantContext, auth: AuthContext): Promise<UserDto> {
    const user = await this.repo.findById(ctx.tenantId, auth.userId);
    if (!user) throw new AppError("NOT_FOUND");
    return toUserDto(user);
  }

  async updateMe(ctx: TenantContext, auth: AuthContext, input: UpdateMeInput): Promise<UserDto> {
    if (!(await this.repo.findById(ctx.tenantId, auth.userId))) throw new AppError("NOT_FOUND");
    const patch = {
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
    };
    return toUserDto(await this.repo.updateProfile(ctx.tenantId, auth.userId, patch));
  }

  /** Hard delete after confirming the password. The next request with the old tokens is 401. */
  async deleteMe(ctx: TenantContext, auth: AuthContext, input: DeleteMeInput): Promise<void> {
    const user = await this.repo.findById(ctx.tenantId, auth.userId);
    if (!user) throw new AppError("NOT_FOUND");
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw new AppError("INVALID_CREDENTIALS");
    }
    const guard = { passwordChangedAt: user.passwordChangedAt, sessionId: auth.sessionId };
    if (await this.repo.deleteUser(ctx.tenantId, user.id, guard)) return;
    // Nothing matched: something changed between the check and the delete.
    const current = await this.repo.findById(ctx.tenantId, auth.userId);
    if (!current) return; // already deleted, e.g. a double submit: the outcome the caller asked for
    if (current.passwordChangedAt.getTime() !== user.passwordChangedAt.getTime()) {
      throw new AppError("INVALID_CREDENTIALS"); // the password changed; the verified one is stale
    }
    throw new AppError("UNAUTHENTICATED"); // the caller's session was revoked meanwhile
  }

  async changePassword(
    ctx: TenantContext,
    auth: AuthContext,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.repo.findById(ctx.tenantId, auth.userId);
    if (!user) throw new AppError("NOT_FOUND");
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError("INVALID_CREDENTIALS");
    }
    if (input.newPassword === input.currentPassword) {
      throw new AppError("VALIDATION_ERROR", "New password must differ from the current password");
    }
    // Argon2 is slow: hash before opening the transaction.
    const passwordHash = await hashPassword(input.newPassword);
    const now = this.clock.now();
    await this.repo.transaction(async ({ users, sessions }) => {
      await users.updatePassword(ctx.tenantId, user.id, passwordHash, now);
      await sessions.revokeAllSessions(
        ctx.tenantId,
        user.id,
        "password_changed",
        now,
        auth.sessionId,
      );
    });
  }
}
