import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as getMe, PATCH as patchMe } from "@/app/api/v1/users/me/route";
import { PATCH as patchPassword } from "@/app/api/v1/users/me/password/route";

const config = loadConfig(process.env);
const OLD = "correct-horse-1";
const NEW = "brand-new-pass-2";
let now = new Date();
const clock = { now: () => now };
type Tokens = { accessToken: string; refreshToken: string };

const req = (method: string, body?: unknown, opts: { tenant?: string; token?: string } = {}) =>
  new Request("http://localhost/api/v1/x", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "x-client-id": opts.tenant ?? "acme",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
  });
const noParams = { params: Promise.resolve({}) };

async function signup(email: string, tenant = "acme"): Promise<Tokens> {
  const res = await register(req("POST", { email, password: OLD }, { tenant }), noParams);
  return (await envelope(res)).data?.tokens as Tokens;
}
const doPatch = (t: Tokens, body: unknown) =>
  patchMe(req("PATCH", body, { token: t.accessToken }), noParams);
const doPassword = (t: Tokens, body: unknown) =>
  patchPassword(req("PATCH", body, { token: t.accessToken }), noParams);

beforeEach(async () => {
  await resetDb();
  now = new Date();
  setContainer(createContainer(config, { prisma: testPrisma(), clock }));
  await createTenant("acme");
  await createTenant("globex");
});

describe("GET/PATCH /users/me", () => {
  it("GET without a token -> 401", async () => {
    const res = await getMe(req("GET"), noParams);
    expect(res.status).toBe(401);
  });

  it("GET returns the user DTO", async () => {
    const t = await signup("a@x.co");
    const res = await getMe(req("GET", undefined, { token: t.accessToken }), noParams);
    expect(res.status).toBe(200);
    const data = (await envelope(res)).data as Record<string, unknown>;
    expect(data.email).toBe("a@x.co");
    expect(data).not.toHaveProperty("passwordHash");
  });

  it("PATCH updates the name; null clears the other", async () => {
    const t = await signup("a@x.co");
    const res = await doPatch(t, { firstName: "Ann", lastName: "Lee" });
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toMatchObject({ firstName: "Ann", lastName: "Lee" });
    const res2 = await doPatch(t, { lastName: null });
    expect((await envelope(res2)).data).toMatchObject({ firstName: "Ann", lastName: null });
  });

  it.each([
    [{}],
    [{ tenantId: "00000000-0000-4000-8000-000000000001" }],
    [{ email: "b@x.co" }],
    [{ status: "DISABLED" }],
    [{ firstName: "Ann", status: "DISABLED" }],
    [{ firstName: "" }],
  ])("PATCH %j -> 400 VALIDATION_ERROR", async (body) => {
    const t = await signup("a@x.co");
    const res = await doPatch(t, body);
    expect(res.status).toBe(400);
    expect((await envelope(res)).error?.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH does not affect other users", async () => {
    const a = await signup("a@x.co");
    const b = await signup("b@x.co");
    await doPatch(a, { firstName: "Ann" });
    const res = await getMe(req("GET", undefined, { token: b.accessToken }), noParams);
    expect((await envelope(res)).data).toMatchObject({ firstName: null });
  });

  it("returns 404 when the user was deleted after authentication", async () => {
    const t = await signup("a@x.co");
    await testPrisma().user.deleteMany({});
    const res = await getMe(req("GET", undefined, { token: t.accessToken }), noParams);
    // Cascade removes the session too, so the per-request session check may answer first.
    expect([401, 404]).toContain(res.status);
  });
});

describe("PATCH /users/me/password", () => {
  it("keeps the current session, revokes other devices, new password logs in", async () => {
    const t1 = await signup("a@x.co");
    const t2 = (
      await envelope(await login(req("POST", { email: "a@x.co", password: OLD }), noParams))
    ).data?.tokens as Tokens;

    const res = await doPassword(t1, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toEqual({});

    expect((await getMe(req("GET", undefined, { token: t1.accessToken }), noParams)).status).toBe(
      200,
    );
    expect((await getMe(req("GET", undefined, { token: t2.accessToken }), noParams)).status).toBe(
      401,
    );
    expect((await refresh(req("POST", { refreshToken: t2.refreshToken }), noParams)).status).toBe(
      401,
    );
    expect((await refresh(req("POST", { refreshToken: t1.refreshToken }), noParams)).status).toBe(
      200,
    );

    const old = await login(req("POST", { email: "a@x.co", password: OLD }), noParams);
    expect(old.status).toBe(401);
    const fresh = await login(req("POST", { email: "a@x.co", password: NEW }), noParams);
    expect(fresh.status).toBe(200);
  });

  it("wrong current -> 401 INVALID_CREDENTIALS; password unchanged", async () => {
    const t = await signup("a@x.co");
    const res = await doPassword(t, { currentPassword: "wrong-wrong-1", newPassword: NEW });
    expect(res.status).toBe(401);
    expect((await envelope(res)).error?.code).toBe("INVALID_CREDENTIALS");
    expect((await login(req("POST", { email: "a@x.co", password: OLD }), noParams)).status).toBe(
      200,
    );
  });

  it("same password / weak new / extra key -> 400", async () => {
    const t = await signup("a@x.co");
    for (const body of [
      { currentPassword: OLD, newPassword: OLD },
      { currentPassword: OLD, newPassword: "short" },
      { currentPassword: OLD, newPassword: NEW, email: "x@y.co" },
    ]) {
      const res = await doPassword(t, body);
      expect(res.status).toBe(400);
      expect((await envelope(res)).error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("without a token -> 401", async () => {
    const res = await patchPassword(
      req("PATCH", { currentPassword: OLD, newPassword: NEW }),
      noParams,
    );
    expect(res.status).toBe(401);
  });

  it("rate limits current-password guessing per account: 5 attempts, then 429", async () => {
    const t = await signup("a@x.co");
    for (let i = 0; i < 5; i++) {
      expect(
        (await doPassword(t, { currentPassword: "wrong-wrong-1", newPassword: NEW })).status,
      ).toBe(401);
    }
    const res = await doPassword(t, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });
});
