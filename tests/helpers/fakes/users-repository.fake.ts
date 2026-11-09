import type { User } from "@/generated/prisma/client";
import type { UsersRepository, UsersTx } from "@/modules/users/users.repository";
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

  transaction<T>(fn: (tx: UsersTx) => Promise<T>): Promise<T> {
    return fn({ users: this, sessions: this.auth });
  }
}
