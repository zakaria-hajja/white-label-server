import { randomUUID } from "node:crypto";
import type { PasswordResetToken, RefreshToken, Session, User } from "@/generated/prisma/client";
import type {
  AuthRepository,
  NewUser,
  RefreshTokenWithSession,
  SessionMeta,
} from "@/modules/auth/auth.repository";

/** In-memory AuthRepository for unit tests. Unique (tenantId, email) is enforced like the DB would. */
export class FakeAuthRepository implements AuthRepository {
  users: User[] = [];
  sessions: Session[] = [];
  refreshTokens: RefreshToken[] = [];
  resetTokens: PasswordResetToken[] = [];

  /** `now` stamps createdAt/lastUsedAt of sessions so tests can drive them with a fake clock. */
  constructor(private readonly now: () => Date = () => new Date()) {}

  findUserByEmail(tenantId: string, email: string): Promise<User | null> {
    return Promise.resolve(
      this.users.find((u) => u.tenantId === tenantId && u.email === email) ?? null,
    );
  }

  findUserById(tenantId: string, id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.tenantId === tenantId && u.id === id) ?? null);
  }

  createUser(tenantId: string, data: NewUser): Promise<User> {
    if (this.users.some((u) => u.tenantId === tenantId && u.email === data.email)) {
      return Promise.reject(Object.assign(new Error("unique"), { code: "P2002" }));
    }
    const user: User = {
      id: randomUUID(),
      tenantId,
      ...data,
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
      passwordChangedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.push(user);
    return Promise.resolve(user);
  }

  recordFailedLogin(
    tenantId: string,
    userId: string,
    maxFailures: number,
    lockUntil: Date,
  ): Promise<number> {
    const u = this.users.find((x) => x.tenantId === tenantId && x.id === userId);
    if (!u) return Promise.reject(new Error("no user"));
    u.failedLoginCount += 1;
    if (u.failedLoginCount >= maxFailures) u.lockedUntil = lockUntil;
    return Promise.resolve(u.failedLoginCount);
  }

  resetFailedLogins(tenantId: string, userId: string): Promise<void> {
    const u = this.users.find((x) => x.tenantId === tenantId && x.id === userId);
    if (u) {
      u.failedLoginCount = 0;
      u.lockedUntil = null;
    }
    return Promise.resolve();
  }

  createSession(
    tenantId: string,
    userId: string,
    meta: SessionMeta,
    expiresAt: Date,
  ): Promise<Session> {
    const s: Session = {
      id: randomUUID(),
      tenantId,
      userId,
      userAgent: meta.userAgent,
      ipAddress: meta.ip,
      createdAt: this.now(),
      lastUsedAt: this.now(),
      expiresAt,
      revokedAt: null,
      revokedReason: null,
    };
    this.sessions.push(s);
    return Promise.resolve(s);
  }

  createRefreshToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<string> {
    const id = randomUUID();
    this.refreshTokens.push({
      id,
      sessionId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: this.now(),
      replacedById: null,
      supersededAt: null,
    });
    return Promise.resolve(id);
  }

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenWithSession | null> {
    const token = this.refreshTokens.find((t) => t.tokenHash === tokenHash);
    const session = token && this.sessions.find((s) => s.id === token.sessionId);
    return Promise.resolve(token && session ? { token, session } : null);
  }

  claimRefreshToken(id: string, now: Date): Promise<boolean> {
    const token = this.refreshTokens.find((t) => t.id === id);
    if (!token || token.usedAt !== null || token.supersededAt !== null) {
      return Promise.resolve(false);
    }
    token.usedAt = now;
    return Promise.resolve(true);
  }

  supersedeRefreshToken(id: string, now: Date): Promise<boolean> {
    const token = this.refreshTokens.find((t) => t.id === id);
    if (!token || token.usedAt !== null || token.supersededAt !== null) {
      return Promise.resolve(false);
    }
    token.supersededAt = now;
    return Promise.resolve(true);
  }

  setRefreshTokenReplacement(id: string, replacedById: string): Promise<void> {
    const token = this.refreshTokens.find((t) => t.id === id);
    if (token) token.replacedById = replacedById;
    return Promise.resolve();
  }

  touchSession(tenantId: string, sessionId: string, now: Date): Promise<void> {
    const s = this.sessions.find((x) => x.id === sessionId && x.tenantId === tenantId);
    if (s) s.lastUsedAt = now;
    return Promise.resolve();
  }

  revokeSession(tenantId: string, sessionId: string, reason: string, now: Date): Promise<void> {
    const s = this.sessions.find((x) => x.id === sessionId && x.tenantId === tenantId);
    if (s && s.revokedAt === null) {
      s.revokedAt = now;
      s.revokedReason = reason;
    }
    return Promise.resolve();
  }

  revokeAllSessions(
    tenantId: string,
    userId: string,
    reason: string,
    now: Date,
    exceptSessionId?: string,
  ): Promise<void> {
    for (const s of this.sessions) {
      if (s.tenantId === tenantId && s.userId === userId && s.revokedAt === null) {
        if (s.id !== exceptSessionId) {
          s.revokedAt = now;
          s.revokedReason = reason;
        }
      }
    }
    return Promise.resolve();
  }

  listActiveSessions(tenantId: string, userId: string, now: Date): Promise<Session[]> {
    return Promise.resolve(
      this.sessions
        .filter(
          (s) =>
            s.tenantId === tenantId &&
            s.userId === userId &&
            s.revokedAt === null &&
            s.expiresAt > now,
        )
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()),
    );
  }

  findSession(tenantId: string, userId: string, sessionId: string): Promise<Session | null> {
    return Promise.resolve(
      this.sessions.find(
        (s) => s.id === sessionId && s.tenantId === tenantId && s.userId === userId,
      ) ?? null,
    );
  }

  createResetToken(
    tenantId: string,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    this.resetTokens.push({
      id: randomUUID(),
      tenantId,
      userId,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: this.now(),
    });
    return Promise.resolve();
  }

  invalidateResetTokens(tenantId: string, userId: string, now: Date): Promise<void> {
    for (const t of this.resetTokens) {
      if (t.tenantId === tenantId && t.userId === userId && t.usedAt === null) t.usedAt = now;
    }
    return Promise.resolve();
  }

  findResetTokenByHash(tenantId: string, tokenHash: string): Promise<PasswordResetToken | null> {
    return Promise.resolve(
      this.resetTokens.find((t) => t.tenantId === tenantId && t.tokenHash === tokenHash) ?? null,
    );
  }

  consumeResetToken(tenantId: string, id: string, now: Date): Promise<boolean> {
    const t = this.resetTokens.find((x) => x.id === id && x.tenantId === tenantId);
    if (!t || t.usedAt !== null || t.expiresAt <= now) return Promise.resolve(false);
    t.usedAt = now;
    return Promise.resolve(true);
  }

  updatePassword(tenantId: string, userId: string, passwordHash: string, now: Date): Promise<void> {
    const u = this.users.find((x) => x.tenantId === tenantId && x.id === userId);
    if (u) {
      u.passwordHash = passwordHash;
      u.passwordChangedAt = now;
      u.failedLoginCount = 0;
      u.lockedUntil = null;
    }
    return Promise.resolve();
  }

  transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
