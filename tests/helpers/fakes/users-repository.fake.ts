import type { User } from "@/generated/prisma/client";
import type { DeleteGuard, UsersRepository, UsersTx } from "@/modules/users/users.repository";
import type { FakeAuthRepository } from "./auth-repository.fake";

/** In-memory UsersRepository sharing its rows (users, sessions) with a FakeAuthRepository. */
export class FakeUsersRepository implements UsersRepository {
  private readonly users: User[];

  constructor(private readonly auth: FakeAuthRepository) {
    this.users = auth.users;
  }

  findById(tenantId: string, id: string): Promise<User | null> {
    return Promise.resolve(this.users.find((u) => u.tenantId === tenantId && u.id === id) ?? null);
  }

  updateProfile(
    tenantId: string,
    id: string,
    data: { firstName?: string | null; lastName?: string | null },
  ): Promise<User> {
    const u = this.users.find((x) => x.tenantId === tenantId && x.id === id);
    if (!u) return Promise.reject(new Error("no user"));
    Object.assign(u, data);
    return Promise.resolve(u);
  }

  updatePassword(tenantId: string, id: string, passwordHash: string, now: Date): Promise<void> {
    const u = this.users.find((x) => x.tenantId === tenantId && x.id === id);
    if (u) {
      u.passwordHash = passwordHash;
      u.passwordChangedAt = now;
    }
    return Promise.resolve();
  }

  /** Mirrors the DB cascades: the user's sessions, their refresh tokens and reset tokens go too. */
  deleteUser(tenantId: string, id: string, guard: DeleteGuard): Promise<boolean> {
    const i = this.users.findIndex(
      (u) =>
        u.tenantId === tenantId &&
        u.id === id &&
        u.passwordChangedAt.getTime() === guard.passwordChangedAt.getTime() &&
        this.auth.sessions.some(
          (s) => s.id === guard.sessionId && s.userId === id && s.revokedAt === null,
        ),
    );
    if (i === -1) return Promise.resolve(false);
    this.users.splice(i, 1);
    const a = this.auth;
    const gone = new Set(a.sessions.filter((s) => s.userId === id).map((s) => s.id));
    a.sessions.splice(0, a.sessions.length, ...a.sessions.filter((s) => !gone.has(s.id)));
    a.refreshTokens.splice(
      0,
      a.refreshTokens.length,
      ...a.refreshTokens.filter((t) => !gone.has(t.sessionId)),
    );
    a.resetTokens.splice(0, a.resetTokens.length, ...a.resetTokens.filter((t) => t.userId !== id));
    return Promise.resolve(true);
  }

  transaction<T>(fn: (tx: UsersTx) => Promise<T>): Promise<T> {
    return fn({ users: this, sessions: this.auth });
  }
}
