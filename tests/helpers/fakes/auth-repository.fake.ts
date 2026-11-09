import { randomUUID } from "node:crypto";
import type { Session, User } from "@/generated/prisma/client";
import type { AuthRepository, NewUser, SessionMeta } from "@/modules/auth/auth.repository";

/** In-memory AuthRepository for unit tests. Unique (tenantId, email) is enforced like the DB would. */
export class FakeAuthRepository implements AuthRepository {
  users: User[] = [];
  sessions: Session[] = [];
  refreshTokens: { sessionId: string; tokenHash: string; expiresAt: Date }[] = [];

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
      createdAt: new Date(),
      lastUsedAt: new Date(),
      expiresAt,
      revokedAt: null,
      revokedReason: null,
    };
    this.sessions.push(s);
    return Promise.resolve(s);
  }

  createRefreshToken(sessionId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.refreshTokens.push({ sessionId, tokenHash, expiresAt });
    return Promise.resolve();
  }

  transaction<T>(fn: (repo: AuthRepository) => Promise<T>): Promise<T> {
    return fn(this);
  }
}
