import type { Prisma, User } from "@/generated/prisma/client";
import type { PrismaClient } from "@/core/database/prisma";
import { PrismaAuthRepository, type AuthRepository } from "../auth/auth.repository";

/** What a delete was verified against: the password version and the caller's live session. */
export type DeleteGuard = { passwordChangedAt: Date; sessionId: string };

export type ProfilePatch = { firstName?: string | null; lastName?: string | null };

/** Repositories bound to one transaction. Session revocation reuses the auth repository. */
export type UsersTx = {
  users: UsersRepository;
  sessions: Pick<AuthRepository, "revokeAllSessions">;
};

export interface UsersRepository {
  findById(tenantId: string, id: string): Promise<User | null>;
  updateProfile(tenantId: string, id: string, data: ProfilePatch): Promise<User>;
  /** Sets the hash and passwordChangedAt. */
  updatePassword(tenantId: string, id: string, passwordHash: string, now: Date): Promise<void>;
  /**
   * Deletes the user only if the password and session it was verified against are unchanged; the
   * schema's cascades remove sessions, refresh and reset tokens, and settings. False if no row matched.
   */
  deleteUser(tenantId: string, id: string, guard: DeleteGuard): Promise<boolean>;
  transaction<T>(fn: (tx: UsersTx) => Promise<T>): Promise<T>;
}

type Db = PrismaClient | Prisma.TransactionClient;

export class PrismaUsersRepository implements UsersRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly db: Db = prisma,
  ) {}

  findById(tenantId: string, id: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { id, tenantId } });
  }

  updateProfile(tenantId: string, id: string, data: ProfilePatch): Promise<User> {
    return this.db.user.update({ where: { tenantId_id: { tenantId, id } }, data });
  }

  async updatePassword(
    tenantId: string,
    id: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    await this.db.user.update({
      where: { tenantId_id: { tenantId, id } },
      data: { passwordHash, passwordChangedAt: now },
    });
  }

  async deleteUser(tenantId: string, id: string, guard: DeleteGuard): Promise<boolean> {
    // One conditional statement: a concurrent password change, reset or session revocation wins.
    const { count } = await this.db.user.deleteMany({
      where: {
        tenantId,
        id,
        passwordChangedAt: guard.passwordChangedAt,
        sessions: { some: { id: guard.sessionId, revokedAt: null } },
      },
    });
    return count > 0;
  }

  transaction<T>(fn: (tx: UsersTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) =>
      fn({
        users: new PrismaUsersRepository(this.prisma, tx),
        sessions: new PrismaAuthRepository(this.prisma, tx),
      }),
    );
  }
}
