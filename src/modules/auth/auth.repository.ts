import type { Prisma, Session, User } from "@/generated/prisma/client";
import type { PrismaClient } from "@/core/database/prisma";

export type NewUser = {
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
};

export type SessionMeta = { userAgent: string | null; ip: string | null };

export interface AuthRepository {
  findUserByEmail(tenantId: string, email: string): Promise<User | null>;
  findUserById(tenantId: string, id: string): Promise<User | null>;
  createUser(tenantId: string, data: NewUser): Promise<User>;
  /** Atomically increments the counter; sets lockedUntil when the new count reaches maxFailures. Returns the new count. */
  recordFailedLogin(
    tenantId: string,
    userId: string,
    maxFailures: number,
    lockUntil: Date,
  ): Promise<number>;
  resetFailedLogins(tenantId: string, userId: string): Promise<void>;
  createSession(
    tenantId: string,
    userId: string,
    meta: SessionMeta,
    expiresAt: Date,
  ): Promise<Session>;
  createRefreshToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Runs fn against a repository bound to one database transaction. */
  transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T>;
}

type Db = PrismaClient | Prisma.TransactionClient;

export class PrismaAuthRepository implements AuthRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly db: Db = prisma,
  ) {}

  findUserByEmail(tenantId: string, email: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { tenantId, email } });
  }

  findUserById(tenantId: string, id: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { id, tenantId } });
  }

  createUser(tenantId: string, data: NewUser): Promise<User> {
    return this.db.user.create({ data: { ...data, tenantId } });
  }

  async recordFailedLogin(
    tenantId: string,
    userId: string,
    maxFailures: number,
    lockUntil: Date,
  ): Promise<number> {
    const updated = await this.db.user.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= maxFailures) {
      await this.db.user.update({
        where: { tenantId_id: { tenantId, id: userId } },
        data: { lockedUntil: lockUntil },
      });
    }
    return updated.failedLoginCount;
  }

  async resetFailedLogins(tenantId: string, userId: string): Promise<void> {
    await this.db.user.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  createSession(
    tenantId: string,
    userId: string,
    meta: SessionMeta,
    expiresAt: Date,
  ): Promise<Session> {
    return this.db.session.create({
      data: { tenantId, userId, userAgent: meta.userAgent, ipAddress: meta.ip, expiresAt },
    });
  }

  async createRefreshToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.db.refreshToken.create({ data: { sessionId, tokenHash, expiresAt } });
  }

  transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => fn(new PrismaAuthRepository(this.prisma, tx)));
  }
}
