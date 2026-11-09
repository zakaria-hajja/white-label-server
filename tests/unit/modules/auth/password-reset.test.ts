import { beforeEach, describe, expect, it } from "vitest";
import { pino } from "pino";
import { FakeAuthRepository } from "../../../helpers/fakes/auth-repository.fake";
import { RecordingMailer } from "../../../helpers/fakes/recording-mailer";
import { hashToken } from "@/core/auth/tokens";
import { verifyPassword } from "@/core/auth/password";
import type { TenantContext } from "@/core/tenant/tenant-context";
import { defaultAppConfig } from "@/core/tenant/tenant-admin.service";
import { AuthService } from "@/modules/auth/auth.service";
import { buildResetLink } from "@/modules/auth/reset-link";
import { ConsoleMailer } from "@/modules/mail/console-mailer";
import type { AppConfigReader } from "@/modules/app-config/app-config.reader";

const A: TenantContext = {
  tenantId: "00000000-0000-4000-8000-00000000000a",
  slug: "a",
  name: "A",
  source: "header",
};
const B: TenantContext = { ...A, tenantId: "00000000-0000-4000-8000-00000000000b", slug: "b" };
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
const OLD = "correct-horse-1";
const NEW = "brand-new-pass-2";

let now = new Date("2026-01-01T00:00:00Z");
const clock = { now: () => now };
const advance = (ms: number) => {
  now = new Date(now.getTime() + ms);
};
let repo: FakeAuthRepository;
let mailer: RecordingMailer;
let service: AuthService;
const silent = pino({ level: "silent" });
const appConfig: AppConfigReader = {
  getDocument: () => Promise.resolve(defaultAppConfig("A")),
};

beforeEach(async () => {
  now = new Date("2026-01-01T00:00:00Z");
  repo = new FakeAuthRepository(clock.now);
  mailer = new RecordingMailer();
  service = new AuthService(repo, cfg, clock, {
    passwordResetTtlMinutes: 30,
    appConfig,
    mailer,
    logger: silent,
  });
  await service.register(A, { email: "a@b.co", password: OLD }, META);
});

describe("buildResetLink", () => {
  it("handles custom schemes and preserves an existing query string", () => {
    expect(buildResetLink("acme://reset", "tok")).toBe("acme://reset?token=tok");
    const u = new URL(buildResetLink("https://x/reset?a=1", "t k"));
    expect(u.searchParams.get("a")).toBe("1");
    expect(u.searchParams.get("token")).toBe("t k");
  });
});

describe("ConsoleMailer", () => {
  const input = {
    to: "a@b.co",
    tenantName: "A",
    resetLink: "https://x/r?token=SECRET",
    expiresAt: new Date(0),
  };
  const capture = () => {
    const lines: string[] = [];
    const logger = pino({ level: "info" }, { write: (s: string) => void lines.push(s) });
    return { lines, logger };
  };

  it("logs the link outside production", async () => {
    const { lines, logger } = capture();
    await new ConsoleMailer(logger, "development").sendPasswordReset(input);
    expect(lines.join("")).toContain("token=SECRET");
  });

  it("logs neither link nor email in production", async () => {
    const { lines, logger } = capture();
    await new ConsoleMailer(logger, "production").sendPasswordReset(input);
    const out = lines.join("");
    expect(out).toContain("reset email suppressed: no mail provider");
    expect(out).not.toContain("SECRET");
    expect(out).not.toContain("a@b.co");
  });
});

describe("AuthService.forgotPassword", () => {
  it("creates a token (hash stored, 30 min expiry) and mails the link for an active user", async () => {
    await service.forgotPassword(A, "a@b.co");
    expect(mailer.sent).toHaveLength(1);
    const token = mailer.lastToken();
    const row = repo.resetTokens[0];
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(row?.expiresAt).toEqual(new Date(now.getTime() + 30 * 60_000));
    expect(mailer.sent[0]?.to).toBe("a@b.co");
  });

  it("does nothing for an unknown email, another tenant's user, or a disabled user", async () => {
    await service.forgotPassword(A, "nobody@b.co");
    await service.forgotPassword(B, "a@b.co");
    const u = repo.users[0];
    if (u) u.status = "DISABLED";
    await service.forgotPassword(A, "a@b.co");
    expect(mailer.sent).toHaveLength(0);
    expect(repo.resetTokens).toHaveLength(0);
  });

  it("invalidates the previous unused token", async () => {
    await service.forgotPassword(A, "a@b.co");
    const first = mailer.lastToken();
    await service.forgotPassword(A, "a@b.co");
    await expect(service.resetPassword(A, first, NEW)).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
    });
    await service.resetPassword(A, mailer.lastToken(), NEW);
  });

  it("still resolves when the mailer fails", async () => {
    mailer.fail = true;
    await expect(service.forgotPassword(A, "a@b.co")).resolves.toBeUndefined();
  });
});

describe("AuthService.resetPassword", () => {
  it("sets the password, clears lockout, revokes sessions, and consumes the token", async () => {
    const u = repo.users[0];
    if (!u) throw new Error("no user");
    u.failedLoginCount = 7;
    u.lockedUntil = new Date(now.getTime() + 60_000);
    await service.forgotPassword(A, "a@b.co");
    advance(1000);
    await service.resetPassword(A, mailer.lastToken(), NEW);
    expect(await verifyPassword(u.passwordHash, NEW)).toBe(true);
    expect(u.failedLoginCount).toBe(0);
    expect(u.lockedUntil).toBeNull();
    expect(u.passwordChangedAt).toEqual(now);
    expect(repo.sessions.every((s) => s.revokedReason === "password_reset")).toBe(true);
    await expect(service.resetPassword(A, mailer.lastToken(), NEW)).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
    });
  });

  it("rejects an unknown token", async () => {
    await expect(service.resetPassword(A, "nope", NEW)).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
    });
  });

  it("rejects an expired token (exactly at expiry too)", async () => {
    await service.forgotPassword(A, "a@b.co");
    advance(30 * 60_000);
    await expect(service.resetPassword(A, mailer.lastToken(), NEW)).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
    });
  });

  it("rejects another tenant's token without consuming it", async () => {
    await service.forgotPassword(A, "a@b.co");
    const token = mailer.lastToken();
    await expect(service.resetPassword(B, token, NEW)).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
    });
    expect(repo.resetTokens[0]?.usedAt).toBeNull();
    await service.resetPassword(A, token, NEW);
  });

  it("rejects when the user was disabled after the token was issued", async () => {
    await service.forgotPassword(A, "a@b.co");
    const u = repo.users[0];
    if (u) u.status = "DISABLED";
    await expect(service.resetPassword(A, mailer.lastToken(), NEW)).rejects.toMatchObject({
      code: "INVALID_RESET_TOKEN",
    });
  });
});
