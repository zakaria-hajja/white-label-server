import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDeps } from "../../../helpers/fakes/reset-deps";
import { FakeAuthRepository } from "../../../helpers/fakes/auth-repository.fake";
import * as password from "@/core/auth/password";
import { AppError } from "@/core/errors/app-error";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { AuthService } from "@/modules/auth/auth.service";

const TENANT: TenantContext = { tenantId: "t-1", slug: "acme", name: "Acme", source: "header" };
const cfg = {
  jwt: {
    secret: new TextEncoder().encode("test-jwt-secret-test-jwt-secret-0123456789"),
    issuer: "whitelabel-api",
    audience: "whitelabel-api" as const,
    accessTtlSeconds: 900,
  },
  sessionTtlDays: 30,
};
const META = { userAgent: "UA", ip: "unknown" };
const GOOD = "correct-horse-1";

let now = new Date("2026-01-01T00:00:00Z");
const clock = { now: () => now };
let repo: FakeAuthRepository;
let service: AuthService;

async function failMany(n: number) {
  for (let i = 0; i < n; i++) {
    await expect(
      service.login(TENANT, { email: "a@b.co", password: "wrong-password" }, META),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  }
}

beforeEach(async () => {
  now = new Date("2026-01-01T00:00:00Z");
  repo = new FakeAuthRepository();
  service = new AuthService(repo, cfg, clock, resetDeps);
  await service.register(TENANT, { email: "a@b.co", password: GOOD }, META);
  vi.restoreAllMocks();
});

describe("AuthService.login", () => {
  it("returns user and tokens for correct credentials", async () => {
    const r = await service.login(TENANT, { email: "a@b.co", password: GOOD }, META);
    expect(r.user.email).toBe("a@b.co");
    expect(r.tokens).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
    expect(JSON.stringify(r)).not.toContain("passwordHash");
  });

  it("increments the failure count on a wrong password", async () => {
    await failMany(1);
    expect(repo.users[0]?.failedLoginCount).toBe(1);
  });

  it("locks for 15 minutes on the 10th failure", async () => {
    await failMany(9);
    expect(repo.users[0]?.lockedUntil).toBeNull();
    await failMany(1);
    expect(repo.users[0]?.lockedUntil).toEqual(new Date(now.getTime() + 15 * 60_000));
  });

  it("rejects the correct password while locked, without incrementing", async () => {
    await failMany(10);
    await expect(
      service.login(TENANT, { email: "a@b.co", password: GOOD }, META),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await failMany(1);
    expect(repo.users[0]?.failedLoginCount).toBe(10);
  });

  it("succeeds after the lock expires and resets the counter", async () => {
    await failMany(10);
    now = new Date(now.getTime() + 15 * 60_000 + 1);
    await service.login(TENANT, { email: "a@b.co", password: GOOD }, META);
    expect(repo.users[0]).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("starts a fresh count after the lock expires and does not re-lock", async () => {
    await failMany(10);
    now = new Date(now.getTime() + 15 * 60_000 + 1);
    await failMany(1);
    expect(repo.users[0]).toMatchObject({ failedLoginCount: 1, lockedUntil: null });
    await service.login(TENANT, { email: "a@b.co", password: GOOD }, META);
    expect(repo.users[0]).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
  });

  it("runs dummyVerify and returns INVALID_CREDENTIALS for an unknown email", async () => {
    const spy = vi.spyOn(password, "dummyVerify");
    const err = await service
      .login(TENANT, { email: "nobody@b.co", password: GOOD }, META)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns INVALID_CREDENTIALS for a DISABLED user", async () => {
    if (repo.users[0]) repo.users[0].status = "DISABLED";
    await expect(
      service.login(TENANT, { email: "a@b.co", password: GOOD }, META),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("stores truncated user agent, null ip for unknown, and matching expiries", async () => {
    await service.login(
      TENANT,
      { email: "a@b.co", password: GOOD },
      { userAgent: "x".repeat(600), ip: "unknown" },
    );
    const s = repo.sessions.at(-1);
    expect(s?.userAgent).toHaveLength(512);
    expect(s?.ipAddress).toBeNull();
    expect(s?.expiresAt).toEqual(new Date(now.getTime() + 30 * 86_400_000));
    expect(repo.refreshTokens.at(-1)?.expiresAt).toEqual(s?.expiresAt);
  });
});

describe("AuthService.register", () => {
  it("maps a duplicate email to EMAIL_ALREADY_REGISTERED", async () => {
    await expect(
      service.register(TENANT, { email: "a@b.co", password: GOOD }, META),
    ).rejects.toMatchObject({ code: "EMAIL_ALREADY_REGISTERED" });
  });
});
