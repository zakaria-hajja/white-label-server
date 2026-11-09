import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { RecordingMailer } from "../../helpers/fakes/recording-mailer";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as forgot } from "@/app/api/v1/auth/forgot-password/route";
import { POST as reset } from "@/app/api/v1/auth/reset-password/route";

const config = loadConfig(process.env);
const OLD = "correct-horse-1";
const NEW = "brand-new-pass-2";
let now = new Date();
const clock = { now: () => now };
let mailer: RecordingMailer;

const req = (body: unknown, tenant = "acme") =>
  new Request("http://localhost/api/v1/auth/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-client-id": tenant },
  });
const noParams = { params: Promise.resolve({}) };
const doForgot = (email: string, tenant = "acme") => forgot(req({ email }, tenant), noParams);
const doReset = (token: string, newPassword = NEW, tenant = "acme") =>
  reset(req({ token, newPassword }, tenant), noParams);
const doLogin = (password: string, email = "a@x.co") => login(req({ email, password }), noParams);

beforeEach(async () => {
  await resetDb();
  now = new Date();
  mailer = new RecordingMailer();
  setContainer(createContainer(config, { prisma: testPrisma(), clock, mailer }));
  // Real tenants with their default app config (reset link base URL).
  const admin = new TenantAdminService(testPrisma());
  await admin.create({ slug: "acme", name: "Acme" });
  await admin.create({ slug: "globex", name: "Globex" });
});

async function signup(email = "a@x.co") {
  const res = await register(req({ email, password: OLD }), noParams);
  return (await envelope(res)).data?.tokens as { refreshToken: string };
}

describe("forgot-password", () => {
  it("returns an identical 202 for known and unknown emails; mails only the known one", async () => {
    await signup();
    const known = await doForgot("a@x.co");
    const knownBody = await envelope(known);
    const unknown = await doForgot("nobody@x.co");
    const unknownBody = await envelope(unknown);
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(knownBody.data).toEqual({});
    expect(unknownBody.data).toEqual(knownBody.data);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.resetLink).toMatch(/^https:\/\/example\.com\/reset-password\?token=/);
    expect(await testPrisma().passwordResetToken.count()).toBe(1);
  });

  it("does not mail or create a token for a disabled user", async () => {
    await signup();
    await testPrisma().user.updateMany({ data: { status: "DISABLED" } });
    expect((await doForgot("a@x.co")).status).toBe(202);
    expect(mailer.sent).toHaveLength(0);
    expect(await testPrisma().passwordResetToken.count()).toBe(0);
  });

  it("stays 202 when the mailer fails", async () => {
    await signup();
    mailer.fail = true;
    expect((await doForgot("a@x.co")).status).toBe(202);
  });

  it("rate-limits per account (4th request in the window)", async () => {
    await signup();
    for (let i = 0; i < 3; i++) expect((await doForgot("a@x.co")).status).toBe(202);
    expect((await doForgot("a@x.co")).status).toBe(429);
  });

  it("only the latest of two tokens works", async () => {
    await signup();
    await doForgot("a@x.co");
    const first = mailer.lastToken();
    await doForgot("a@x.co");
    const second = mailer.lastToken();
    expect((await doReset(first)).status).toBe(400);
    expect((await doReset(second)).status).toBe(200);
  });
});

describe("reset-password", () => {
  it("changes the password, revokes sessions, clears lockout", async () => {
    const t = await signup();
    await testPrisma().user.updateMany({
      data: { failedLoginCount: 9, lockedUntil: new Date(now.getTime() + 600_000) },
    });
    await doForgot("a@x.co");
    const res = await doReset(mailer.lastToken());
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toEqual({});
    const user = await testPrisma().user.findFirstOrThrow();
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
    expect((await doLogin(NEW)).status).toBe(200);
    expect((await doLogin(OLD)).status).toBe(401);
    const r = await refresh(req({ refreshToken: t.refreshToken }), noParams);
    expect(r.status).toBe(401);
    expect((await envelope(r)).error?.code).toBe("INVALID_REFRESH_TOKEN");
    const revoked = await testPrisma().session.findMany({
      where: { revokedReason: "password_reset" },
    });
    expect(revoked).toHaveLength(1);
  });

  it("a token cannot be used twice", async () => {
    await signup();
    await doForgot("a@x.co");
    const token = mailer.lastToken();
    expect((await doReset(token)).status).toBe(200);
    const again = await doReset(token, "another-pass-3");
    expect(again.status).toBe(400);
    expect((await envelope(again)).error?.code).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects a token older than 30 minutes", async () => {
    await signup();
    await doForgot("a@x.co");
    const token = mailer.lastToken();
    now = new Date(now.getTime() + 30 * 60_000 + 1000);
    const res = await doReset(token);
    expect(res.status).toBe(400);
    expect((await envelope(res)).error?.code).toBe("INVALID_RESET_TOKEN");
  });

  it("rejects a token presented to another tenant, and does not consume it", async () => {
    await signup();
    await doForgot("a@x.co");
    const token = mailer.lastToken();
    const cross = await doReset(token, NEW, "globex");
    expect(cross.status).toBe(400);
    expect((await envelope(cross)).error?.code).toBe("INVALID_RESET_TOKEN");
    expect((await doReset(token)).status).toBe(200);
  });

  it("rejects an unknown token and a weak password", async () => {
    expect((await doReset("nope")).status).toBe(400);
    const weak = await doReset("x", "short");
    expect(weak.status).toBe(400);
    expect((await envelope(weak)).error?.code).toBe("VALIDATION_ERROR");
  });

  it("rate-limits per IP (11th request in the window)", async () => {
    setContainer(
      createContainer({ ...config, trustProxy: true }, { prisma: testPrisma(), clock, mailer }),
    );
    const attempt = () =>
      reset(
        new Request("http://localhost/api/v1/auth/x", {
          method: "POST",
          body: JSON.stringify({ token: "nope", newPassword: NEW }),
          headers: {
            "content-type": "application/json",
            "x-client-id": "acme",
            "x-forwarded-for": "9.9.9.9",
          },
        }),
        noParams,
      );
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(400);
    expect((await attempt()).status).toBe(429);
  });
});
