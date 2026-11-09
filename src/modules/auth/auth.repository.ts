import type {
  PasswordResetToken,
  Prisma,
  RefreshToken,
  Session,
  User,
} from "@/generated/prisma/client";
import type { PrismaClient } from "@/core/database/prisma";

export type NewUser = {
  email: string;
  passwordHash: string;
  firstName: string | null;
  lastName: string | null;
};

export type SessionMeta = { userAgent: string | null; ip: string | null };

export type RefreshTokenWithSession = { token: RefreshToken; session: Session };

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
  /**
   * RefreshToken has no tenantId column: it is tenant-owned through its Session, so callers must
   * check `session.tenantId` against the request tenant.
   */
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenWithSession | null>;
  /** Atomically marks the token used. Returns false when it was already used (lost the race). */
  claimRefreshToken(id: string, now: Date): Promise<boolean>;
  touchSession(tenantId: string, sessionId: string, now: Date): Promise<void>;
  /** Idempotent: an already revoked session keeps its original revokedAt and reason. */
  revokeSession(tenantId: string, sessionId: string, reason: string, now: Date): Promise<void>;
  revokeAllSessions(
    tenantId: string,
    userId: string,
    reason: string,
    now: Date,
    exceptSessionId?: string,
  ): Promise<void>;
  /** Not revoked and not expired, newest lastUsedAt first. */
  listActiveSessions(tenantId: string, userId: string, now: Date): Promise<Session[]>;
  findSession(tenantId: string, userId: string, sessionId: string): Promise<Session | null>;
  createResetToken(
    tenantId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void>;
  /** Marks the user's unused reset tokens as used. */
  invalidateResetTokens(tenantId: string, userId: string, now: Date): Promise<void>;
  /** Not tenant-scoped (the caller does not know the tenant from the token); callers must check `tenantId`. */
  findResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null>;
  /** Atomically consumes the token if unused and unexpired at `now`. Returns false when it lost. */
  consumeResetToken(id: string, now: Date): Promise<boolean>;
  /** Sets the hash and passwordChangedAt, and clears failed-login count and lock. */
  updatePassword(tenantId: string, userId: string, passwordHash: string, now: Date): Promise<void>;
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

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenWithSession | null> {
    return this.db.refreshToken
      .findUnique({ where: { tokenHash }, include: { session: true } })
      .then((row) => {
        if (!row) return null;
        const { session, ...token } = row;
        return { token, session };
      });
  }

  async claimRefreshToken(id: string, now: Date): Promise<boolean> {
    const { count } = await this.db.refreshToken.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async touchSession(tenantId: string, sessionId: string, now: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, tenantId },
      data: { lastUsedAt: now },
    });
  }

  async revokeSession(
    tenantId: string,
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, tenantId, revokedAt: null },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  async revokeAllSessions(
    tenantId: string,
    userId: string,
    reason: string,
    now: Date,
    exceptSessionId?: string,
  ): Promise<void> {
    await this.db.session.updateMany({
      where: {
        tenantId,
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: now, revokedReason: reason },
    });
  }

  listActiveSessions(tenantId: string, userId: string, now: Date): Promise<Session[]> {
    return this.db.session.findMany({
      where: { tenantId, userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: "desc" },
    });
  }

  findSession(tenantId: string, userId: string, sessionId: string): Promise<Session | null> {
    return this.db.session.findFirst({ where: { id: sessionId, tenantId, userId } });
  }

  async createResetToken(
    tenantId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db.passwordResetToken.create({ data: { tenantId, userId, tokenHash, expiresAt } });
  }

  async invalidateResetTokens(tenantId: string, userId: string, now: Date): Promise<void> {
    await this.db.passwordResetToken.updateMany({
      where: { tenantId, userId, usedAt: null },
      data: { usedAt: now },
    });
  }

  findResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null> {
    return this.db.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  async consumeResetToken(id: string, now: Date): Promise<boolean> {
    const { count } = await this.db.passwordResetToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return count === 1;
  }

  async updatePassword(
    tenantId: string,
    userId: string,
    passwordHash: string,
    now: Date,
  ): Promise<void> {
    await this.db.user.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
    });
  }

  transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    // Already bound to a transaction: join it rather than opening an independent one.
    if (this.db !== this.prisma) return fn(this);
    return this.prisma.$transaction((tx) => fn(new PrismaAuthRepository(this.prisma, tx)));
  }
}
