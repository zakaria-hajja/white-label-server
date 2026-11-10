import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { TenantAdminService } from "@/core/tenant/tenant-admin.service";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { DELETE as deleteMe, GET as getMe } from "@/app/api/v1/users/me/route";
import { PATCH as changePassword } from "@/app/api/v1/users/me/password/route";
import { PATCH as patchSettings } from "@/app/api/v1/settings/route";

const config = loadConfig(process.env);
const PASSWORD = "correct-horse-1";
type Tokens = { accessToken: string; refreshToken: string };
const noParams = { params: Promise.resolve({}) };

function req(
  method: string,
  body?: unknown,
  opts: { tenant?: string; token?: string; contentType?: string; raw?: string } = {},
) {
  return new Request("http://localhost/api/v1/users/me", {
    method,
    ...(opts.raw !== undefined
      ? { body: opts.raw }
      : body === undefined
        ? {}
        : { body: JSON.stringify(body) }),
    headers: {
      "content-type": opts.contentType ?? "application/json",
      "x-client-id": opts.tenant ?? "acme",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
  });
}

async function signup(email: string, tenant = "acme"): Promise<{ tokens: Tokens; userId: string }> {
  const res = await register(req("POST", { email, password: PASSWORD }, { tenant }), noParams);
  const data = (await envelope(res)).data as { tokens: Tokens; user: { id: string } };
  return { tokens: data.tokens, userId: data.user.id };
}
const del = (t: Tokens, body: unknown = { password: PASSWORD }) =>
  deleteMe(req("DELETE", body, { token: t.accessToken }), noParams);
const userExists = async (id: string) =>
  (await testPrisma().user.findUnique({ where: { id } })) !== null;

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  // Full tenants (config and flags): settings and forgot-password read the app config.
  const admin = new TenantAdminService(testPrisma());
  await admin.create({ slug: "acme", name: "Acme" });
  await admin.create({ slug: "globex", name: "Globex" });
});

describe("DELETE /users/me", () => {
  it("deletes the user and everything they own, and nobody else's data", async () => {
    const alice = await signup("alice@x.co");
    const bob = await signup("bob@x.co");
    const globexAlice = await signup("alice@x.co", "globex");
    // A second session (and its refresh token), settings and a reset token for alice.
    await login(req("POST", { email: "alice@x.co", password: PASSWORD }), noParams);
    await patchSettings(
      req("PATCH", { theme: "DARK" }, { token: alice.tokens.accessToken }),
      noParams,
    );
    await forgotPassword(req("POST", { email: "alice@x.co" }), noParams);
    const p = testPrisma();
    const owned = { userId: alice.userId };
    expect(await p.session.count({ where: owned })).toBe(2);
    expect(await p.userSettings.count({ where: owned })).toBe(1);
    expect(await p.passwordResetToken.count({ where: owned })).toBe(1);

    const res = await del(alice.tokens);
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toEqual({});

    expect(await userExists(alice.userId)).toBe(false);
    expect(await p.session.count({ where: owned })).toBe(0);
    expect(await p.refreshToken.count({ where: { session: owned } })).toBe(0);
    expect(await p.userSettings.count({ where: owned })).toBe(0);
    expect(await p.passwordResetToken.count({ where: owned })).toBe(0);
    expect(await userExists(bob.userId)).toBe(true);
    expect(await userExists(globexAlice.userId)).toBe(true);
    expect(
      await p.session.count({ where: { userId: { in: [bob.userId, globexAlice.userId] } } }),
    ).toBe(2);
  });

  it("the old tokens stop working, and the email can register again", async () => {
    const alice = await signup("alice@x.co");
    expect((await del(alice.tokens)).status).toBe(200);

    const me = await getMe(req("GET", undefined, { token: alice.tokens.accessToken }), noParams);
    expect(me.status).toBe(401);
    expect((await envelope(me)).error?.code).toBe("UNAUTHENTICATED");

    const r = await refresh(req("POST", { refreshToken: alice.tokens.refreshToken }), noParams);
    expect(r.status).toBe(401);
    expect((await envelope(r)).error?.code).toBe("INVALID_REFRESH_TOKEN");

    const again = await register(
      req("POST", { email: "alice@x.co", password: PASSWORD }),
      noParams,
    );
    expect(again.status).toBe(201);
  });

  it.each([
    ["no body", { raw: "" }, 400, "VALIDATION_ERROR"],
    [
      "text/plain",
      { contentType: "text/plain", raw: JSON.stringify({ password: PASSWORD }) },
      400,
      "VALIDATION_ERROR",
    ],
    ["an empty password", { raw: JSON.stringify({ password: "" }) }, 400, "VALIDATION_ERROR"],
    [
      "an unknown field",
      { raw: JSON.stringify({ password: PASSWORD, force: true }) },
      400,
      "VALIDATION_ERROR",
    ],
    [
      "a wrong password",
      { raw: JSON.stringify({ password: "wrong-password-1" }) },
      401,
      "INVALID_CREDENTIALS",
    ],
  ] as const)("%s -> %s %s and the user still exists", async (_, opts, status, code) => {
    const alice = await signup("alice@x.co");
    const res = await deleteMe(
      req("DELETE", undefined, { token: alice.tokens.accessToken, ...opts }),
      noParams,
    );
    expect(res.status).toBe(status);
    expect((await envelope(res)).error?.code).toBe(code);
    expect(await userExists(alice.userId)).toBe(true);
  });

  it("a double submit: one 200, the other 200 or 401 (already gone), never a 500", async () => {
    const alice = await signup("alice@x.co");
    const responses = await Promise.all([del(alice.tokens), del(alice.tokens)]);
    const outcomes = await Promise.all(
      responses.map(async (r) => `${r.status} ${(await envelope(r)).error?.code ?? ""}`.trim()),
    );
    // Overlapping requests both pass the session check and both get 200; a request that arrives
    // after the delete fails the session check with 401 UNAUTHENTICATED (docs/api.md).
    expect(outcomes).toContain("200");
    for (const o of outcomes) expect(["200", "401 UNAUTHENTICATED"]).toContain(o);
    expect(await userExists(alice.userId)).toBe(false);
  });

  it("without a token -> 401 and nothing is deleted", async () => {
    const alice = await signup("alice@x.co");
    const res = await deleteMe(req("DELETE", { password: PASSWORD }), noParams);
    expect(res.status).toBe(401);
    expect(await userExists(alice.userId)).toBe(true);
  });

  it("the 6th attempt within 15 minutes -> 429 with Retry-After", async () => {
    const alice = await signup("alice@x.co");
    for (let i = 0; i < 5; i++) {
      expect((await del(alice.tokens, { password: "wrong-password-1" })).status).toBe(401);
    }
    const res = await del(alice.tokens);
    expect(res.status).toBe(429);
    expect((await envelope(res)).error?.code).toBe("RATE_LIMITED");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await userExists(alice.userId)).toBe(true);
  });

  it("wrong change-password guesses count toward the same limit (one budget per account)", async () => {
    const alice = await signup("alice@x.co");
    const guess = (pw: string) =>
      changePassword(
        req(
          "PATCH",
          { currentPassword: pw, newPassword: "brand-new-pass-2" },
          { token: alice.tokens.accessToken },
        ),
        noParams,
      );
    for (let i = 0; i < 3; i++) expect((await guess("wrong-password-1")).status).toBe(401);
    for (let i = 0; i < 2; i++) {
      expect((await del(alice.tokens, { password: "wrong-password-1" })).status).toBe(401);
    }
    expect((await del(alice.tokens)).status).toBe(429);
    expect(await userExists(alice.userId)).toBe(true);
  });
});
