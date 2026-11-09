import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { envelope } from "../../helpers/http";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { signAccessToken } from "@/core/auth/jwt";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { route } from "@/core/http/route";
import { ipKey } from "@/core/rate-limit/rate-limiter";

const config = loadConfig(process.env);
const ctx = { params: Promise.resolve({}) };
const probe = route({
  auth: "required",
  tenant: "required",
  handler: async ({ auth, tenant }) =>
    Response.json({ userId: auth.userId, tenant: tenant.slug, sid: auth.sessionId }),
});
const limited = route({
  auth: "none",
  tenant: "none",
  body: z.object({ email: z.string() }),
  rateLimit: [
    {
      name: "t",
      limit: 2,
      windowSeconds: 60,
      key: ({ ip, body }) => ipKey(ip, (body as { email: string }).email),
    },
  ],
  handler: async () => Response.json({ ok: true }),
});

const call = (headers: Record<string, string> = {}) =>
  probe(new Request("http://localhost/probe", { headers }), ctx);

async function seed(slug = "acme", userStatus: "ACTIVE" | "DISABLED" = "ACTIVE") {
  const prisma = testPrisma();
  const tenant = await createTenant(slug);
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `u@${slug}.test`,
      passwordHash: "x",
      firstName: "U",
      lastName: "V",
      status: userStatus,
    },
  });
  const session = await prisma.session.create({
    data: { tenantId: tenant.id, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  const token = await signAccessToken(
    config.jwt,
    { sub: user.id, tid: tenant.id, sid: session.id },
    new Date(),
  );
  return { tenant, user, session, token };
}

beforeEach(async () => {
  await resetDb();
  // A fresh container per test gives each test its own in-memory rate limiter.
  setContainer(createContainer(config, { prisma: testPrisma() }));
});

describe("auth guard", () => {
  it("accepts a valid token (scheme case-insensitive, no X-Client-Id needed)", async () => {
    const { token, user } = await seed();
    const res = await call({ authorization: `bearer ${token}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: user.id, tenant: "acme" });
  });

  it("rejects missing, malformed and garbage credentials with 401", async () => {
    const { token } = await seed();
    for (const headers of [
      {},
      { authorization: "Bearer garbage" },
      { authorization: "Bearer" },
      { authorization: `Basic ${token}` },
      { authorization: `Bearer ${token} extra` },
    ] as Record<string, string>[]) {
      const res = await call(headers);
      expect(res.status).toBe(401);
      expect((await envelope(res)).error).toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });

  it("rejects a token whose session is revoked", async () => {
    const { token, session } = await seed();
    await testPrisma().session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    const res = await call({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
  });

  it("rejects an expired session", async () => {
    const { token, session } = await seed();
    await testPrisma().session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await call({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("rejects a token for a DISABLED user", async () => {
    const { token } = await seed("acme", "DISABLED");
    const res = await call({ authorization: `Bearer ${token}` });
    expect(res.status).toBe(401);
    expect((await envelope(res)).error).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("rejects a tenant-A token sent with X-Client-Id of another tenant", async () => {
    const { token } = await seed("acme");
    await createTenant("globex");
    const res = await call({ authorization: `Bearer ${token}`, "x-client-id": "globex" });
    expect(res.status).toBe(403);
    expect((await envelope(res)).error).toMatchObject({ code: "TENANT_MISMATCH" });
  });

  it("rejects a token whose sid belongs to another user or tenant", async () => {
    const a = await seed("acme");
    const b = await seed("globex");
    const forged = await signAccessToken(
      config.jwt,
      { sub: a.user.id, tid: a.tenant.id, sid: b.session.id },
      new Date(),
    );
    expect((await call({ authorization: `Bearer ${forged}` })).status).toBe(401);
  });

  it("rejects a token for an unknown tenant with 401", async () => {
    const { user, session } = await seed();
    const token = await signAccessToken(
      config.jwt,
      { sub: user.id, tid: "0192f5a0-0000-7000-8000-0000000000aa", sid: session.id },
      new Date(),
    );
    expect((await call({ authorization: `Bearer ${token}` })).status).toBe(401);
  });

  it("touches lastUsedAt only when older than 5 minutes", async () => {
    const { token, session } = await seed();
    const prisma = testPrisma();
    const before = (await prisma.session.findUniqueOrThrow({ where: { id: session.id } }))
      .lastUsedAt;
    await call({ authorization: `Bearer ${token}` });
    const fresh = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(fresh.lastUsedAt).toEqual(before);
    const old = new Date(Date.now() - 10 * 60_000);
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: old } });
    await call({ authorization: `Bearer ${token}` });
    const touched = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(touched.lastUsedAt.getTime()).toBeGreaterThan(old.getTime() + 5 * 60_000);
  });
});

describe("rate limiting", () => {
  const hit = (ip: string | null, email = "a@b.co") =>
    limited(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ email }),
        headers: {
          "content-type": "application/json",
          ...(ip ? { "x-forwarded-for": ip } : {}),
        },
      }),
      ctx,
    );

  it("skips ip rules when the ip is unknown (no trusted proxy)", async () => {
    for (let i = 0; i < 5; i++) expect((await hit("1.2.3.4")).status).toBe(200);
  });

  it("limits per ip+body key with Retry-After when the proxy is trusted", async () => {
    setContainer(createContainer({ ...config, trustProxy: true }, { prisma: testPrisma() }));
    expect((await hit("1.2.3.4")).status).toBe(200);
    expect((await hit("1.2.3.4")).status).toBe(200);
    const res = await hit("1.2.3.4");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect((await envelope(res)).error).toMatchObject({ code: "RATE_LIMITED" });
    expect((await hit("1.2.3.4", "other@b.co")).status).toBe(200);
    expect((await hit("5.6.7.8")).status).toBe(200);
  });
});
