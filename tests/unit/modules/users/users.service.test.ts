import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuthRepository } from "../../../helpers/fakes/auth-repository.fake";
import { FakeUsersRepository } from "../../../helpers/fakes/users-repository.fake";
import { verifyPassword } from "@/core/auth/password";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { AuthService } from "@/modules/auth/auth.service";
import { UsersService } from "@/modules/users/users.service";
import { updateMeBody, changePasswordBody, deleteMeBody } from "@/modules/users/users.schemas";

const A: TenantContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  slug: "a",
  name: "A",
  source: "header",
};
const B: TenantContext = { ...A, tenantId: "00000000-0000-4000-8000-00000000000b", slug: "b" };
const OLD = "correct-horse-1";
const NEW = "brand-new-pass-2";
const now = new Date("2026-01-01T00:00:00Z");
const clock = { now: () => now };
const cfg = {
  jwt: {
    secret: new TextEncoder().encode("test-jwt-secret-test-jwt-secret-0123456789"),
    issuer: "whitelabel-api",
    audience: "whitelabel-api" as const,
    accessTtlSeconds: 900,
  },
  sessionTtlDays: 30,
};

let authRepo: FakeAuthRepository;
let service: UsersService;
let auth: { userId: string; tenantId: string; sessionId: string };

async function rejects(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

beforeEach(async () => {
  authRepo = new FakeAuthRepository(clock.now);
  const authService = new AuthService(authRepo, cfg, clock, {} as never);
  await authService.register(
    A,
    { email: "a@b.co", password: OLD },
    { userAgent: null, ip: "unknown" },
  );
  const user = authRepo.users[0]!;
  const session = authRepo.sessions[0]!;
  auth = { userId: user.id, tenantId: A.tenantId, sessionId: session.id };
  service = new UsersService(new FakeUsersRepository(authRepo), clock);
});

describe("schemas", () => {
  it("updateMe: strict, at least one key, trimmed, null allowed", () => {
    expect(updateMeBody.safeParse({}).success).toBe(false);
    expect(updateMeBody.safeParse({ email: "x@y.co" }).success).toBe(false);
    expect(updateMeBody.safeParse({ firstName: "Ann", tenantId: "x" }).success).toBe(false);
    expect(updateMeBody.safeParse({ firstName: "  " }).success).toBe(false);
    expect(updateMeBody.safeParse({ firstName: "x".repeat(51) }).success).toBe(false);
    expect(updateMeBody.parse({ firstName: " Ann ", lastName: null })).toEqual({
      firstName: "Ann",
      lastName: null,
    });
  });
  it("changePassword: strict, policy on new only", () => {
    expect(
      changePasswordBody.safeParse({ currentPassword: "x", newPassword: "short" }).success,
    ).toBe(false);
    expect(changePasswordBody.safeParse({ currentPassword: "", newPassword: NEW }).success).toBe(
      false,
    );
    expect(
      changePasswordBody.safeParse({ currentPassword: "x", newPassword: NEW, a: 1 }).success,
    ).toBe(false);
    expect(changePasswordBody.safeParse({ currentPassword: "x", newPassword: NEW }).success).toBe(
      true,
    );
  });
});

describe("getMe / updateMe", () => {
  it("returns the DTO without secrets", async () => {
    const dto = await service.getMe(A, auth);
    expect(dto.email).toBe("a@b.co");
    expect(JSON.stringify(dto)).not.toContain("passwordHash");
  });

  it("404 when the user no longer exists", async () => {
    authRepo.users.length = 0;
    await rejects(service.getMe(A, auth), "NOT_FOUND");
  });

  it("updates only the given fields; null clears", async () => {
    await service.updateMe(A, auth, { firstName: "Ann", lastName: "Lee" });
    const dto = await service.updateMe(A, auth, { lastName: null });
    expect(dto.firstName).toBe("Ann");
    expect(dto.lastName).toBeNull();
  });

  it("does not touch a user of another tenant", async () => {
    await rejects(
      service.updateMe(B, { ...auth, tenantId: B.tenantId }, { firstName: "X" }),
      "NOT_FOUND",
    );
    expect(authRepo.users[0]!.firstName).toBeNull();
  });
});

describe("changePassword", () => {
  it("wrong current password -> INVALID_CREDENTIALS, nothing changes", async () => {
    await rejects(
      service.changePassword(A, auth, { currentPassword: "nope-nope-1", newPassword: NEW }),
      "INVALID_CREDENTIALS",
    );
    expect(await verifyPassword(authRepo.users[0]!.passwordHash, OLD)).toBe(true);
  });

  it("new === current -> VALIDATION_ERROR", async () => {
    await rejects(
      service.changePassword(A, auth, { currentPassword: OLD, newPassword: OLD }),
      "VALIDATION_ERROR",
    );
  });

  it("updates the hash and revokes every other session, keeping the current one", async () => {
    const other = await authRepo.createSession(
      A.tenantId,
      auth.userId,
      { userAgent: null, ip: null },
      new Date(now.getTime() + 1e9),
    );
    await service.changePassword(A, auth, { currentPassword: OLD, newPassword: NEW });
    expect(await verifyPassword(authRepo.users[0]!.passwordHash, NEW)).toBe(true);
    expect(authRepo.users[0]!.passwordChangedAt).toEqual(now);
    const current = authRepo.sessions.find((s) => s.id === auth.sessionId)!;
    const revoked = authRepo.sessions.find((s) => s.id === other.id)!;
    expect(current.revokedAt).toBeNull();
    expect(revoked.revokedAt).toEqual(now);
    expect(revoked.revokedReason).toBe("password_changed");
  });

  it("404 when the user no longer exists", async () => {
    authRepo.users.length = 0;
    await rejects(
      service.changePassword(A, auth, { currentPassword: OLD, newPassword: NEW }),
      "NOT_FOUND",
    );
  });
});

describe("deleteMe", () => {
  it("schema: strict, password 1-128 chars", () => {
    expect(deleteMeBody.safeParse({ password: "x" }).success).toBe(true);
    expect(deleteMeBody.safeParse({ password: "" }).success).toBe(false);
    expect(deleteMeBody.safeParse({ password: "x".repeat(129) }).success).toBe(false);
    expect(deleteMeBody.safeParse({}).success).toBe(false);
    expect(deleteMeBody.safeParse({ password: "x", userId: "u" }).success).toBe(false);
  });

  it("a wrong password -> INVALID_CREDENTIALS and nothing is deleted", async () => {
    await rejects(
      service.deleteMe(A, auth, { password: "wrong-password-1" }),
      "INVALID_CREDENTIALS",
    );
    expect(authRepo.users).toHaveLength(1);
  });

  it("the correct password deletes exactly the caller's user", async () => {
    const repo = new FakeUsersRepository(authRepo);
    const spy = vi.spyOn(repo, "deleteUser");
    await new UsersService(repo, clock).deleteMe(A, auth, { password: OLD });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(A.tenantId, auth.userId, {
      passwordChangedAt: expect.any(Date),
      sessionId: auth.sessionId,
    });
    expect(authRepo.users).toHaveLength(0);
  });

  it("a user of another tenant is NOT_FOUND and nothing is deleted", async () => {
    await rejects(
      service.deleteMe(B, { ...auth, tenantId: B.tenantId }, { password: OLD }),
      "NOT_FOUND",
    );
    expect(authRepo.users).toHaveLength(1);
  });

  it("an unknown user -> NOT_FOUND", async () => {
    await rejects(
      service.deleteMe(
        A,
        { ...auth, userId: "00000000-0000-4000-8000-0000000000ff" },
        { password: OLD },
      ),
      "NOT_FOUND",
    );
  });
});

describe("deleteMe races (the delete is conditional on what was verified)", () => {
  /** findById returns the row as it was when the password was checked; the store moves on. */
  function staleRead(mutate: () => void): UsersService {
    const repo = new FakeUsersRepository(authRepo);
    const original = repo.findById.bind(repo);
    vi.spyOn(repo, "findById").mockImplementation(async (t, id) => {
      const u = await original(t, id);
      const snapshot = u ? { ...u } : null;
      mutate();
      return snapshot;
    });
    return new UsersService(repo, clock);
  }

  it("a password change that commits mid-delete wins: INVALID_CREDENTIALS, user kept", async () => {
    const svc = staleRead(() => {
      authRepo.users[0]!.passwordChangedAt = new Date(now.getTime() + 1000);
    });
    await rejects(svc.deleteMe(A, auth, { password: OLD }), "INVALID_CREDENTIALS");
    expect(authRepo.users).toHaveLength(1);
  });

  it("the caller's session revoked mid-delete: UNAUTHENTICATED, user kept", async () => {
    const svc = staleRead(() => {
      authRepo.sessions[0]!.revokedAt = now;
    });
    await rejects(svc.deleteMe(A, auth, { password: OLD }), "UNAUTHENTICATED");
    expect(authRepo.users).toHaveLength(1);
  });

  it("the account deleted mid-delete (a double submit) succeeds", async () => {
    const svc = staleRead(() => {
      authRepo.users.splice(0, 1);
    });
    await expect(svc.deleteMe(A, auth, { password: OLD })).resolves.toBeUndefined();
  });
});
