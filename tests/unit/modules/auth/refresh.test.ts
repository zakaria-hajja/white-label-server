import { beforeEach, describe, expect, it } from "vitest";
import { resetDeps } from "../../../helpers/fakes/reset-deps";
import { FakeAuthRepository } from "../../../helpers/fakes/auth-repository.fake";
import { verifyAccessToken } from "@/core/auth/jwt";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { AuthService } from "@/modules/auth/auth.service";

const A: TenantContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  slug: "a",
  name: "A",
  source: "header",
};
const B: TenantContext = {
  tenantId: "00000000-0000-4000-8000-00000000000b",
  slug: "b",
  name: "B",
  source: "header",
};
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

let now = new Date("2026-01-01T00:00:00Z");
const clock = { now: () => now };
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
let repo: FakeAuthRepository;
let service: AuthService;
let first: string;

beforeEach(async () => {
  now = new Date("2026-01-01T00:00:00Z");
  repo = new FakeAuthRepository(clock.now);
  service = new AuthService(repo, cfg, clock, resetDeps);
  const r = await service.register(A, { email: "a@b.co", password: "correct-horse-1" }, META);
  first = r.tokens.refreshToken;
});

describe("AuthService.refresh", () => {
  it("returns a new pair with the same sid, marks the old token used, new token works once", async () => {
    advance(60_000);
    const pair = await service.refresh(A, first);
    expect(pair.refreshToken).not.toBe(first);
    expect(pair).toMatchObject({ tokenType: "Bearer", expiresIn: 900 });
    const claims = await verifyAccessToken(cfg.jwt, pair.accessToken, now);
    expect(claims.sid).toBe(repo.sessions[0]?.id);
    expect(repo.refreshTokens[0]?.usedAt).toEqual(now);
    expect(repo.sessions[0]?.lastUsedAt).toEqual(now);
    // New token keeps the session's absolute expiry.
    expect(repo.refreshTokens[1]?.expiresAt).toEqual(repo.sessions[0]?.expiresAt);
    await service.refresh(A, pair.refreshToken);
    await expect(service.refresh(A, pair.refreshToken)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("rejects an unknown token", async () => {
    await expect(service.refresh(A, "nope")).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("reuse within 10 s is rejected but keeps the session and the new token", async () => {
    const pair = await service.refresh(A, first);
    advance(5_000);
    await expect(service.refresh(A, first)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
    expect(repo.sessions[0]?.revokedAt).toBeNull();
    await expect(service.refresh(A, pair.refreshToken)).resolves.toBeDefined();
  });

  it("reuse after 10 s revokes the session (refresh_token_reuse)", async () => {
    const pair = await service.refresh(A, first);
    advance(11_000);
    await expect(service.refresh(A, first)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
    expect(repo.sessions[0]?.revokedAt).toEqual(now);
    expect(repo.sessions[0]?.revokedReason).toBe("refresh_token_reuse");
    await expect(service.refresh(A, pair.refreshToken)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("rejects when the session has expired", async () => {
    advance(31 * 86_400_000);
    await expect(service.refresh(A, first)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("rejects a token presented under another tenant without revoking its session", async () => {
    await expect(service.refresh(B, first)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
    expect(repo.sessions[0]?.revokedAt).toBeNull();
    await expect(service.refresh(A, first)).resolves.toBeDefined();
  });

  it("rejects when the user is not ACTIVE", async () => {
    const u = repo.users[0];
    if (u) u.status = "DISABLED";
    await expect(service.refresh(A, first)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });

  it("rejects a revoked session", async () => {
    await service.logout(A, first);
    await expect(service.refresh(A, first)).rejects.toMatchObject({
      code: "INVALID_REFRESH_TOKEN",
    });
  });
});

describe("AuthService.logout", () => {
  it("revokes the session with reason logout; idempotent; unknown token is a no-op", async () => {
    await service.logout(A, first);
    expect(repo.sessions[0]?.revokedReason).toBe("logout");
    const at = repo.sessions[0]?.revokedAt;
    advance(1000);
    await service.logout(A, first);
    expect(repo.sessions[0]?.revokedAt).toEqual(at);
    await expect(service.logout(A, "unknown")).resolves.toBeUndefined();
  });

  it("does not revoke a session of another tenant", async () => {
    await service.logout(B, first);
    expect(repo.sessions[0]?.revokedAt).toBeNull();
  });
});

describe("AuthService sessions/me", () => {
  it("lists active sessions newest first with current flag, no ip", async () => {
    const auth = { userId: repo.users[0]?.id ?? "", tenantId: A.tenantId, sessionId: "" };
    advance(1000);
    await service.login(A, { email: "a@b.co", password: "correct-horse-1" }, META);
    advance(1000);
    await service.login(A, { email: "a@b.co", password: "correct-horse-1" }, META);
    const [s0, s1, s2] = repo.sessions;
    const list = await service.listSessions(A, { ...auth, sessionId: s1?.id ?? "" });
    expect(list.map((s) => s.id)).toEqual([s2?.id, s1?.id, s0?.id]);
    expect(list.filter((s) => s.current).map((s) => s.id)).toEqual([s1?.id]);
    expect(JSON.stringify(list)).not.toContain("ipAddress");
    // revoked sessions are hidden
    await service.revokeSession(A, { ...auth, sessionId: s1?.id ?? "" }, s2?.id ?? "");
    expect(await service.listSessions(A, { ...auth, sessionId: s1?.id ?? "" })).toHaveLength(2);
  });

  it("revokeSession: other tenant or user -> NOT_FOUND; repeat is idempotent; current allowed", async () => {
    const s = repo.sessions[0];
    const auth = { userId: repo.users[0]?.id ?? "", tenantId: A.tenantId, sessionId: s?.id ?? "" };
    await expect(
      service.revokeSession(B, { ...auth, tenantId: B.tenantId }, s?.id ?? ""),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.revokeSession(A, { ...auth, userId: "someone-else" }, s?.id ?? ""),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await service.revokeSession(A, auth, s?.id ?? "");
    expect(s?.revokedReason).toBe("user_revoked");
    await expect(service.revokeSession(A, auth, s?.id ?? "")).resolves.toBeUndefined();
  });

  it("me returns user, tenant and session", async () => {
    const s = repo.sessions[0];
    const auth = { userId: repo.users[0]?.id ?? "", tenantId: A.tenantId, sessionId: s?.id ?? "" };
    const me = await service.me(A, auth);
    expect(me.user.email).toBe("a@b.co");
    expect(me.tenant).toEqual({ slug: "a", name: "A" });
    expect(me.session).toEqual({ id: s?.id, expiresAt: s?.expiresAt.toISOString() });
  });
});
