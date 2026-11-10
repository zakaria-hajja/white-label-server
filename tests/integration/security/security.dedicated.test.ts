import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { createTenant, resetDb, testPrisma } from "../../helpers/db";
import { loginAs } from "../../helpers/actors";
import { seed } from "../../../prisma/seed-data";
import { signAccessToken } from "@/core/auth/jwt";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { GET as getMe } from "@/app/api/v1/users/me/route";

const config = loadConfig(process.env);
const noParams = { params: Promise.resolve({}) };
const me = (token: string, client?: string) =>
  getMe(
    new Request("http://localhost/api/v1/users/me", {
      headers: { authorization: `Bearer ${token}`, ...(client ? { "x-client-id": client } : {}) },
    }),
    noParams,
  );

beforeEach(async () => {
  await resetDb();
  setContainer(createContainer(config, { prisma: testPrisma() }));
  await seed(testPrisma(), config);
});

describe("dedicated deployment security", () => {
  it("a token for the deployment tenant works without X-Client-Id", async () => {
    const alice = await loginAs("acme", "alice@shared.test");
    expect((await me(alice.accessToken)).status).toBe(200);
  });

  it("a token signed with the real secret but the tid of another tenant row -> 401", async () => {
    const alice = await loginAs("acme", "alice@shared.test");
    const other = await createTenant("globex");
    const forged = await signAccessToken(
      config.jwt,
      { sub: alice.userId, tid: other.id, sid: alice.sessionId },
      new Date(),
    );
    for (const client of [undefined, "acme"]) {
      const res = await me(forged, client);
      expect(res.status).toBe(401);
      expect((await envelope(res)).error?.code).toBe("UNAUTHENTICATED");
    }
  });

  it("a genuine token of another tenant's user (full real session) -> 401", async () => {
    const other = await createTenant("globex");
    const prisma = testPrisma();
    const user = await prisma.user.create({
      data: { tenantId: other.id, email: "eve@globex.test", passwordHash: "x" },
    });
    const session = await prisma.session.create({
      data: { tenantId: other.id, userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const token = await signAccessToken(
      config.jwt,
      { sub: user.id, tid: other.id, sid: session.id },
      new Date(),
    );
    expect((await me(token)).status).toBe(401);
  });

  it("another tenant's slug in X-Client-Id -> 400 INVALID_CLIENT", async () => {
    await createTenant("globex");
    const alice = await loginAs("acme", "alice@shared.test");
    const res = await me(alice.accessToken, "globex");
    expect(res.status).toBe(400);
    expect((await envelope(res)).error?.code).toBe("INVALID_CLIENT");
  });
});
