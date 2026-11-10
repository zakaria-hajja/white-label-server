import { beforeEach, describe, expect, it } from "vitest";
import { envelope } from "../../helpers/http";
import { resetDb, testPrisma } from "../../helpers/db";
import { loginAs, seedTwoTenants, type Login } from "../../helpers/actors";
import { loadConfig } from "@/core/config/env";
import { createContainer, setContainer } from "@/core/container";
import { POST as refresh } from "@/app/api/v1/auth/refresh/route";
import { GET as getMe } from "@/app/api/v1/users/me/route";

const config = loadConfig(process.env);
const noParams = { params: Promise.resolve({}) };
let now = new Date();
const clock = { now: () => now };
let alice: Login;

const me = (token: string) =>
  getMe(
    new Request("http://localhost/api/v1/users/me", {
      headers: { authorization: `Bearer ${token}`, "x-client-id": "acme" },
    }),
    noParams,
  );
const doRefresh = (refreshToken: string) =>
  refresh(
    new Request("http://localhost/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
      headers: { "content-type": "application/json", "x-client-id": "acme" },
    }),
    noParams,
  );

beforeEach(async () => {
  await resetDb();
  now = new Date();
  setContainer(createContainer(config, { prisma: testPrisma(), clock }));
  await seedTwoTenants();
  alice = await loginAs("acme", "alice@shared.test");
});

describe("token security", () => {
  it("a fresh access token is accepted, then expires with the clock -> 401 TOKEN_EXPIRED", async () => {
    expect((await me(alice.accessToken)).status).toBe(200);
    now = new Date(now.getTime() + (config.jwt.accessTtlSeconds + 60) * 1000);
    const res = await me(alice.accessToken);
    expect(res.status).toBe(401);
    expect((await envelope(res)).error?.code).toBe("TOKEN_EXPIRED");
  });

  it("a random refresh token -> 401 INVALID_REFRESH_TOKEN", async () => {
    const res = await doRefresh("not-a-real-refresh-token");
    expect(res.status).toBe(401);
    expect((await envelope(res)).error?.code).toBe("INVALID_REFRESH_TOKEN");
  });

  it("a token signed with a different secret -> 401 UNAUTHENTICATED", async () => {
    const { SignJWT } = await import("jose");
    const forged = await new SignJWT({ tid: "x", sid: alice.sessionId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(alice.userId)
      .setIssuer(config.jwt.issuer)
      .setAudience(config.jwt.audience)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("some-other-secret-some-other-secret-0123"));
    const res = await me(forged);
    expect(res.status).toBe(401);
    expect((await envelope(res)).error?.code).toBe("UNAUTHENTICATED");
  });

  it("an unsigned (alg none) token -> 401", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: alice.userId,
      tid: "x",
      sid: alice.sessionId,
      exp,
      iss: config.jwt.issuer,
      aud: config.jwt.audience,
    })}.`;
    expect((await me(token)).status).toBe(401);
  });
});
