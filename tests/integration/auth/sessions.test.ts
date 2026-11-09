import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { PrismaAuthRepository } from "@/modules/auth/auth.repository";
import { POST as login } from "@/app/api/v1/auth/login/route";
import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { POST as logout } from "@/app/api/v1/auth/logout/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { GET as listSessions } from "@/app/api/v1/auth/sessions/route";
import { DELETE as deleteSession } from "@/app/api/v1/auth/sessions/[id]/route";

const config = loadConfig(process.env);
const PASSWORD = "correct-horse-1";
let now = new Date();
const clock = { now: () => now };

type Tokens = { accessToken: string; refreshToken: string };

const req = (
  method: string,
  body?: unknown,
  opts: { tenant?: string; token?: string; ua?: string } = {},
) =>
  new Request("http://localhost/api/v1/auth/x", {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      "content-type": "application/json",
      "x-client-id": opts.tenant ?? "acme",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.ua ? { "user-agent": opts.ua } : {}),
    },
  });
const noParams = { params: Promise.resolve({}) };
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function signup(email: string, tenant = "acme"): Promise<Tokens> {
  const res = await register(req("POST", { email, password: PASSWORD }, { tenant }), noParams);
  return (await envelope(res)).data?.tokens as Tokens;
}
async function signin(email: string, ua?: string, tenant = "acme"): Promise<Tokens> {
  const res = await login(
    req("POST", { email, password: PASSWORD }, { tenant, ...(ua ? { ua } : {}) }),
    noParams,
  );
  return (await envelope(res)).data?.tokens as Tokens;
}
const doRefresh = (refreshToken: string, tenant = "acme") =>
  refresh(req("POST", { refreshToken }, { tenant }), noParams);
const getMe = (t: Tokens) => me(req("GET", undefined, { token: t.accessToken }), noParams);

beforeEach(async () => {
  await resetDb();
  now = new Date();
  setContainer(createContainer(config, { prisma: testPrisma(), clock }));
  await createTenant("acme");
  await createTenant("globex");
});

describe("refresh / logout", () => {
  it("rotates the token; old access token still verifies; new pair works", async () => {
    const t = await signup("a@x.co");
    const res = await doRefresh(t.refreshToken);
    expect(res.status).toBe(200);
    const next = (await envelope(res)).data?.tokens as Tokens;
    expect(next.refreshToken).not.toBe(t.refreshToken);
    expect((await getMe(t)).status).toBe(200);
    expect((await getMe(next)).status).toBe(200);
    expect((await doRefresh(t.refreshToken)).status).toBe(401);
  });

  it("logout revokes the session: access tokens 401 and refresh 401; unknown token still 200", async () => {
    const t = await signup("a@x.co");
    const res = await logout(req("POST", { refreshToken: t.refreshToken }), noParams);
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toEqual({});
    expect((await getMe(t)).status).toBe(401);
    expect((await doRefresh(t.refreshToken)).status).toBe(401);
    const again = await logout(req("POST", { refreshToken: t.refreshToken }), noParams);
    expect(again.status).toBe(200);
    const unknown = await logout(req("POST", { refreshToken: "nope" }), noParams);
    expect(unknown.status).toBe(200);
  });

  it("logout with another tenant's token is a 200 no-op", async () => {
    const t = await signup("a@x.co");
    const res = await logout(
      req("POST", { refreshToken: t.refreshToken }, { tenant: "globex" }),
      noParams,
    );
    expect(res.status).toBe(200);
    expect((await getMe(t)).status).toBe(200);
    expect((await doRefresh(t.refreshToken, "globex")).status).toBe(401);
    expect((await doRefresh(t.refreshToken)).status).toBe(200);
  });

  it("reuse 11 s later revokes the session", async () => {
    const t = await signup("a@x.co");
    const next = (await envelope(await doRefresh(t.refreshToken))).data?.tokens as Tokens;
    now = new Date(now.getTime() + 11_000);
    expect((await doRefresh(t.refreshToken)).status).toBe(401);
    expect((await doRefresh(next.refreshToken)).status).toBe(401);
    expect((await testPrisma().session.findFirstOrThrow()).revokedReason).toBe(
      "refresh_token_reuse",
    );
  });

  it("two simultaneous refreshes: one 200, one 401, session still usable", async () => {
    const t = await signup("a@x.co");
    const [r1, r2] = await Promise.all([doRefresh(t.refreshToken), doRefresh(t.refreshToken)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 401]);
    const winner = (await envelope(r1.status === 200 ? r1 : r2)).data?.tokens as Tokens;
    expect((await getMe(t)).status).toBe(200);
    expect((await doRefresh(winner.refreshToken)).status).toBe(200);
  });
});

describe("me / sessions", () => {
  it("GET /me returns user, tenant and session", async () => {
    const t = await signup("a@x.co");
    const body = (await envelope(await getMe(t))).data as Record<string, unknown>;
    expect(body).toMatchObject({
      user: { email: "a@x.co" },
      tenant: { slug: "acme", name: "acme" },
      session: { id: expect.any(String) as unknown, expiresAt: expect.any(String) as unknown },
    });
    expect(JSON.stringify(body)).not.toContain("passwordHash");
  });

  it("lists 2 sessions after two logins with exactly one current; no ip", async () => {
    await signup("a@x.co");
    const t2 = await signin("a@x.co", "phone-ua");
    const res = await listSessions(req("GET", undefined, { token: t2.accessToken }), noParams);
    const text = JSON.stringify(await envelope(res));
    const sessions = (
      JSON.parse(text) as { data: { sessions: { current: boolean; userAgent: string | null }[] } }
    ).data.sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.find((s) => s.current)?.userAgent).toBe("phone-ua");
    expect(text).not.toMatch(/ipAddress|tokenHash/);
  });

  it("DELETE another session kills its refresh; unknown/foreign/malformed ids -> 404", async () => {
    const t1 = await signup("a@x.co");
    const t2 = await signin("a@x.co");
    const other = await signup("b@x.co");
    const prisma = testPrisma();
    const sessions = await prisma.session.findMany({ where: { user: { email: "a@x.co" } } });
    const t1Session = sessions.find(
      (s) =>
        s.id ===
        JSON.parse(Buffer.from(t1.accessToken.split(".")[1] ?? "", "base64url").toString()).sid,
    );
    expect(t1Session).toBeDefined();
    const del = (id: string, t: Tokens) =>
      deleteSession(req("DELETE", undefined, { token: t.accessToken }), idParams(id));

    const res = await del(t1Session?.id ?? "", t2);
    expect(res.status).toBe(200);
    expect((await envelope(res)).data).toEqual({});
    expect((await doRefresh(t1.refreshToken)).status).toBe(401);
    expect((await del(t1Session?.id ?? "", t2)).status).toBe(200); // idempotent

    expect((await del(t1Session?.id ?? "", other)).status).toBe(404);
    expect((await del("not-a-uuid", t2)).status).toBe(404);
    expect((await del("00000000-0000-4000-8000-000000000000", t2)).status).toBe(404);
    expect((await getMe(t2)).status).toBe(200);
  });

  it("DELETE own current session is allowed with reason user_revoked", async () => {
    const t = await signup("a@x.co");
    const s = await testPrisma().session.findFirstOrThrow();
    const res = await deleteSession(
      req("DELETE", undefined, { token: t.accessToken }),
      idParams(s.id),
    );
    expect(res.status).toBe(200);
    expect((await testPrisma().session.findFirstOrThrow()).revokedReason).toBe("user_revoked");
    expect((await getMe(t)).status).toBe(401);
  });
});

describe("PrismaAuthRepository.transaction", () => {
  it("joins the outer transaction when already tx-bound (rollback undoes inner writes)", async () => {
    const prisma = testPrisma();
    const tenant = await createTenant("txco");
    const repo = new PrismaAuthRepository(prisma);
    await expect(
      repo.transaction(async (outer) => {
        await outer.transaction(async (inner) => {
          expect(inner).toBe(outer);
          await inner.createUser(tenant.id, {
            email: "tx@x.co",
            passwordHash: "x",
            firstName: null,
            lastName: null,
          });
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.user.count({ where: { tenantId: tenant.id } })).toBe(0);
  });
});
